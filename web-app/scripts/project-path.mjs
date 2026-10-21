import path from 'node:path';
import { promises as fs } from 'node:fs';

const uuid = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
export function projectFolderParts(folder) {
  if (typeof folder !== 'string' || !new RegExp(`^${uuid}/[a-z0-9][a-z0-9-]{0,39}--${uuid}$`, 'i').test(folder)) throw new Error('Cartella progetto non valida.');
  return folder.split('/');
}
export async function pickerInbox(projectsRoot, folder) {
  const segments = projectFolderParts(folder);
  const root = path.resolve(projectsRoot);
  let current = root;
  for (const segment of [...segments, 'to-process']) {
    current = path.resolve(current, segment);
    if (!current.startsWith(root + path.sep)) throw new Error('Cartella progetto non valida.');
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Cartella progetto non valida.');
  }
  if (!(await fs.realpath(current)).startsWith((await fs.realpath(root)) + path.sep)) throw new Error('Cartella progetto non valida.');
  return current;
}
