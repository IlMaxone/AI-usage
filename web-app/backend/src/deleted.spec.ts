import { promises as fs } from 'node:fs';
import path from 'node:path';
import { archiveImages, restoreArchive } from './deleted';
import { uploadDir } from './storage';
import { randomUUID } from 'node:crypto';

describe('archivio deleted', () => {
  const key = `_test-${randomUUID()}`;
  const root = path.join(uploadDir, key);
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('conserva i file e può annullare lo spostamento se la transazione fallisce', async () => {
    await fs.mkdir(path.join(root, 'processed'), { recursive: true });
    await fs.writeFile(path.join(root, 'processed', 'technical.png'), 'invented screenshot');
    const archive = await archiveImages(path.join(root, 'deleted', 'record'), [{
      id: randomUUID(), storageKey: `${key}/processed/technical.png`, originalName: 'A1.png', role: 'START',
    }]);
    expect(await fs.readFile(path.join(archive.directory, 'A1.png'), 'utf8')).toBe('invented screenshot');
    await expect(fs.access(path.join(root, 'processed', 'technical.png'))).rejects.toThrow();
    await restoreArchive(archive);
    expect(await fs.readFile(path.join(root, 'processed', 'technical.png'), 'utf8')).toBe('invented screenshot');
  });
});
