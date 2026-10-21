// Disposable database and invented bytes only. No real screenshots are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire('/app/package.json');
const { Client } = req('pg');
(async () => {
  const admin = new Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
  const database = 'ai_usage_reset_test_' + randomUUID().replaceAll('-', '');
  const root = path.join('/tmp', database); let ds, app;
  await admin.query(`CREATE DATABASE "${database}"`);
  try {
    const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + database;
    process.env.DATABASE_URL = url.toString(); process.env.UPLOAD_DIR = path.join(root, 'projects');
    ds = require('/app/dist/database').AppDataSource; await ds.initialize(); await ds.runMigrations();
    const e = require('/app/dist/entities'); const repo = (type) => ds.getRepository(type);
    const { importRecord } = require('/app/dist/inbox');
    const { archiveOcrFailure, settleFailedPair } = require('/app/dist/ocr-failures');
    const { resetOcrFailures, recoverOcrResets } = require('/app/dist/ocr-reset');
    const { writeSignedStorage } = require('/app/dist/storage-identity');
    const { resolveStoredFile } = require('/app/dist/storage');
    const { AppModule } = require('/app/dist/app.module');
    const { ModelCatalogService } = require('/app/dist/model-catalog');
    app = await req('@nestjs/core').NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api');
    await app.get(ModelCatalogService).loadAndSync(); await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    const register = async (email) => { const r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'invented-reset-password', displayName: 'Invented reset' }) }); assert.equal(r.status, 201); return r.json(); };
    const a = await register('reset-a@example.invalid'), b = await register('reset-b@example.invalid');
    const request = (account, suffix, method = 'GET', body) => fetch(base + '/api/' + suffix, { method, headers: { authorization: 'Bearer ' + account.accessToken, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const project = async (account, name) => { const r = await request(account, 'projects', 'POST', { name }); assert.equal(r.status, 201); return r.json(); };
    const pa = await project(a, 'Reset test'), pb = await project(b, 'Reset test');
    const importImages = async (project, names) => {
      const images = [];
      for (const name of names) {
        const filePath = resolveStoredFile(`${project.storageFolder}/to-process/${randomUUID()}.png`);
        await fs.writeFile(filePath, 'invented image ' + randomUUID());
        images.push({ filePath, originalName: name, role: names.length === 1 ? 'SINGLE' : name.startsWith('A') ? 'START' : 'END', mime: 'image/png', size: 1 });
      }
      return importRecord(ds, project, images, null, true);
    };
    const fail = async (project, names) => {
      const record = await importImages(project, names);
      const upload = await repo(e.UploadEntity).findOneByOrFail({ recordId: record.id });
      await archiveOcrFailure(ds, upload.id, 'Invented failed OCR', 'MANUAL_REVIEW');
      if (names.length === 2) await settleFailedPair(ds, record.id);
      else await repo(e.UsageRecordEntity).update(record.id, { status: 'MANUAL_REVIEW' });
      return { record, upload };
    };
    const pair = await fail(pa, ['A1.png', 'B1.png']);
    const single = await fail(pa, ['single.png']);
    const foreign = await fail(pb, ['A1.png', 'B1.png']);
    const valid = await importImages(pa, ['previous.png']);
    let accepted = await repo(e.UploadEntity).findOneByOrFail({ recordId: valid.id });
    const model = await repo(e.AiModelEntity).findOneByOrFail({ ownerId: a.user.id, catalogAvailable: true });
    const acceptedKey = `${pa.storageFolder}/processed/${accepted.id}.png`;
    await fs.rename(resolveStoredFile(accepted.storageKey), resolveStoredFile(acceptedKey));
    const acceptedBytes = await fs.readFile(resolveStoredFile(acceptedKey));
    await ds.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.allow_model_tag', 'on', true)");
      await manager.update(e.UploadEntity, accepted.id, { status: 'VALIDATED', storageKey: acceptedKey, modelId: model.id, modelTaggedAt: new Date() });
      await manager.update(e.UsageRecordEntity, valid.id, { status: 'VALIDATED' });
    });
    const snapshot = await repo(e.UsageSnapshotEntity).save({ uploadId: accepted.id, capturedAt: new Date('2026-10-20T08:00:00Z'), fiveHourRemainingPct: 80, fiveHourUsedPct: 20, fiveHourResetsAt: new Date('2026-10-20T12:00:00Z'), weeklyRemainingPct: 80, weeklyUsedPct: 20, weeklyResetsOn: '2026-10-25', ocrConfidence: 95, validation: { invented: true } });
    const snapshotBefore = await repo(e.UsageSnapshotEntity).findOneByOrFail({ id: snapshot.id });
    await fail(pa, ['previous.png']);
    const validPair = await importImages(pa, ['A2.png', 'B2.png']);
    const acceptedPair = await repo(e.UploadEntity).findBy({ recordId: validPair.id });
    const pairBytes = [];
    for (const upload of acceptedPair) {
      const storageKey = `${pa.storageFolder}/processed/${upload.id}.png`;
      await fs.rename(resolveStoredFile(upload.storageKey), resolveStoredFile(storageKey));
      pairBytes.push({ storageKey, data: await fs.readFile(resolveStoredFile(storageKey)) });
      await ds.transaction(async (manager) => {
        await manager.query("SELECT set_config('app.allow_model_tag', 'on', true)");
        await manager.update(e.UploadEntity, upload.id, { status: 'VALIDATED', storageKey, modelId: model.id });
      });
      await repo(e.UsageSnapshotEntity).save({ ...snapshot, id: undefined, uploadId: upload.id });
    }
    await repo(e.UsageRecordEntity).update(validPair.id, { status: 'VALIDATED' });
    await fail(pa, ['A2.png', 'B2.png']);
    // Old unreferenced partner and previous attempts must also disappear.
    const orphan = resolveStoredFile(pa.storageFolder + '/unprocessed/' + randomUUID() + '.png'); await fs.writeFile(orphan, 'invented orphan');
    const noticesBefore = await repo(e.OcrFailureNotificationEntity).countBy({ ownerId: a.user.id });
    const filesBefore = (await fs.readdir(resolveStoredFile(pa.storageFolder + '/unprocessed'))).sort();
    assert.equal((await fetch(base + '/api/notifications/ocr-failures/reset', { method: 'POST' })).status, 401);
    // Refuse a reset while a retry is in flight, without deleting anything.
    await repo(e.UploadEntity).update(single.upload.id, { status: 'PROCESSING' });
    assert.equal((await request(a, 'notifications/ocr-failures/reset', 'POST')).status, 409);
    assert.equal(await repo(e.OcrFailureNotificationEntity).countBy({ ownerId: a.user.id }), noticesBefore);
    await repo(e.UploadEntity).update(single.upload.id, { status: 'MANUAL_REVIEW' });
    // Inject a failure after a staged move: SQL and image files must roll back.
    const originalRename = fs.rename; let staged = 0;
    fs.rename = async (from, to) => { if (to.includes('/.ocr-reset/') && ++staged === 2) throw Object.assign(new Error('INVENTED_MOVE_FAILURE'), { code: 'EIO' }); return originalRename(from, to); };
    try { await assert.rejects(resetOcrFailures(ds, a.user.id), /INVENTED_MOVE_FAILURE/); } finally { fs.rename = originalRename; }
    assert.equal(await repo(e.OcrFailureNotificationEntity).countBy({ ownerId: a.user.id }), noticesBefore);
    assert.deepEqual((await fs.readdir(resolveStoredFile(pa.storageFolder + '/unprocessed'))).sort(), filesBefore);
    const response = await request(a, 'notifications/ocr-failures/reset', 'POST'); assert.equal(response.status, 201);
    const result = await response.json(); assert.equal(result.notifications, noticesBefore); assert.equal(result.preservedReadings, 3); assert.ok(result.images >= 7);
    assert.equal(await repo(e.OcrFailureNotificationEntity).countBy({ ownerId: a.user.id }), 0);
    assert.deepEqual((await request(a, 'notifications/ocr-failures/debug').then((r) => r.json())).immagini_infette, []);
    assert.deepEqual(await fs.readdir(resolveStoredFile(pa.storageFolder + '/unprocessed')), []);
    assert.equal(await repo(e.UploadEntity).findOneBy({ id: single.upload.id }), null);
    assert.equal(await repo(e.UsageRecordEntity).findOneBy({ id: single.record.id }), null);
    assert.equal(await repo(e.UsageRecordEntity).findOneBy({ id: pair.record.id }), null);
    assert.ok((await fs.readFile(resolveStoredFile(acceptedKey))).equals(acceptedBytes));
    assert.deepEqual(await repo(e.UsageSnapshotEntity).findOneByOrFail({ id: snapshot.id }), snapshotBefore);
    accepted = await repo(e.UploadEntity).findOneByOrFail({ id: accepted.id }); assert.equal(accepted.status, 'VALIDATED'); assert.equal(accepted.storageKey, acceptedKey); assert.equal(accepted.modelId, model.id); assert.equal(accepted.priorUpload, null);
    assert.equal((await repo(e.UsageRecordEntity).findOneByOrFail({ id: valid.id })).status, 'VALIDATED');
    assert.equal((await repo(e.UsageRecordEntity).findOneByOrFail({ id: validPair.id })).status, 'VALIDATED');
    for (const image of pairBytes) assert.ok((await fs.readFile(resolveStoredFile(image.storageKey))).equals(image.data));
    assert.equal(await repo(e.UsageSnapshotEntity).count(), 3);
    assert.equal(await repo(e.OcrFailureNotificationEntity).countBy({ ownerId: b.user.id }), 1);
    assert.ok((await fs.readdir(resolveStoredFile(pb.storageFolder + '/unprocessed'))).length === 2);
    assert.equal((await request(a, 'notifications/ocr-failures/retry', 'POST').then((r) => r.json())).queued, 0);
    assert.deepEqual(await request(a, 'notifications/ocr-failures/reset', 'POST').then((r) => r.json()), { notifications: 0, images: 0, records: 0, preservedReadings: 0 });
    await importImages(pa, ['A1.png', 'B1.png']); await importImages(pa, ['single.png']); // Same names are reusable.
    assert.equal(await repo(e.UsageRecordEntity).countBy({ ownerId: a.user.id }), 4);
    // Startup recovery restores an interrupted transaction, then purges a
    // committed reset, using only signed journals and exact retained keys.
    const foreignNotice = await repo(e.OcrFailureNotificationEntity).findOneByOrFail({ ownerId: b.user.id });
    const foreignKey = foreignNotice.storageKey, job = resolveStoredFile('.ocr-reset/' + randomUUID());
    const manifest = { ownerId: b.user.id, noticeIds: [foreignNotice.id], files: [foreignKey] };
    await writeSignedStorage(path.join(job, 'manifest.json'), 'ocr-failure-reset-v1', manifest); await fs.rename(resolveStoredFile(foreignKey), path.join(job, '0'));
    await recoverOcrResets(ds); assert.ok(await fs.stat(resolveStoredFile(foreignKey)));
    await writeSignedStorage(path.join(job, 'manifest.json'), 'ocr-failure-reset-v1', manifest); await fs.rename(resolveStoredFile(foreignKey), path.join(job, '0'));
    await repo(e.OcrFailureNotificationEntity).delete(foreignNotice.id); await recoverOcrResets(ds);
    await assert.rejects(fs.stat(job), { code: 'ENOENT' });
    console.log('PASS: reset failed pairs/singles, remove orphan files and diagnostics, preserve valid reread, owner isolation, busy guard, rollback, restart recovery, idempotence and reupload.');
  } finally {
    if (app) await app.close(); if (ds?.isInitialized) await ds.destroy();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); await admin.end();
    if (root.startsWith('/tmp/ai_usage_reset_test_')) await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
