import path from 'node:path';

export const uploadDir = process.env.UPLOAD_DIR ?? path.resolve('../../projects');
export const incomingDir = path.join(uploadDir, '_incoming');

export function projectSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'progetto';
}

export function projectFolderName(project: { id: string; name: string; storageFolder?: string | null }): string {
  return project.storageFolder ?? `${projectSlug(project.name).slice(0, 40)}--${project.id}`;
}

export function ownedProjectFolder(namespace: string, id: string, name: string) {
  if (![namespace, id].every((value) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value))) throw new Error('INVALID_PROJECT_OWNER_PATH');
  return `${namespace.toLowerCase()}/${projectSlug(name).slice(0, 40)}--${id.toLowerCase()}`;
}

export function resolveStoredFile(storageKey: string): string {
  const root = path.resolve(uploadDir);
  const filePath = path.resolve(root, storageKey);
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('INVALID_STORAGE_KEY');
  return filePath;
}

export function relativeStorageKey(filePath: string): string {
  return path.relative(path.resolve(uploadDir), filePath).split(path.sep).join('/');
}

export async function ensureProjectFolders(project: { id: string; name: string; storageFolder?: string | null }) {
  const { promises: fs } = await import('node:fs');
  const folder = projectFolderName(project);
  if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)?$/i.test(folder)) throw new Error('INVALID_PROJECT_DIRECTORY');
  const root = resolveStoredFile(folder);
  await fs.mkdir(uploadDir, { recursive: true });
  // Reject links before creating children: a namespace must not redirect to
  // another owner's directory, even when that directory is under uploadDir.
  for (const relative of [folder, ...['to-process', 'processed', 'deleted', 'unprocessed'].map((name) => `${folder}/${name}`)]) {
    let current = path.resolve(uploadDir);
    for (const segment of relative.split('/')) {
      current = path.join(current, segment);
      try { await fs.mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('INVALID_PROJECT_DIRECTORY');
    }
  }
  const realBase = await fs.realpath(uploadDir);
  for (const directory of [root, path.join(root, 'to-process'), path.join(root, 'processed'), path.join(root, 'deleted'), path.join(root, 'unprocessed')]) {
    if (!(await fs.realpath(directory)).startsWith(realBase + path.sep)) throw new Error('INVALID_PROJECT_DIRECTORY');
  }
  return root;
}
