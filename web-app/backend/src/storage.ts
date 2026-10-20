import path from 'node:path';

export const uploadDir = process.env.UPLOAD_DIR ?? path.resolve('../../projects');
export const incomingDir = path.join(uploadDir, '_incoming');

export function projectFolderName(project: { id: string; name: string }): string {
  const slug = project.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'progetto';
  return `${slug}--${project.id.slice(0, 8)}`;
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

export async function ensureProjectFolders(project: { id: string; name: string }) {
  const { promises: fs } = await import('node:fs');
  const root = path.join(uploadDir, projectFolderName(project));
  await fs.mkdir(path.join(root, 'to-process'), { recursive: true });
  await fs.mkdir(path.join(root, 'processed'), { recursive: true });
  await fs.mkdir(path.join(root, 'deleted'), { recursive: true });
  const realBase = await fs.realpath(uploadDir);
  for (const directory of [root, path.join(root, 'to-process'), path.join(root, 'processed'), path.join(root, 'deleted')]) {
    if (!(await fs.realpath(directory)).startsWith(realBase + path.sep)) throw new Error('INVALID_PROJECT_DIRECTORY');
  }
  return root;
}
