import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveStoredFile } from './storage';

interface ArchivedFile { originalName: string; storageKey: string; archivedName: string; role: string; missing: boolean }
export interface ImageArchive { directory: string; files: ArchivedFile[] }

export async function restoreArchive(archive: ImageArchive) {
  for (const file of [...archive.files].reverse()) {
    if (file.missing) continue;
    if (path.basename(file.archivedName) !== file.archivedName || file.archivedName.includes('\\')) throw new Error('INVALID_ARCHIVE_NAME');
    const source = path.join(archive.directory, file.archivedName);
    const destination = resolveStoredFile(file.storageKey);
    try { await fs.access(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    try { await fs.access(destination); throw new Error('ARCHIVE_RESTORE_CONFLICT'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(source, destination);
  }
  await fs.unlink(path.join(archive.directory, 'manifest.json')).catch(() => undefined);
  await fs.rmdir(archive.directory).catch(() => undefined);
}

export async function archiveImages(directory: string, uploads: Array<{ id: string; storageKey: string; originalName: string; role: string }>): Promise<ImageArchive> {
  const archive: ImageArchive = { directory, files: [] };
  await fs.mkdir(directory, { recursive: true });
  try {
    const used = new Set(['manifest.json']);
    for (const upload of uploads) {
      let name = path.basename(upload.originalName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180) || upload.id;
      if (used.has(name.toLowerCase())) name = `${upload.id}-${name}`;
      used.add(name.toLowerCase());
      const item: ArchivedFile = { originalName: upload.originalName, storageKey: upload.storageKey, archivedName: name, role: upload.role, missing: false };
      try { await fs.access(resolveStoredFile(upload.storageKey)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; item.missing = true; }
      archive.files.push(item);
    }
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ archivedAt: new Date().toISOString(), files: archive.files }, null, 2));
    for (const file of archive.files) {
      if (!file.missing) await fs.rename(resolveStoredFile(file.storageKey), path.join(directory, file.archivedName));
    }
    return archive;
  } catch (error) { await restoreArchive(archive); throw error; }
}
