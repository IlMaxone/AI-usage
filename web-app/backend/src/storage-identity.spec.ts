import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('identità privata delle cartelle', () => {
  let root: string, previous: string | undefined;
  let identity: typeof import('./storage-identity');
  let storage: typeof import('./storage');
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-usage-storage-test-'));
    previous = process.env.UPLOAD_DIR; process.env.UPLOAD_DIR = root;
    jest.resetModules(); identity = await import('./storage-identity'); storage = await import('./storage');
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previous;
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('ai-usage-storage-test-')) throw new Error('INVALID_TEST_CLEANUP_PATH');
    await fs.rm(root, { recursive: true, force: true });
  });
  it('recupera solo con la stessa identità e non salva email o password', async () => {
    const namespace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await identity.bindStorageOwner({ storageOwnerId: namespace }, 'owner@example.invalid', 'invented-owner-password');
    expect(await identity.recoverStorageOwner(' OWNER@example.invalid ', 'invented-owner-password')).toBe(namespace);
    expect(await identity.recoverStorageOwner('owner@example.invalid', 'different-password')).not.toBe(namespace);
    expect(await identity.recoverStorageOwner('other@example.invalid', 'invented-owner-password')).not.toBe(namespace);
    for (const file of await fs.readdir(path.join(root, '.owners'))) {
      const text = await fs.readFile(path.join(root, '.owners', file), 'utf8');
      expect(text).not.toContain('owner@example.invalid'); expect(text).not.toContain('invented-owner-password');
    }
  });
  it('rifiuta metadati modificati o usati con uno scopo diverso', async () => {
    const file = path.join(root, 'test-manifest.json');
    await identity.writeSignedStorage(file, 'test', { value: 'original' });
    expect(await identity.readSignedStorage(file, 'test')).toEqual({ value: 'original' });
    await expect(identity.readSignedStorage(file, 'other-purpose')).rejects.toThrow('STORAGE_METADATA_SIGNATURE_MISMATCH');
    const value = JSON.parse(await fs.readFile(file, 'utf8')); value.payload.value = 'modified'; await fs.writeFile(file, JSON.stringify(value));
    await expect(identity.readSignedStorage(file, 'test')).rejects.toThrow('STORAGE_METADATA_SIGNATURE_MISMATCH');
  });
  it('rifiuta collegamenti verso un altro spazio utente prima di creare sottocartelle', async () => {
    const target = path.join(root, 'real-owner'), link = path.join(root, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    await fs.mkdir(target); await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(storage.ensureProjectFolders({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Test', storageFolder: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/test--cccccccc-cccc-4ccc-8ccc-cccccccccccc' })).rejects.toThrow('INVALID_PROJECT_DIRECTORY');
    expect(await fs.readdir(target)).toEqual([]);
  });
});
