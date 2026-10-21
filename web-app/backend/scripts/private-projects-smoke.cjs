// Uses a disposable database and invented files under /tmp, never real folders.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire('/app/package.json');
const { Client } = req('pg');
(async () => {
  const admin = new Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
  const database = 'ai_usage_private_test_' + randomUUID().replaceAll('-', '');
  const root = path.join('/tmp', database); let ds, app;
  await admin.query(`CREATE DATABASE "${database}"`);
  try {
    const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + database;
    process.env.DATABASE_URL = url.toString(); process.env.UPLOAD_DIR = path.join(root, 'projects');
    const { AppDataSource } = require('/app/dist/database'); ds = AppDataSource; await ds.initialize(); await ds.runMigrations();
    const e = require('/app/dist/entities');
    const { resolveStoredFile } = require('/app/dist/storage');
    const { recoverUserProjects, adoptLegacyProjectFolder } = require('/app/dist/project-recovery');
    const { ModelCatalogService } = require('/app/dist/model-catalog');
    const { readSignedStorage } = require('/app/dist/storage-identity');
    const { AppModule } = require('/app/dist/app.module'); const { NestFactory } = req('@nestjs/core');
    app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api');
    await app.get(ModelCatalogService).loadAndSync(); await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    const register = async (email, password = 'invented-storage-password') => {
      const response = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, displayName: 'Invented owner' }) });
      assert.equal(response.status, 201); return response.json();
    };
    const request = (account, suffix, method = 'GET', body) => fetch(base + '/api/' + suffix, { method,
      headers: { authorization: 'Bearer ' + account.accessToken, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const create = async (account, name) => { const response = await request(account, 'projects', 'POST', { name }); assert.equal(response.status, 201); return response.json(); };
    const list = async (account) => { const response = await request(account, 'projects'); assert.equal(response.status, 200); return response.json(); };
    const repo = (type) => ds.getRepository(type);
    const a = await register('a@example.invalid'), b = await register('b@example.invalid');
    const pa = await create(a, 'GFP'), pb = await create(b, 'GFP');
    assert.notEqual(pa.storageFolder, pb.storageFolder);
    const ua = await repo(e.UserEntity).findOneByOrFail({ id: a.user.id }), ub = await repo(e.UserEntity).findOneByOrFail({ id: b.user.id });
    assert.ok(pa.storageFolder.startsWith(ua.storageOwnerId + '/')); assert.ok(pa.storageFolder.endsWith('--' + pa.id));
    assert.ok(pb.storageFolder.startsWith(ub.storageOwnerId + '/'));
    assert.equal((await request(a, 'projects', 'POST', { name: 'gfp ' })).status, 409);
    assert.equal((await request(b, 'projects/' + pa.id + '/inbox')).status, 404);
    assert.deepEqual((await list(a)).map((p) => p.id), [pa.id]);
    assert.deepEqual((await list(b)).map((p) => p.id), [pb.id]);
    const photo = Buffer.from('invented-private-image-fixture');
    const imageFile = resolveStoredFile(pa.storageFolder + '/processed/private.png'); await fs.writeFile(imageFile, photo);
    const hash = createHash('sha256').update(photo).digest('hex');
    // Removing only the project row simulates missing metadata after a DB reset.
    await ds.query('DELETE FROM projects WHERE id=$1', [pa.id]);
    assert.equal(await recoverUserProjects(ds, b.user.id), 0);
    assert.equal(await recoverUserProjects(ds, a.user.id), 1);
    assert.equal(await recoverUserProjects(ds, a.user.id), 0);
    assert.equal(await repo(e.UsageRecordEntity).count(), 0);
    assert.equal(await repo(e.UploadEntity).count(), 0);
    const renamedResponse = await request(a, 'projects/' + pa.id, 'PATCH', { name: 'Portfolio', color: '#123456' });
    assert.equal(renamedResponse.status, 200); const renamed = await renamedResponse.json();
    assert.ok(renamed.storageFolder.endsWith('/portfolio--' + pa.id));
    assert.equal(createHash('sha256').update(await fs.readFile(resolveStoredFile(renamed.storageFolder + '/processed/private.png'))).digest('hex'), hash);
    assert.equal((await repo(e.ProjectEntity).findOneByOrFail({ id: pb.id })).storageFolder, pb.storageFolder);
    const retired = await create(a, 'Retired');
    assert.equal((await request(a, 'projects/' + retired.id, 'DELETE')).status, 200);
    await ds.query('DELETE FROM projects WHERE id=$1', [retired.id]);
    assert.equal(await recoverUserProjects(ds, a.user.id), 0);
    // Manifests neither store account credentials nor accept unsigned edits.
    const manifestFile = resolveStoredFile(renamed.storageFolder + '/.project.json');
    const manifest = await fs.readFile(manifestFile, 'utf8'); assert.ok(!manifest.includes('a@example.invalid')); assert.ok(!manifest.includes('invented-storage-password'));
    const tampered = JSON.parse(manifest); tampered.payload.color = '#ffffff'; await fs.writeFile(manifestFile, JSON.stringify(tampered));
    await assert.rejects(readSignedStorage(manifestFile, 'project-manifest-v1'), /SIGNATURE_MISMATCH/);
    await fs.writeFile(manifestFile, manifest);
    // Registration after a complete application-data reset only recovers the
    // namespace belonging to the same email AND password, not the first user.
    await ds.query('TRUNCATE users CASCADE');
    const wrong = await register('a@example.invalid', 'different-storage-password');
    assert.deepEqual(await list(wrong), []);
    assert.notEqual((await repo(e.UserEntity).findOneByOrFail({ id: wrong.user.id })).storageOwnerId, ua.storageOwnerId);
    await ds.query('TRUNCATE users CASCADE');
    const restoredA = await register('a@example.invalid'), restoredB = await register('b@example.invalid');
    const restoredProjects = await list(restoredA);
    assert.deepEqual(restoredProjects.map((p) => p.id), [pa.id]);
    assert.equal(restoredProjects[0].name, 'Portfolio'); assert.equal(restoredProjects[0].color, '#123456');
    assert.notEqual(restoredA.user.id, a.user.id);
    assert.equal((await repo(e.UserEntity).findOneByOrFail({ id: restoredA.user.id })).storageOwnerId, ua.storageOwnerId);
    assert.deepEqual((await list(restoredB)).map((p) => p.id), [pb.id]);
    assert.equal((await request(restoredB, 'projects/' + pa.id + '/inbox')).status, 404);
    assert.equal(createHash('sha256').update(await fs.readFile(resolveStoredFile(renamed.storageFolder + '/processed/private.png'))).digest('hex'), hash);
    // Explicit adoption leaves standalone HTML OCR photos in their old root.
    const legacy = path.join(process.env.UPLOAD_DIR, 'legacy-import');
    await fs.mkdir(path.join(legacy, 'to-process'), { recursive: true }); await fs.mkdir(path.join(legacy, 'to-process-img'));
    await fs.writeFile(path.join(legacy, 'to-process', 'A1.png'), photo); await fs.writeFile(path.join(legacy, 'to-process-img', 'historical.png'), photo);
    const adopted = await adoptLegacyProjectFolder(ds, restoredA.user.id, 'legacy-import', 'Legacy Import');
    assert.equal(adopted.name, 'Legacy Import');
    assert.ok((await fs.readFile(resolveStoredFile(adopted.storageFolder + '/to-process/A1.png'))).equals(photo));
    assert.ok((await fs.readFile(path.join(legacy, 'to-process-img/historical.png'))).equals(photo));
    assert.equal((await fs.readdir(legacy)).length, 1);
    assert.equal((await list(restoredB)).length, 1);
    console.log('PASS: per-owner duplicate names, UUID paths, private APIs, signed recovery, reset with same credentials, wrong-identity isolation, tombstones, rename and explicit legacy adoption.');
  } finally {
    if (app) await app.close(); if (ds?.isInitialized) await ds.destroy();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); await admin.end();
    if (root.startsWith('/tmp/ai_usage_private_test_')) await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
