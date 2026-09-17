import path from 'node:path';

export const uploadDir = process.env.UPLOAD_DIR ?? path.resolve('storage/uploads');
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
