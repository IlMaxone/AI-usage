import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, QueryFailedError } from 'typeorm';
import { AuditEventEntity, ProjectEntity, UserEntity } from './entities';
import { claimProjectName, moveProjectFolder } from './project-folders';
import { persistProjectManifest, readProjectManifest } from './project-manifest';
import { ensureProjectFolders, ownedProjectFolder, projectSlug, resolveStoredFile, uploadDir } from './storage';

export async function recoverUserProjects(source: DataSource, ownerId: string) {
  const user = await source.getRepository(UserEntity).findOneBy({ id: ownerId });
  if (!user) return 0;
  const namespace = resolveStoredFile(user.storageOwnerId);
  let entries;
  try {
    if ((await fs.lstat(namespace)).isSymbolicLink()) throw new Error('INVALID_STORAGE_OWNER_DIRECTORY');
    entries = await fs.readdir(namespace, { withFileTypes: true });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  let recovered = 0;
  await source.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`project-recovery:${ownerId}`]);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const folder = `${user.storageOwnerId}/${entry.name}`;
      try {
        const item = await readProjectManifest(path.join(namespace, entry.name, '.project.json'), user.storageOwnerId, folder);
        if (!item || item.deletedAt) continue;
        const existing = await manager.findOne(ProjectEntity, { where: { id: item.id }, withDeleted: true });
        if (existing) continue; // Never reassign ownership or reopen a deleted row.
        const normalizedName = await claimProjectName(manager, ownerId, item.name);
        await manager.save(ProjectEntity, { id: item.id, ownerId, modelId: null, name: item.name, normalizedName, color: item.color, storageFolder: folder });
        await manager.insert(AuditEventEntity, { ownerId, action: 'PROJECT_RECOVERED_FROM_FOLDER', entityType: 'project', entityId: item.id,
          metadata: { signedManifest: true, usageRestored: false } });
        recovered++;
      } catch (error) {
        // A corrupt/foreign manifest must not expose another user's pictures.
        // Do not print its content, account identifiers or filesystem secrets.
        if (error instanceof QueryFailedError) throw error;
        console.error('PROJECT_FOLDER_RECOVERY_REQUIRES_REVIEW');
      }
    }
  });
  return recovered;
}

export async function recoverProjectFolders(source: DataSource) {
  for (const user of await source.getRepository(UserEntity).find()) await recoverUserProjects(source, user.id);
}

// Local operator-only migration. There is deliberately no HTTP endpoint that
// lets an account claim unowned legacy roots. The caller must select the owner.
export async function adoptLegacyProjectFolder(source: DataSource, ownerId: string, folder: string, displayName = folder) {
  if (folder !== projectSlug(folder) || ['demo', 'incoming'].includes(folder)) throw new Error('INVALID_LEGACY_PROJECT_FOLDER');
  const name = displayName.trim();
  if (!name || name.length > 100) throw new Error('INVALID_LEGACY_PROJECT_NAME');
  const user = await source.getRepository(UserEntity).findOneByOrFail({ id: ownerId });
  const root = resolveStoredFile(folder), stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('INVALID_LEGACY_PROJECT_FOLDER');
  if (!(await fs.readdir(root)).some((name) => ['to-process', 'processed', 'unprocessed', 'deleted'].includes(name))) throw new Error('LEGACY_APP_FOLDER_NOT_FOUND');
  let operation: Awaited<ReturnType<typeof moveProjectFolder>> | undefined;
  let targetFolder: string | undefined;
  let project: ProjectEntity;
  try {
    project = await source.transaction(async (manager) => {
      const normalizedName = await claimProjectName(manager, ownerId, name);
      const id = randomUUID(), storageFolder = ownedProjectFolder(user.storageOwnerId, id, name);
      targetFolder = storageFolder;
      operation = await moveProjectFolder(manager, id, folder, storageFolder);
      const created = await manager.save(ProjectEntity, { id, ownerId, modelId: null, name, normalizedName, storageFolder, color: '#9BE15D' });
      await persistProjectManifest(created, user.storageOwnerId);
      await manager.insert(AuditEventEntity, { ownerId, action: 'LEGACY_PROJECT_FOLDER_ADOPTED', entityType: 'project', entityId: id,
        metadata: { explicitLocalOwnerSelection: true, usageRestored: false } });
      return created;
    });
  } catch (error) {
    if (targetFolder) await fs.unlink(resolveStoredFile(targetFolder + '/.project.json')).catch(() => undefined);
    if (operation) await operation.undo(); throw error;
  }
  await operation?.finish(); await ensureProjectFolders(project);
  return project;
}
