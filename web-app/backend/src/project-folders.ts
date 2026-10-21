import { BadRequestException, ConflictException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { ProjectEntity, UserEntity } from './entities';
import { ensureProjectFolders, ownedProjectFolder, projectSlug, resolveStoredFile, uploadDir } from './storage';
import { persistProjectManifest } from './project-manifest';

export async function claimProjectName(manager: EntityManager, ownerId: string, name: string, excludeId?: string) {
  if (!name.trim()) throw new BadRequestException('Inserisci un nome progetto.');
  const folder = projectSlug(name);
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`project-name:${ownerId}:${folder}`]);
  if (['demo', 'incoming'].includes(folder) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(folder)) throw new BadRequestException('Nome progetto riservato: scegli un nome diverso.');
  const existing = await manager.find(ProjectEntity, { where: { ownerId }, withDeleted: true });
  if (existing.some((p) => p.id !== excludeId && projectSlug(p.name) === folder)) {
    throw new ConflictException('Nome progetto già usato: scegli un nome diverso.');
  }
  return folder;
}

// All paths in SQL and deletion manifests move with the physical directory.
// Roll back directory moves and manifest edits if the SQL transaction fails.
export async function moveProjectFolder(manager: EntityManager, id: string, from: string, to: string) {
  const moved: Array<{ from: string; to: string }> = [];
  const manifests: Array<{ file: string; original: string }> = [];
  const undo = async () => {
    for (const item of [...manifests].reverse()) await fs.writeFile(item.file, item.original);
    for (const item of [...moved].reverse()) await fs.rename(item.to, item.from);
  };
  try {
    if (from !== to) {
      const oldRoot = resolveStoredFile(from), nextRoot = resolveStoredFile(to);
      await fs.mkdir(path.dirname(nextRoot), { recursive: true });
      for (const target of [oldRoot, nextRoot, path.dirname(nextRoot)]) {
        try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('INVALID_PROJECT_DIRECTORY'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      let oldExists = true, nextExists = true;
      try { await fs.access(oldRoot); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') oldExists = false; else throw e; }
      try { await fs.access(nextRoot); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') nextExists = false; else throw e; }
      const legacyPhotos = oldExists && (await fs.readdir(oldRoot)).some((name) => ['to-process-img', 'processed-images'].includes(name));
      if (oldExists && !nextExists && !legacyPhotos) { await fs.rename(oldRoot, nextRoot); moved.push({ from: oldRoot, to: nextRoot }); }
      else if (oldExists) {
        await fs.mkdir(nextRoot, { recursive: true });
        // Independent HTML OCR photos stay in their original root.
        for (const entry of await fs.readdir(oldRoot, { withFileTypes: true })) {
          if (['to-process-img', 'processed-images'].includes(entry.name)) continue;
          if (!['to-process', 'processed', 'unprocessed', 'deleted', '.project.json'].includes(entry.name) || entry.isSymbolicLink()) throw new Error('PROJECT_FOLDER_MERGE_UNSAFE');
          const target = path.join(nextRoot, entry.name);
          try { await fs.access(target); throw new Error('PROJECT_FOLDER_COLLISION'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
          const origin = path.join(oldRoot, entry.name); await fs.rename(origin, target); moved.push({ from: origin, to: target });
        }
      }
      const prefix = from + '/';
      await manager.query(`UPDATE uploads SET storage_key=$2 || substring(storage_key FROM length($3)+1) WHERE project_id=$1 AND left(storage_key,length($3))=$3`, [id, to + '/', prefix]);
      await manager.query(`UPDATE uploads SET prior_upload=jsonb_set(prior_upload,'{storageKey}',to_jsonb($2 || substring(prior_upload->>'storageKey' FROM length($3)+1))) WHERE project_id=$1 AND left(prior_upload->>'storageKey',length($3))=$3`, [id, to + '/', prefix]);
      await manager.query(`UPDATE ocr_failure_notifications SET storage_key=$2 || substring(storage_key FROM length($3)+1) WHERE project_id=$1 AND left(storage_key,length($3))=$3`, [id, to + '/', prefix]);
      const deleted = path.join(nextRoot, 'deleted');
      let folders: string[] = [];
      try { folders = await fs.readdir(deleted); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      for (const folder of folders) {
        if (!/^[0-9a-f-]{36}$/i.test(folder)) continue;
        const file = path.join(deleted, folder, 'manifest.json');
        let original: string;
        try { original = await fs.readFile(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
        const manifest = JSON.parse(original);
        for (const item of manifest.files) if (item.storageKey.startsWith(prefix)) item.storageKey = to + '/' + item.storageKey.slice(prefix.length);
        manifests.push({ file, original }); await fs.writeFile(file, JSON.stringify(manifest, null, 2));
      }
    }
    return { undo, finish: async () => { if (from !== to) await fs.rmdir(resolveStoredFile(from)).catch(() => undefined); } };
  } catch (error) { await undo(); throw error; }
}

export async function migrateOwnedProjectFolders(source: DataSource) {
  const projects = await source.getRepository(ProjectEntity).find({ withDeleted: true, order: { createdAt: 'ASC' } });
  for (const project of projects) {
    // Retired projects keep their historical references and reserved names.
    // In particular, old auto-created "Generale" entries must not be reopened
    // or materialized again while migrating the active application projects.
    if (project.deletedAt && !project.storageFolder) continue;
    const user = await source.getRepository(UserEntity).findOne({ where: { id: project.ownerId }, withDeleted: true });
    if (!user) continue;
    const folder = ownedProjectFolder(user.storageOwnerId, project.id, project.name);
    if (folder === project.storageFolder) { await persistProjectManifest(project, user.storageOwnerId); continue; }
    let operation: Awaited<ReturnType<typeof moveProjectFolder>> | undefined;
    try {
      await source.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [project.id]);
        const previous = project.storageFolder ?? `${projectSlug(project.name)}--${project.id.slice(0, 8)}`;
        operation = await moveProjectFolder(manager, project.id, previous, folder);
        await manager.update(ProjectEntity, project.id, { storageFolder: folder });
      });
    } catch (error) { if (operation) await operation.undo(); throw error; }
    if (operation) await operation.finish();
    project.storageFolder = folder;
    await ensureProjectFolders(project);
    await persistProjectManifest(project, user.storageOwnerId);
  }
}
