import path from 'node:path';
import type { ProjectEntity } from './entities';
import { ensureProjectFolders, ownedProjectFolder } from './storage';
import { isStorageUuid, readSignedStorage, writeSignedStorage } from './storage-identity';

export interface ProjectManifest {
  version: 1; id: string; namespace: string; name: string; color: string; folder: string; deletedAt: string | null;
}
export async function persistProjectManifest(project: ProjectEntity, namespace: string) {
  const folder = ownedProjectFolder(namespace, project.id, project.name);
  if (project.storageFolder !== folder) throw new Error('PROJECT_MANIFEST_PATH_MISMATCH');
  const root = await ensureProjectFolders(project);
  const payload: ProjectManifest = { version: 1, id: project.id, namespace, name: project.name, color: project.color,
    folder, deletedAt: project.deletedAt?.toISOString() ?? null };
  await writeSignedStorage(path.join(root, '.project.json'), 'project-manifest-v1', payload);
}
export async function readProjectManifest(file: string, namespace: string, folder: string) {
  const item = await readSignedStorage<ProjectManifest>(file, 'project-manifest-v1');
  if (!item) return null;
  if (item.version !== 1 || !isStorageUuid(item.id) || item.namespace !== namespace || typeof item.name !== 'string'
    || !item.name.trim() || item.name.length > 100 || !/^#[a-f0-9]{6}$/i.test(item.color)
    || item.folder !== folder || ownedProjectFolder(namespace, item.id, item.name) !== folder
    || (item.deletedAt !== null && Number.isNaN(Date.parse(item.deletedAt)))) throw new Error('INVALID_PROJECT_MANIFEST');
  return item;
}
