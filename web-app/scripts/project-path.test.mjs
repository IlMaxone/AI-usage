import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { projectFolderParts, pickerInbox } from './project-path.mjs';
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
test('UUID utente e progetto, nessun attraversamento o percorso condiviso', () => {
  assert.deepEqual(projectFolderParts(`${owner}/gfp--${project}`), [owner, `gfp--${project}`]);
  for (const value of ['gfp', `${owner}/../gfp`, `${owner}\\gfp--${project}`, `other/gfp--${project}`, `${owner}/gfp--${project}/processed`]) assert.throws(() => projectFolderParts(value));
});
test('il selettore usa solo la cartella completa già creata dall’app', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-usage-picker-'));
  try {
    const folder = `${owner}/gfp--${project}`, inbox = path.join(root, folder, 'to-process');
    await fs.mkdir(inbox, { recursive: true });
    assert.equal(await pickerInbox(root, folder), inbox);
    await fs.rmdir(inbox);
    await assert.rejects(pickerInbox(root, folder));
  } finally {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('ai-usage-picker-')) throw new Error('INVALID_TEST_CLEANUP_PATH');
    await fs.rm(root, { recursive: true, force: true });
  }
});
