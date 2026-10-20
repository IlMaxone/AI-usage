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
    const project = await repo(e.ProjectEntity).save({ ownerId: owner.id, modelId: null, name: 'Synthetic EVO3', color: '#9BE15D' });
    const projectRoot = await ensureProjectFolders(project);
    const png = (color) => sharp({ create: { width: 1280, height: 800, channels: 3, background: color } }).png().toBuffer();
    const [a, b] = await Promise.all([png('#eeeeee'), png('#dddddd')]);
    const deposit = async (name, data) => {
      const file = path.join(projectRoot, 'to-process', name);
      await fs.writeFile(file, data); const old = new Date(Date.now() - 3000); await fs.utimes(file, old, old); return file;
    };
    const fakeWorker = (remaining, valid = true, label = 'GPT-5.6 Sol Alto') => ({
      setParameters: async () => {},
      recognize: async () => ({ data: { text: valid ? `10:00:00 20/10/2026 5h ${remaining}% 15:00 Settimanale 60% 25 ott ${label}` : 'unreadable', confidence: 96 } }),
    });
    const processQueued = async (remaining, valid = true) => {
      for (const upload of await repo(e.UploadEntity).findBy({ status: 'UPLOADED' })) {
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

    // Reinsert only A: the already processed B remains the same partner.
    await deposit('A1.png', a);
    assert.equal((await scanProjectInbox(ds, project)).imported, 1);
    await processQueued(70);
    assert.equal(await repo(e.UsageRecordEntity).count(), 1);
    assert.equal(await repo(e.UsageSnapshotEntity).count(), 2);
    assert.equal((await ds.query('SELECT count(*)::int AS n FROM ocr_revisions'))[0].n, 1);
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

    // A failed reread stays in the inbox, keeps its old snapshot and does not loop.
    await deposit('A1.png', a);
    assert.equal((await scanProjectInbox(ds, project)).imported, 1);
    await processQueued(70, false);
    assert.ok((await fs.readdir(path.join(projectRoot, 'to-process'))).includes('A1.png'));
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
    assert.equal((await costController.analyse(user)).summary.estimatedUsageMinutes, oldAnalysis.summary.estimatedUsageMinutes);
    const changedCsv = rateOnlyCsv.replace('135:24', '93:03').replace('67:42', '40:08');
    await fs.writeFile(process.env.MODEL_CATALOG_PATH, changedCsv);
    await catalog.loadAndSync();
    const updatedModel = await repo(e.AiModelEntity).findOneByOrFail({ id: model.id });
    assert.equal(updatedModel.pricing.costPerMinute, 0.125);
    assert.equal(updatedModel.pricing.maxTimeWindowMinutes, 93.05);
    const newAnalysis = await costController.analyse(user);
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
      const authorization = 'Bearer ' + app.get(JwtService).sign({ sub: owner.id });
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
    } finally { await app.close(); }
    console.log('PASS: CSV startup sync, price recalculation, stable OCR tags, available-only analyses, atomic rollback, idempotence, new-account catalog, folder and deleted workflows.');
  } finally {
    if (ds?.isInitialized) await ds.destroy();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    if (root.startsWith('/tmp/ai_usage_evo3_test_')) await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
