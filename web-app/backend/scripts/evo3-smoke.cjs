// Run inside the API image with this directory mounted read-only at /checks.
// Uses a disposable database and /tmp; never imports real screenshots.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const appRequire = createRequire('/app/package.json');
const { Client } = appRequire('pg');
const sharp = appRequire('sharp');

(async () => {
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const database = `ai_usage_evo3_test_${randomUUID().replaceAll('-', '')}`;
  const root = path.join('/tmp', database);
  await admin.query(`CREATE DATABASE "${database}"`);
  let ds;
  try {
    const url = new URL(process.env.DATABASE_URL); url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.toString();
    process.env.UPLOAD_DIR = path.join(root, 'projects');
    process.env.LEGACY_UPLOAD_DIR = path.join(root, 'legacy');
    const { AppDataSource } = require('/app/dist/database');
    ds = AppDataSource; await ds.initialize(); await ds.runMigrations();
    const e = require('/app/dist/entities');
    const { scanProjectInbox, importRecord, migrateProjectStorage } = require('/app/dist/inbox');
    const { ensureProjectFolders, resolveStoredFile, relativeStorageKey } = require('/app/dist/storage');
    const { processUpload, tagHistoricalUpload } = require('/app/dist/worker');
    const { RecordsController } = require('/app/dist/records');
    const { ProjectsController } = require('/app/dist/projects');
    const { CostAnalysisController } = require('/app/dist/cost-analysis');
    const { ModelCatalogService } = require('/app/dist/model-catalog');
    const { ModelsController } = require('/app/dist/models');
    const { recoverOcrFailures } = require('/app/dist/ocr-failures');
    const { migrateOwnedProjectFolders } = require('/app/dist/project-folders');
    const repo = (entity) => ds.getRepository(entity);
    const csvHeader = 'key,provider,name,reasoning,currency,five_hour_window_cost,cost_per_minute,max_time_window_minutes,available\n';
    const csvSol = 'sol,OpenAI,GPT-5.6 Sol,high,EUR,13.54,0.1,135:24,true\n';
    const csvAstra = 'astra,OpenAI,GPT-6 Astra,high,EUR,13.54,0.2,67:42,true\n';
    const csv = csvHeader + csvSol + csvAstra;
    process.env.MODEL_CATALOG_PATH = path.join(root, 'models.csv');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, csv);
    const catalog = new ModelCatalogService(ds);
    await catalog.loadAndSync();
    const owner = await repo(e.UserEntity).save({ email: 'invented@example.invalid', displayName: 'Test', passwordHash: 'synthetic' });
    await ds.transaction((manager) => catalog.syncOwner(manager, owner.id));
    const model = await repo(e.AiModelEntity).findOneByOrFail({ ownerId: owner.id, catalogKey: 'sol' });
    const target = await repo(e.AiModelEntity).findOneByOrFail({ ownerId: owner.id, catalogKey: 'astra' });
    await assert.rejects(repo(e.AiModelEntity).update(model.id, { pricing: { ...model.pricing, fiveHourWindowCost: 20 } }), /fixed at EUR/);
    const project = await repo(e.ProjectEntity).save({ ownerId: owner.id, modelId: null, name: 'Synthetic EVO3', storageFolder: 'synthetic-evo3', color: '#9BE15D' });
    const projectRoot = await ensureProjectFolders(project);
    const png = (color) => sharp({ create: { width: 1280, height: 800, channels: 3, background: color } }).png().toBuffer();
    const [a, b] = await Promise.all([png('#eeeeee'), png('#dddddd')]);
    const deposit = async (name, data) => {
      const file = path.join(projectRoot, 'to-process', name);
      await fs.writeFile(file, data); const old = new Date(Date.now() - 3000); await fs.utimes(file, old, old); return file;
    };
    const fakeWorker = (remaining, valid = true, label = 'GPT-5.6 Sol Alto') => ({
      setParameters: async () => {},
      recognize: async (input) => {
        const text = valid ? `10:00:00 20/10/2026 5h ${remaining}% 15:00 Settimanale 60% 25 ott ${label}` : 'unreadable';
        const dimensions = await sharp(input).metadata();
        const labelWidth = Math.max(50, Math.floor(dimensions.width * .5));
        const modelBox = { x0: Math.floor(dimensions.width * .3), y0: 15, x1: Math.floor(dimensions.width * .3) + labelWidth, y1: 30 };
        return { data: { text, confidence: 96, blocks: [{ paragraphs: [{ lines: [{ text: label, words: label.split(' ').map((word) => ({ text: word, bbox: modelBox })) }] }] }] } };
      },
    });
    const processQueued = async (remaining, valid = true) => {
      for (const upload of await repo(e.UploadEntity).findBy({ status: 'UPLOADED' })) {
        const current = await repo(e.UploadEntity).findOneBy({ id: upload.id });
        if (!current || current.status !== 'UPLOADED') continue;
        await repo(e.UploadEntity).update(upload.id, { status: 'PROCESSING' });
        await processUpload(fakeWorker(upload.role === 'END' ? remaining - 20 : remaining, valid), upload);
      }
    };
    await deposit('A1.png', a);
    assert.equal((await scanProjectInbox(ds, project)).pending[0].reason, 'Manca B1');
    assert.equal(await repo(e.UsageRecordEntity).count(), 0);
    await deposit('B1.png', b);
    assert.equal((await scanProjectInbox(ds, project)).imported, 1);
    assert.equal((await scanProjectInbox(ds, project)).imported, 0);
    await processQueued(80);
    assert.equal(await repo(e.UsageRecordEntity).count(), 1);
    assert.equal(await repo(e.UsageSnapshotEntity).count(), 2);
    assert.deepEqual(await fs.readdir(path.join(projectRoot, 'to-process')), []);
    assert.equal((await fs.readdir(path.join(projectRoot, 'processed'))).length, 2);
    const taggedUpload = await repo(e.UploadEntity).findOneByOrFail({ projectId: project.id, role: 'START' });
    assert.equal(taggedUpload.modelId, model.id);
    assert.ok((await repo(e.AiModelEntity).findOneByOrFail({ id: model.id })).lockedAt);
    await assert.rejects(repo(e.UploadEntity).update(taggedUpload.id, { modelId: target.id }), /immutable/);
    await assert.rejects(repo(e.AiModelEntity).update(model.id, { name: 'Changed model' }), /immutable/);
    await assert.rejects(repo(e.ProjectEntity).update(project.id, { modelId: target.id }), /assigned only by screenshot/);

    // Identical image bytes must recreate current snapshots, never pin a
    // duplicate notice or skip the OCR replacement.
    await deposit('A1.png', a); await deposit('B1.png', b);
    assert.equal((await scanProjectInbox(ds, project)).imported, 1);
    await processQueued(80);
    assert.equal(await repo(e.UsageRecordEntity).count(), 1);
    assert.equal(await repo(e.UsageSnapshotEntity).count(), 2);
    assert.equal(await repo(e.OcrFailureNotificationEntity).count(), 0);
    const revisionsBeforeReread = (await ds.query('SELECT count(*)::int AS n FROM ocr_revisions'))[0].n;
    assert.equal(revisionsBeforeReread, 2);
    // Reinsert only A: the already processed B remains the same partner.
    await deposit('A1.png', a);
    assert.equal((await scanProjectInbox(ds, project)).imported, 1);
    await processQueued(70);
    assert.equal(await repo(e.UsageRecordEntity).count(), 1);
    assert.equal(await repo(e.UsageSnapshotEntity).count(), 2);
    assert.equal((await ds.query('SELECT count(*)::int AS n FROM ocr_revisions'))[0].n, revisionsBeforeReread + 1);
    const snapshot = await repo(e.UsageSnapshotEntity).findOneByOrFail({ uploadId: (await repo(e.UploadEntity).findOneByOrFail({ originalName: 'A1.png' })).id });
    assert.equal(Number(snapshot.fiveHourUsedPct), 30);
    const costController = new CostAnalysisController(repo(e.AiModelEntity), repo(e.UsageRecordEntity), repo(e.ProjectEntity), repo(e.UsageSnapshotEntity), repo(e.UsageCorrectionEntity), repo(e.CaptureTimeObservationEntity), repo(e.UploadEntity));
    const beforeExplore = JSON.stringify(await repo(e.UploadEntity).find({ order: { id: 'ASC' } }));
    const actual = await costController.analyse({ id: owner.id });
    const explored = await costController.analyse({ id: owner.id }, undefined, 'true', target.id);
    assert.equal(explored.summary.estimatedCost, actual.summary.estimatedCost * 2);
    assert.equal(explored.summary.estimatedUsageMinutes, actual.summary.estimatedUsageMinutes);
    assert.equal(JSON.stringify(await repo(e.UploadEntity).find({ order: { id: 'ASC' } })), beforeExplore);
    const originalAgain = await costController.analyse({ id: owner.id });
    assert.equal(originalAgain.summary.estimatedCost, actual.summary.estimatedCost);
    await assert.rejects(costController.analyse({ id: owner.id }, undefined, 'false', target.id), /esplorativa/);
    await assert.rejects(repo(e.UsageSnapshotEntity).update(snapshot.id, { fiveHourUsedPct: 99 }), /tracked OCR replacement/);

    // A failed reread is pinned, while the last accepted pair remains unchanged.
    await deposit('A1.png', a);
    assert.equal((await scanProjectInbox(ds, project)).imported, 1);
    await processQueued(70, false);
    assert.equal((await fs.readdir(path.join(projectRoot, 'unprocessed'))).length, 1);
    assert.equal(await repo(e.OcrFailureNotificationEntity).countBy({ ownerId: owner.id, resolvedAt: null }), 1);
    assert.equal((await scanProjectInbox(ds, project)).imported, 0);
    assert.equal(Number((await repo(e.UsageSnapshotEntity).findOneByOrFail({ id: snapshot.id })).fiveHourUsedPct), 30);

    const controller = new RecordsController(repo(e.UsageRecordEntity), repo(e.ProjectEntity), repo(e.UploadEntity), repo(e.UsageSnapshotEntity), repo(e.UsageCorrectionEntity), repo(e.CaptureTimeObservationEntity), ds);
    const user = { id: owner.id };
    const record = await repo(e.UsageRecordEntity).findOneByOrFail({ projectId: project.id });
    assert.equal((await controller.gallery(user, project.id)).length, 2);
    const removed = await controller.remove(user, record.id);
    assert.equal(removed.archivedUploads, 3);
    assert.equal(await repo(e.UsageRecordEntity).count(), 0);
    const deleted = path.join(projectRoot, 'deleted', record.id);
    assert.ok((await fs.readdir(deleted)).includes('A1.png'));
    assert.ok((await fs.readdir(deleted)).includes('B1.png'));
    assert.ok((await fs.readdir(deleted)).includes('previous-A1.png'));
    assert.equal((await ds.query('SELECT count(*)::int AS n FROM ocr_revisions'))[0].n, 0);
    await deposit('A1.png', await fs.readFile(path.join(deleted, 'A1.png')));
    await deposit('B1.png', await fs.readFile(path.join(deleted, 'B1.png')));
    assert.equal((await scanProjectInbox(ds, project)).imported, 1);
    await processQueued(80);
    assert.equal(await repo(e.UsageRecordEntity).count(), 1);

    // Single uploads deduplicate and can be reread independently of segments.
    const single = await deposit('single.png', await png('#cccccc'));
    const image = { filePath: single, originalName: 'single.png', role: 'SINGLE', mime: 'image/png', size: 1 };
    const first = await importRecord(ds, project, [image], null, true);
    await processQueued(60);
    const another = await deposit('single-again.png', await png('#cccccc'));
    const second = await importRecord(ds, project, [{ ...image, filePath: another, originalName: 'single-again.png' }], null, true);
    assert.equal(first.id, second.id);
    await processQueued(50);
    assert.equal(await repo(e.UsageRecordEntity).count(), 2);
    const projectController = new ProjectsController(repo(e.ProjectEntity), repo(e.AiModelEntity), repo(e.UploadEntity), ds, { record: async () => {} });
    await projectController.update(user, project.id, { name: 'Renamed synthetic' });
    const renamed = await repo(e.ProjectEntity).findOneByOrFail({ id: project.id });
    const renamedRoot = await ensureProjectFolders(renamed);
    assert.ok((await fs.readdir(path.join(renamedRoot, 'deleted'))).includes(record.id));
    assert.equal((await controller.gallery(user, project.id)).length, 3);

    // Old uploads are copied safely to the new root and their DB key follows.
    await fs.mkdir(process.env.LEGACY_UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(process.env.LEGACY_UPLOAD_DIR, 'legacy.png'), a);
    const legacy = await repo(e.UploadEntity).save({ ownerId: owner.id, projectId: project.id, recordId: null, eventId: null, role: 'SINGLE', originalName: 'legacy.png', storageKey: 'legacy.png', mime: 'image/png', size: a.length, status: 'VALIDATED' });
    await migrateProjectStorage(ds);
    const migrated = await repo(e.UploadEntity).findOneByOrFail({ id: legacy.id });
    assert.ok(migrated.storageKey.includes('/processed/'));
    assert.ok((await fs.readFile(resolveStoredFile(migrated.storageKey))).equals(a));
    assert.equal(relativeStorageKey(resolveStoredFile(migrated.storageKey)), migrated.storageKey);
    await tagHistoricalUpload(fakeWorker(80), migrated);
    assert.equal((await repo(e.UploadEntity).findOneByOrFail({ id: migrated.id })).modelId, model.id);
    const existing = await repo(e.UploadEntity).findOneByOrFail({ recordId: first.id });
    await repo(e.UploadEntity).update(existing.id, { status: 'PROCESSING' });
    await processUpload(fakeWorker(70, true, 'GPT-6 Astra Alto'), existing);
    const mismatch = await repo(e.UploadEntity).findOneByOrFail({ id: existing.id });
    assert.equal(mismatch.modelId, model.id);
    assert.equal(mismatch.status, 'MANUAL_REVIEW');
    // Startup CSV changes prices on the same tagged identity and recalculates.
    const tagsBeforeCsv = (await repo(e.UploadEntity).find({ order: { id: 'ASC' } })).map((upload) => ({ id: upload.id, modelId: upload.modelId, modelTaggedAt: upload.modelTaggedAt }));
    const snapshotsBeforeCsv = JSON.stringify(await repo(e.UsageSnapshotEntity).find({ order: { id: 'ASC' } }));
    const oldAnalysis = await costController.analyse(user);
    const rateOnlyCsv = csvHeader + csvSol.replace('0.1,', '0.125,') + csvAstra.replace('0.2,', '0.3,');
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, rateOnlyCsv);
    await catalog.loadAndSync();
    const rateOnlyAnalysis = await costController.analyse(user);
    assert.notEqual(rateOnlyAnalysis.summary.estimatedUsageMinutes, oldAnalysis.summary.estimatedUsageMinutes);
    const changedCsv = rateOnlyCsv.replace('135:24', '93:03').replace('67:42', '40:08');
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, changedCsv);
    await catalog.loadAndSync();
    const updatedModel = await repo(e.AiModelEntity).findOneByOrFail({ id: model.id });
    assert.equal(updatedModel.pricing.costPerMinute, 0.125);
    assert.equal(updatedModel.pricing.maxTimeWindowMinutes, 93.05);
    const newAnalysis = await costController.analyse(user);
    assert.equal(newAnalysis.summary.estimatedUsageMinutes, rateOnlyAnalysis.summary.estimatedUsageMinutes);
    assert.equal(newAnalysis.summary.actualEstimatedCost, oldAnalysis.summary.actualEstimatedCost);
    assert.notEqual(newAnalysis.summary.estimatedUsageMinutes, oldAnalysis.summary.estimatedUsageMinutes);
    assert.deepEqual((await repo(e.UploadEntity).find({ order: { id: 'ASC' } })).map((upload) => ({ id: upload.id, modelId: upload.modelId, modelTaggedAt: upload.modelTaggedAt })), tagsBeforeCsv);
    assert.equal(JSON.stringify(await repo(e.UsageSnapshotEntity).find({ order: { id: 'ASC' } })), snapshotsBeforeCsv);
    await assert.rejects(repo(e.AiModelEntity).update(model.id, { pricing: { ...updatedModel.pricing, costPerMinute: 1 } }), /managed only/);
    const modelsController = new ModelsController(repo(e.AiModelEntity));
    assert.equal((await modelsController.list(user)).length, 2);
    const imports = await repo(e.AuditEventEntity).countBy({ action: 'MODEL_CSV_IMPORTED' });
    await catalog.loadAndSync();
    assert.equal(await repo(e.AuditEventEntity).countBy({ action: 'MODEL_CSV_IMPORTED' }), imports);
    // Renamed keys retain tagged IDs; the new Sol 6.1 remains a separate model.
    const renamedCsv = changedCsv.replace('\nsol,', '\ngpt-5.6-sol,').replace('\nastra,', '\ngpt-6-astra,') + 'gpt-6.1-sol,OpenAI,GPT-6.1 Sol,high,EUR,13.54,0.1212,111:43,true\n';
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, renamedCsv);
    await catalog.loadAndSync();
    assert.equal((await repo(e.AiModelEntity).findOneByOrFail({ ownerId: owner.id, catalogKey: 'gpt-5.6-sol' })).id, model.id);
    assert.equal((await repo(e.AiModelEntity).findOneByOrFail({ ownerId: owner.id, catalogKey: 'gpt-6-astra' })).id, target.id);
    const sol61 = await repo(e.AiModelEntity).findOneByOrFail({ ownerId: owner.id, catalogKey: 'gpt-6.1-sol' });
    assert.notEqual(sol61.id, model.id);
    assert.ok(Math.abs(sol61.pricing.maxTimeWindowMinutes - (111 + 43 / 60)) < 1e-10);
    assert.equal((await modelsController.list(user)).length, 3);
    assert.deepEqual((await repo(e.UploadEntity).find({ order: { id: 'ASC' } })).map((upload) => ({ id: upload.id, modelId: upload.modelId, modelTaggedAt: upload.modelTaggedAt })), tagsBeforeCsv);
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, changedCsv);
    await catalog.loadAndSync();
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, csvHeader + csvSol.replace('0.1,', '0.9,') + csvAstra.replace('astra,OpenAI,GPT-6 Astra', 'astra,OpenAI,Renamed identity'));
    await assert.rejects(catalog.loadAndSync(), /IDENTITY_CHANGED/);
    assert.equal((await repo(e.AiModelEntity).findOneByOrFail({ id: model.id })).pricing.costPerMinute, 0.125);
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, csvHeader + csvSol);
    await catalog.loadAndSync();
    assert.equal((await modelsController.list(user)).length, 1);
    await assert.rejects(costController.analyse(user, undefined, 'true', target.id), /non trovato/);
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, csvHeader + csvAstra);
    await catalog.loadAndSync();
    assert.equal((await costController.analyse(user)).summary.estimatedCost, 0);
    assert.ok((await repo(e.UploadEntity).find()).some((upload) => upload.modelId === model.id));
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, csv);
    await catalog.loadAndSync();
    const anotherOwner = await repo(e.UserEntity).save({ email: 'second-invented@example.invalid', displayName: 'Second test', passwordHash: 'synthetic' });
    await ds.transaction((manager) => catalog.syncOwner(manager, anotherOwner.id));
    assert.equal((await modelsController.list({ id: anotherOwner.id })).length, 2);
    assert.ok(await repo(e.AiModelEntity).findOneBy({ id: model.id, ownerId: owner.id }));
    // Verify HTTP, including registration provisioning, against this disposable DB.
    const { NestFactory } = appRequire('@nestjs/core');
    const { JwtService } = appRequire('@nestjs/jwt');
    const { AppModule } = require('/app/dist/app.module');
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      app.setGlobalPrefix('api');
      await app.get(ModelCatalogService).loadAndSync();
      await app.listen(0, '127.0.0.1');
      const baseUrl = await app.getUrl();
      const authorization = 'Bearer ' + app.get(JwtService).sign({ sub: owner.id, storageOwnerId: owner.storageOwnerId });
      const response = await fetch(baseUrl + '/api/models', { headers: { authorization } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).length, 2);
      for (const [method, suffix] of [['POST', ''], ['PATCH', '/' + model.id], ['DELETE', '/' + model.id]]) {
        assert.equal((await fetch(baseUrl + '/api/models' + suffix, { method, headers: { authorization, 'Content-Type': 'application/json' }, ...(method === 'DELETE' ? {} : { body: '{}' }) })).status, 404);
      }
      const registration = await fetch(baseUrl + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'api-invented@example.invalid', displayName: 'API test', password: 'invented-test-password-only' }) });
      assert.equal(registration.status, 201);
      const registered = await registration.json();
      const catalogResponse = await fetch(baseUrl + '/api/models', { headers: { authorization: 'Bearer ' + registered.accessToken } });
      const newAccountModels = await catalogResponse.json();
      assert.equal(newAccountModels.length, 2);
      assert.ok(newAccountModels.every((model) => model.pricing.costPerMinute > 0 && model.catalogAvailable));
      // Browser A/B uploads are paired numerically even when multipart order differs.
      const browserProject = await repo(e.ProjectEntity).save({ ownerId: owner.id, name: 'Browser pairs', storageFolder: 'browser-pairs', color: '#9BE15D' });
      const pairsForm = new FormData();
      pairsForm.append('projectId', browserProject.id); pairsForm.append('mode', 'SEGMENT');
      for (const [field, name, color] of [['start', 'A12.png', '#aabbcc'], ['start', 'A11.png', '#ccddee'], ['end', 'B11.png', '#abcdef'], ['end', 'B12.png', '#fedcba']]) {
        pairsForm.append(field, new Blob([await png(color)], { type: 'image/png' }), name);
      }
      const uploaded = await fetch(baseUrl + '/api/records/batch', { method: 'POST', headers: { authorization }, body: pairsForm });
      assert.equal(uploaded.status, 201);
      const browserRecords = await uploaded.json();
      assert.deepEqual(browserRecords.map((record) => [record.start.upload.originalName, record.end.upload.originalName]), [['A11.png', 'B11.png'], ['A12.png', 'B12.png']]);
      for (const record of browserRecords) assert.equal((await fetch(baseUrl + '/api/records/' + record.id + '/validate', { method: 'POST', headers: { authorization } })).status, 201);
      await processQueued(80);
      const countBeforeInvalid = await repo(e.UsageRecordEntity).count();
      for (const names of [['A21.png', 'B22.png'], ['A21.png', 'A021.png', 'B21.png', 'B22.png']]) {
        const invalid = new FormData(); invalid.append('projectId', browserProject.id); invalid.append('mode', 'SEGMENT');
        for (const name of names) invalid.append(name.startsWith('A') ? 'start' : 'end', new Blob([a], { type: 'image/png' }), name);
        assert.equal((await fetch(baseUrl + '/api/records/batch', { method: 'POST', headers: { authorization }, body: invalid })).status, 400);
        assert.equal(await repo(e.UsageRecordEntity).count(), countBeforeInvalid);
      }
      const galleryResponse = await fetch(baseUrl + '/api/records/uploads/gallery?projectId=' + browserProject.id, { headers: { authorization } });
      assert.equal(galleryResponse.status, 200);
      const gallery = await galleryResponse.json(); assert.equal(gallery.length, 4);
      for (const upload of gallery) assert.equal((await fetch(baseUrl + '/api/records/uploads/' + upload.id + '/content', { headers: { authorization } })).status, 200);
      const dashboardResponse = await fetch(baseUrl + '/api/dashboard', { headers: { authorization } });
      const dashboard = await dashboardResponse.json();
      const attributedCost = await costController.analyse(user);
      assert.ok(Math.abs(dashboard.metrics.usedPctSum - attributedCost.summary.attributedUsedPct) < 1e-6);
      assert.equal(dashboard.metrics.equivalentWindows, dashboard.metrics.usedPctSum / 100);
      assert.ok(Math.abs(dashboard.projects.reduce((sum, project) => sum + project.usageSharePct, 0) - 100) < 1e-6);

      // Failed first pairs leave only one pinned alert and files; the same names
      // can be uploaded again with new IDs after the parser has been improved.
      const failureProject = await repo(e.ProjectEntity).save({ ownerId: owner.id, name: 'Synthetic failure recovery', storageFolder: 'synthetic-failure-recovery', color: '#9BE15D' });
      let failureRoot = await ensureProjectFolders(failureProject);
      const uploadPair = async (startBytes, endBytes) => {
        const form = new FormData(); form.append('projectId', failureProject.id); form.append('mode', 'SEGMENT');
        form.append('start', new Blob([startBytes], { type: 'image/png' }), 'A51.png');
        form.append('end', new Blob([endBytes], { type: 'image/png' }), 'B51.png');
        const response = await fetch(baseUrl + '/api/records/batch', { method: 'POST', headers: { authorization }, body: form });
        assert.equal(response.status, 201);
      };
      const failedAlerts = async (auth = authorization) => {
        const response = await fetch(baseUrl + '/api/notifications/ocr-failures', { headers: { authorization: auth } });
        assert.equal(response.status, 200);
        return (await response.json()).filter((alert) => alert.project?.id === failureProject.id);
      };
      const processMember = async (role, remaining, valid = true) => {
        const member = await repo(e.UploadEntity).findOneByOrFail({ projectId: failureProject.id, role });
        await repo(e.UploadEntity).update(member.id, { status: 'PROCESSING' });
        await processUpload(fakeWorker(remaining, valid), member);
      };
      await uploadPair(a, b);
      await processMember('START', 80, false);
      assert.equal(await repo(e.UsageRecordEntity).countBy({ projectId: failureProject.id }), 0);
      assert.equal(await repo(e.UploadEntity).countBy({ projectId: failureProject.id }), 0);
      assert.equal((await fs.readdir(path.join(failureRoot, 'unprocessed'))).length, 2);
      let alerts = await failedAlerts(); assert.equal(alerts.length, 1);
      const debugResponse = await fetch(baseUrl + '/api/notifications/ocr-failures/debug', { headers: { authorization } });
      assert.equal(debugResponse.status, 200);
      const debugReport = await debugResponse.json();
      assert.deepEqual(Object.keys(debugReport).slice(0, 2), ['immagini_infette', 'logs_errori']);
      const failedPairDebug = debugReport.logs_errori.filter((item) => item.progetto_id === failureProject.id);
      assert.deepEqual(failedPairDebug.map((item) => item.immagine).sort(), ['A51.png', 'B51.png']);
      assert.ok(failedPairDebug.every((item) => item.file_disponibile));
      assert.ok(failedPairDebug.some((item) => item.tentativi.some((attempt) => attempt.log.some((event) => event.code === 'TIMESTAMP_NO_AGREEMENT'))));
      assert.ok(failedPairDebug.some((item) => item.stato === 'PAIR_BLOCKED'));
      assert.ok(!JSON.stringify(debugReport).includes('unreadable'));
      const foreignDebug = await fetch(baseUrl + '/api/notifications/ocr-failures/debug', { headers: { authorization: 'Bearer ' + registered.accessToken } });
      assert.equal(foreignDebug.status, 200);
      assert.deepEqual((await foreignDebug.json()).immagini_infette, []);
      assert.equal((await fetch(baseUrl + '/api/notifications/ocr-failures/debug')).status, 401);
      assert.equal((await fetch(baseUrl + '/api/notifications/ocr-failures/retry', { method: 'POST' })).status, 401);
      const foreignRetry = await fetch(baseUrl + '/api/notifications/ocr-failures/retry', { method: 'POST', headers: { authorization: 'Bearer ' + registered.accessToken } });
      assert.equal(foreignRetry.status, 201);
      assert.equal((await foreignRetry.json()).queued, 0);
      assert.equal(await repo(e.UploadEntity).countBy({ projectId: failureProject.id }), 0);
      assert.equal(alerts[0].recordId, null); assert.equal(alerts[0].fileAvailable, true);
      assert.deepEqual(alerts[0].files.sort(), ['A51.png', 'B51.png']);
      assert.equal((await failedAlerts('Bearer ' + registered.accessToken)).length, 0);
      await recoverOcrFailures(ds);
      assert.equal((await failedAlerts()).length, 1);
      // Repeating a failed first attempt must update its alert rather than add
      // dangling archive entries or another notification for the same pair.
      await uploadPair(a, b); await processMember('END', 60, false);
      assert.equal((await failedAlerts()).length, 1);
      assert.equal(await repo(e.UploadEntity).countBy({ projectId: failureProject.id }), 0);
      const repeatedDebug = await fetch(baseUrl + '/api/notifications/ocr-failures/debug', { headers: { authorization } });
      const repeatedImage = (await repeatedDebug.json()).logs_errori.find((item) => item.progetto_id === failureProject.id && item.stato === 'MANUAL_REVIEW');
      assert.ok(repeatedImage.tentativi.length >= 2);
      Object.assign(failureProject, await projectController.update(user, failureProject.id, { name: 'Renamed synthetic failure' }));
      failureRoot = await ensureProjectFolders(failureProject);
      alerts = await failedAlerts(); assert.equal(alerts[0].fileAvailable, true);
      assert.ok(alerts[0].project.folder.includes('renamed-synthetic-failure'));
      const renamedDebug = await fetch(baseUrl + '/api/notifications/ocr-failures/debug', { headers: { authorization } });
      assert.ok((await renamedDebug.json()).logs_errori.filter((item) => item.progetto_id === failureProject.id).every((item) => item.file_disponibile));
      const retryRequest = () => fetch(baseUrl + '/api/notifications/ocr-failures/retry', { method: 'POST', headers: { authorization } });
      const retryResponse = await retryRequest(); assert.equal(retryResponse.status, 201);
      assert.ok((await retryResponse.json()).queued >= 1);
      assert.equal(await repo(e.UploadEntity).countBy({ projectId: failureProject.id, status: 'UPLOADED' }), 2);
      assert.equal((await failedAlerts()).length, 1); // No premature dismissal.
      const queuedInputs = (await fs.readdir(path.join(failureRoot, 'to-process'))).sort();
      const repeatRetry = await retryRequest(); assert.equal((await repeatRetry.json()).queued, 0);
      assert.deepEqual((await fs.readdir(path.join(failureRoot, 'to-process'))).sort(), queuedInputs);
      await processMember('START', 80); await processMember('END', 60);
      assert.equal(await repo(e.UsageRecordEntity).countBy({ projectId: failureProject.id }), 1);
      assert.equal((await failedAlerts()).length, 0);

      // The new A must not replace the previous accepted A until B also passes.
      const acceptedRecord = await repo(e.UsageRecordEntity).findOneByOrFail({ projectId: failureProject.id });
      const acceptedUploads = await repo(e.UploadEntity).find({ where: { projectId: failureProject.id }, order: { role: 'ASC' } });
      const acceptedSnapshots = JSON.stringify(await repo(e.UsageSnapshotEntity).find({ where: acceptedUploads.map((upload) => ({ uploadId: upload.id })), order: { uploadId: 'ASC' } }));
      const acceptedFiles = await Promise.all(acceptedUploads.map((upload) => fs.readFile(resolveStoredFile(upload.storageKey))));
      const [newA, newB] = await Promise.all([png('#aabbcc'), png('#bbccdd')]);
      await uploadPair(newA, newB);
      await processMember('START', 70);
      assert.equal(JSON.stringify(await repo(e.UsageSnapshotEntity).find({ where: acceptedUploads.map((upload) => ({ uploadId: upload.id })), order: { uploadId: 'ASC' } })), acceptedSnapshots);
      for (let index = 0; index < acceptedUploads.length; index++) assert.ok((await fs.readFile(resolveStoredFile(acceptedUploads[index].storageKey))).equals(acceptedFiles[index]));
      await processMember('END', 40, false);
      assert.equal((await repo(e.UsageRecordEntity).findOneByOrFail({ projectId: failureProject.id })).id, acceptedRecord.id);
      assert.equal(JSON.stringify(await repo(e.UsageSnapshotEntity).find({ where: acceptedUploads.map((upload) => ({ uploadId: upload.id })), order: { uploadId: 'ASC' } })), acceptedSnapshots);
      for (let index = 0; index < acceptedUploads.length; index++) {
        const restored = await repo(e.UploadEntity).findOneByOrFail({ id: acceptedUploads[index].id });
        assert.equal(restored.status, 'VALIDATED'); assert.equal(restored.storageKey, acceptedUploads[index].storageKey);
        assert.ok((await fs.readFile(resolveStoredFile(restored.storageKey))).equals(acceptedFiles[index]));
      }
      assert.equal((await failedAlerts()).length, 1);
      await recoverOcrFailures(ds); assert.equal((await failedAlerts()).length, 1);
      const retryAccepted = await retryRequest(); assert.ok((await retryAccepted.json()).queued >= 1);
      assert.equal(JSON.stringify(await repo(e.UsageSnapshotEntity).find({ where: acceptedUploads.map((upload) => ({ uploadId: upload.id })), order: { uploadId: 'ASC' } })), acceptedSnapshots);
      await processMember('START', 70); await processMember('END', 40);
      assert.equal((await failedAlerts()).length, 0);
      assert.equal(await repo(e.UsageRecordEntity).countBy({ projectId: failureProject.id }), 1);
      const updatedA = await repo(e.UploadEntity).findOneByOrFail({ projectId: failureProject.id, role: 'START' });
      assert.equal(Number((await repo(e.UsageSnapshotEntity).findOneByOrFail({ uploadId: updatedA.id })).fiveHourUsedPct), 30);
      assert.ok((await fs.readFile(resolveStoredFile(updatedA.storageKey))).equals(newA));

      // Names are unique within an owner, including simultaneous requests and
      // renames. Other owners get independent UUID roots for the same name.
      const createProject = (name, auth = authorization) => fetch(baseUrl + '/api/projects', { method: 'POST', headers: { authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const concurrent = await Promise.all([createProject('Cliente Èlite'), createProject('cliente-elite')]);
      assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
      assert.equal((await createProject('CLIENTE ELITE', 'Bearer ' + registered.accessToken)).status, 201);
      const clash = await fetch(baseUrl + '/api/projects/' + browserProject.id, { method: 'PATCH', headers: { authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'cliente elite' }) });
      assert.equal(clash.status, 409);
      assert.equal((await repo(e.ProjectEntity).findOneByOrFail({ id: browserProject.id })).name, 'Browser pairs');

      // Migrate an old UUID root into a readable root that contains only the
      // separate legacy photos; preserve image bytes and deleted manifests.
      const migrationProject = await repo(e.ProjectEntity).save({ ownerId: owner.id, name: 'Readable migration', color: '#9BE15D' });
      const oldFolder = 'readable-migration--' + migrationProject.id.slice(0, 8);
      const oldRoot = path.join(process.env.UPLOAD_DIR, oldFolder);
      await fs.mkdir(path.join(oldRoot, 'processed'), { recursive: true });
      await fs.writeFile(path.join(oldRoot, 'processed', 'fake.png'), a);
      const migrationUpload = await repo(e.UploadEntity).save({ ownerId: owner.id, projectId: migrationProject.id, role: 'SINGLE', originalName: 'migration.png', storageKey: oldFolder + '/processed/fake.png', mime: 'image/png', size: a.length, status: 'DRAFT' });
      const manifestFolder = path.join(oldRoot, 'deleted', randomUUID()); await fs.mkdir(manifestFolder, { recursive: true });
      await fs.writeFile(path.join(manifestFolder, 'manifest.json'), JSON.stringify({ files: [{ storageKey: oldFolder + '/processed/fake.png' }] }));
      await fs.mkdir(path.join(process.env.UPLOAD_DIR, 'readable-migration', 'to-process-img'), { recursive: true });
      const retired = await repo(e.ProjectEntity).save({ ownerId: owner.id, name: 'Retired automatic', deletedAt: new Date(), color: '#9BE15D' });
      await repo(e.ProjectEntity).save({ ownerId: anotherOwner.id, name: 'Retired automatic', deletedAt: new Date(), color: '#9BE15D' });
      await migrateOwnedProjectFolders(ds);
      assert.equal((await repo(e.ProjectEntity).findOne({ where: { id: retired.id }, withDeleted: true })).storageFolder, null);
      assert.equal((await createProject('Retired automatic')).status, 409);
      const migratedProject = await repo(e.ProjectEntity).findOneByOrFail({ id: migrationProject.id });
      assert.ok(migratedProject.storageFolder.endsWith('/readable-migration--' + migrationProject.id));
      const migratedUpload = await repo(e.UploadEntity).findOneByOrFail({ id: migrationUpload.id });
      assert.equal(migratedUpload.storageKey, migratedProject.storageFolder + '/processed/fake.png');
      assert.ok((await fs.readFile(resolveStoredFile(migratedUpload.storageKey))).equals(a));
      const movedManifest = await fs.readFile(path.join(process.env.UPLOAD_DIR, migratedProject.storageFolder, 'deleted', path.basename(manifestFolder), 'manifest.json'), 'utf8');
      assert.equal(JSON.parse(movedManifest).files[0].storageKey, migratedProject.storageFolder + '/processed/fake.png');
      await assert.rejects(fs.access(oldRoot), { code: 'ENOENT' });

      // Legacy duplicate notices are not OCR errors. Existing files are queued
      // and overwrite snapshots; deleted files stay idle without new alerts.
      const duplicateReason = 'Immagine già registrata; nessun nuovo snapshot creato.';
      await repo(e.UploadEntity).update(migrationUpload.id, { status: 'MANUAL_REVIEW', reviewReason: duplicateReason });
      await repo(e.OcrFailureNotificationEntity).save({ ownerId: owner.id, projectId: migrationProject.id, uploadId: migrationUpload.id, originalName: 'migration.png', files: ['migration.png'], storageKey: migratedUpload.storageKey, reason: duplicateReason });
      await recoverOcrFailures(ds);
      assert.equal((await repo(e.UploadEntity).findOneByOrFail({ id: migrationUpload.id })).status, 'UPLOADED');
      assert.equal(await repo(e.OcrFailureNotificationEntity).countBy({ projectId: migrationProject.id, resolvedAt: appRequire('typeorm').IsNull() }), 0);
      await processQueued(80);
      await repo(e.UploadEntity).update(migrationUpload.id, { status: 'MANUAL_REVIEW', reviewReason: duplicateReason });
      const afterDuplicate = await repo(e.UploadEntity).findOneByOrFail({ id: migrationUpload.id });
      await fs.unlink(resolveStoredFile(afterDuplicate.storageKey));
      await recoverOcrFailures(ds);
      assert.equal((await repo(e.UploadEntity).findOneByOrFail({ id: migrationUpload.id })).status, 'DRAFT');

      // Old purged notices have no safe partner ID. Never pair arbitrary files
      // by listing order; preserve both files and explain the missing reference.
      const orphanProject = await repo(e.ProjectEntity).save({ ownerId: owner.id, name: 'Legacy orphan pair', storageFolder: 'legacy-orphan-pair', color: '#9BE15D' });
      const orphanRoot = await ensureProjectFolders(orphanProject), orphanId = randomUUID(), unknownPartner = randomUUID();
      const orphanKey = `legacy-orphan-pair/unprocessed/${orphanId}.png`;
      await fs.writeFile(resolveStoredFile(orphanKey), a);
      await fs.writeFile(path.join(orphanRoot, 'unprocessed', unknownPartner + '.png'), b);
      const orphanNotice = await repo(e.OcrFailureNotificationEntity).save({ ownerId: owner.id, projectId: orphanProject.id, uploadId: orphanId,
        originalName: 'B91.png', pairNumber: '91', files: ['A91.png', 'B91.png'], storageKey: orphanKey, reason: 'Historical failure' });
      const orphanRetry = await retryRequest();
      assert.ok((await orphanRetry.json()).issues.some((item) => item.notificationId === orphanNotice.id && item.code === 'RETRY_PAIR_REFERENCE_MISSING'));
      assert.equal(await repo(e.UploadEntity).countBy({ projectId: orphanProject.id }), 0);
      assert.ok((await fs.readFile(resolveStoredFile(orphanKey))).equals(a));
      assert.ok((await fs.readFile(path.join(orphanRoot, 'unprocessed', unknownPartner + '.png'))).equals(b));
      // A saved choice may reconcile two recognized models for a failed pair,
      // without pretending the OCR read the chosen model in both screenshots.
      const choiceProject = await (await createProject('Manual model choice')).json();
      const choiceImages = async () => {
        const images = [];
        for (const [name, role, data] of [['A77.png', 'START', a], ['B77.png', 'END', b]]) {
          const filePath = resolveStoredFile(`${choiceProject.storageFolder}/to-process/${randomUUID()}.png`);
          await fs.writeFile(filePath, data); images.push({ filePath, originalName: name, role, mime: 'image/png', size: data.length });
        }
        return importRecord(ds, choiceProject, images, null, true);
      };
      const processChoicePair = async () => {
        for (const upload of await repo(e.UploadEntity).findBy({ projectId: choiceProject.id, status: 'UPLOADED' })) {
          await processUpload(fakeWorker(upload.role === 'END' ? 60 : 80, true, upload.role === 'END' ? 'GPT-6 Astra Alto' : 'GPT-5.6 Sol Alto'), upload);
        }
      };
      await choiceImages(); await processChoicePair();
      const choiceNotices = await fetch(baseUrl + '/api/notifications/ocr-failures', { headers: { authorization } }).then((response) => response.json());
      const choiceNotice = choiceNotices.find((notice) => notice.project.id === choiceProject.id);
      assert.ok(choiceNotice, 'The discordant pair must leave a pinned alert');
      assert.equal(choiceNotice.modelOptions.length, 2); assert.equal(choiceNotice.modelChoice, null);
      assert.equal(await repo(e.UsageRecordEntity).countBy({ projectId: choiceProject.id }), 0);
      const solChoice = choiceNotice.modelOptions.find((option) => option.name === 'GPT-5.6 Sol');
      const astraChoice = choiceNotice.modelOptions.find((option) => option.name === 'GPT-6 Astra');
      const choiceRequest = (modelId, auth = authorization) => fetch(baseUrl + `/api/notifications/ocr-failures/${choiceNotice.id}/model-choice`, { method: 'PATCH', headers: { authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId }) });
      assert.equal((await choiceRequest(solChoice.id, 'Bearer ' + registered.accessToken)).status, 404);
      assert.equal((await choiceRequest(randomUUID())).status, 400);
      assert.equal((await choiceRequest(solChoice.id)).status, 200);
      assert.equal(await repo(e.UsageRecordEntity).countBy({ projectId: choiceProject.id }), 0); // Saving alone never queues or validates.
      await retryRequest();
      const choiceQueue = await repo(e.UploadEntity).findBy({ projectId: choiceProject.id }); assert.equal(choiceQueue.length, 2);
      assert.ok(choiceQueue.every((upload) => upload.modelChoice.modelId === solChoice.id));
      assert.equal((await choiceRequest(astraChoice.id)).status, 409);
      await processChoicePair();
      const chosenRecord = await repo(e.UsageRecordEntity).findOneByOrFail({ projectId: choiceProject.id }); assert.equal(chosenRecord.status, 'VALIDATED');
      const chosenUploads = await repo(e.UploadEntity).findBy({ projectId: choiceProject.id }); assert.ok(chosenUploads.every((upload) => upload.modelId === solChoice.id));
      const chosenSnapshots = await repo(e.UsageSnapshotEntity).findBy({ uploadId: appRequire('typeorm').In(chosenUploads.map((upload) => upload.id)) });
      assert.equal(chosenSnapshots.length, 2); assert.ok(chosenSnapshots.every((snapshot) => snapshot.validation.modelSource === 'USER_CHOICE'));
      assert.deepEqual(new Set(chosenSnapshots.map((snapshot) => snapshot.validation.ocrModelId)), new Set([solChoice.id, astraChoice.id]));
      assert.ok((await repo(e.OcrFailureNotificationEntity).findOneByOrFail({ id: choiceNotice.id })).resolvedAt);
      const chosenCosts = await fetch(baseUrl + '/api/cost-analysis?projectId=' + choiceProject.id, { headers: { authorization } }).then((response) => response.json());
      assert.equal(chosenCosts.items[0].modelSource, 'USER_CHOICE'); assert.ok(chosenCosts.items[0].estimatedCost > 0);
      // Even a later open mismatch cannot alter an already assigned tag.
      await repo(e.OcrFailureNotificationEntity).update(choiceNotice.id, { resolvedAt: null });
      assert.equal((await choiceRequest(astraChoice.id)).status, 409);
      assert.ok((await repo(e.UploadEntity).findBy({ projectId: choiceProject.id })).every((upload) => upload.modelId === solChoice.id));
    } finally { await app.close(); }
    console.log('PASS: CSV startup sync, price recalculation, stable OCR tags, available-only analyses, atomic rollback, idempotence, new-account catalog, folder/deleted workflows and explicit pair model choices.');
  } finally {
    if (ds?.isInitialized) await ds.destroy();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    if (root.startsWith('/tmp/ai_usage_evo3_test_')) await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
