import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, In, IsNull } from 'typeorm';
import { OcrFailureNotificationEntity, ProjectEntity, UploadEntity, UsageRecordEntity, UsageSnapshotEntity } from './entities';
import { pairIdentity } from './inbox';
import { ensureProjectFolders, projectFolderName, relativeStorageKey, resolveStoredFile } from './storage';
import { readSignedStorage, writeSignedStorage, isStorageUuid } from './storage-identity';

interface ResetJournal { ownerId: string; noticeIds: string[]; files: string[] }
const journalPurpose = 'ocr-failure-reset-v1';
const exists = async (file: string) => { try { await fs.lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } };

// Files are staged before SQL commit. A restart can restore a rolled-back reset
// or finish erasing a committed reset, without retaining a second image archive.
async function finishReset(source: DataSource, directory: string, journal: ResetJournal) {
  const rolledBack = await source.getRepository(OcrFailureNotificationEntity).existsBy({ ownerId: journal.ownerId, id: In(journal.noticeIds) });
  for (const [index, key] of journal.files.entries()) {
    const staged = path.join(directory, String(index));
    if (!await exists(staged)) continue;
    if (rolledBack) {
      const original = resolveStoredFile(key);
      if (await exists(original)) throw new Error('OCR_RESET_RECOVERY_COLLISION');
      await fs.mkdir(path.dirname(original), { recursive: true }); await fs.rename(staged, original);
    } else await fs.unlink(staged);
  }
  await fs.unlink(path.join(directory, 'manifest.json')); await fs.rmdir(directory);
}

export async function recoverOcrResets(source: DataSource) {
  const base = resolveStoredFile('.ocr-reset');
  if (!await exists(base)) return;
  if ((await fs.lstat(base)).isSymbolicLink()) throw new Error('INVALID_OCR_RESET_DIRECTORY');
  for (const entry of await fs.readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !isStorageUuid(entry.name)) throw new Error('INVALID_OCR_RESET_DIRECTORY');
    const directory = path.join(base, entry.name);
    const journal = await readSignedStorage<ResetJournal>(path.join(directory, 'manifest.json'), journalPurpose);
    if (!journal) { await fs.rmdir(directory); continue; } // No image is moved before the manifest exists.
    if (!isStorageUuid(journal.ownerId) || !Array.isArray(journal.noticeIds) || !journal.noticeIds.length || !journal.noticeIds.every(isStorageUuid)
      || !Array.isArray(journal.files) || !journal.files.every((key) => typeof key === 'string' && !key.startsWith('.'))) throw new Error('INVALID_OCR_RESET_MANIFEST');
    await finishReset(source, directory, journal);
  }
}

export async function resetOcrFailures(source: DataSource, ownerId: string) {
  let directory: string | undefined, journal: ResetJournal | undefined;
  const result = { notifications: 0, images: 0, records: 0, preservedReadings: 0 };
  try {
    await source.transaction(async (manager) => {
      const lock = await manager.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [`ocr-retry:${ownerId}`]);
      if (!lock[0].acquired) throw new ConflictException('Preparazione OCR in corso. Attendi prima di usare Reset.');
      const notices = await manager.find(OcrFailureNotificationEntity, { where: { ownerId, resolvedAt: IsNull() } });
      if (!notices.length) return;
      const files = new Set<string>(), purgeUploads: string[] = [], purgeRecords: string[] = [], related = new Set<string>();
      const retained = new Set<string>();
      const projectIds = [...new Set(notices.map((notice) => notice.projectId))].sort();
      for (const projectId of projectIds) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [projectId]);
        const project = await manager.findOne(ProjectEntity, { where: { id: projectId, ownerId }, withDeleted: true });
        if (!project) throw new ConflictException('Progetto non disponibile. Reset non eseguito.');
        await ensureProjectFolders(project);
        const folder = projectFolderName(project), group = notices.filter((notice) => notice.projectId === projectId);
        const uploads = await manager.getRepository(UploadEntity).createQueryBuilder('u').where('u.owner_id=:ownerId AND u.project_id=:projectId', { ownerId, projectId }).setLock('pessimistic_write').getMany();
        const selected = uploads.filter((upload) => group.some((notice) => upload.id === notice.uploadId || (notice.recordId && upload.recordId === notice.recordId)
          || notice.diagnostics.some((attempt) => attempt.uploadId === upload.id)
          || (notice.pairNumber && upload.role !== 'SINGLE' && pairIdentity(upload.originalName)?.number === notice.pairNumber)));
        // Include the entire record, never leave half of a failed A/B pair.
        const recordIds = new Set(selected.map((upload) => upload.recordId).filter((id): id is string => !!id));
        const members = uploads.filter((upload) => selected.includes(upload) || (upload.recordId && recordIds.has(upload.recordId)));
        if (members.some((upload) => ['UPLOADED', 'PROCESSING'].includes(upload.status))) throw new ConflictException('OCR in coda o in corso. Attendi il completamento prima di usare Reset.');
        const snapshots = members.length ? await manager.findBy(UsageSnapshotEntity, { uploadId: In(members.map((upload) => upload.id)) }) : [];
        for (const upload of members) {
          related.add(upload.id);
          const snapshot = snapshots.find((item) => item.uploadId === upload.id);
          if (snapshot) {
            const accepted = typeof upload.priorUpload?.storageKey === 'string' ? upload.priorUpload.storageKey
              : upload.storageKey.includes('/processed/') ? upload.storageKey : `${folder}/processed/${upload.id}${path.extname(upload.originalName).toLowerCase()}`;
            if (!accepted.startsWith(folder + '/processed/') || !await exists(resolveStoredFile(accepted))) throw new ConflictException('Immagine valida precedente non disponibile. Reset non eseguito.');
            retained.add(accepted);
            if (upload.storageKey !== accepted) files.add(upload.storageKey);
            await manager.update(UploadEntity, upload.id, { storageKey: accepted, status: 'VALIDATED', reviewReason: null, pendingOcr: null, priorUpload: null, modelTagOnly: false,
              modelChoice: snapshot.validation.modelSource === 'USER_CHOICE' ? snapshot.validation.modelChoice as UploadEntity['modelChoice'] : null,
              ...(typeof upload.priorUpload?.processedAt === 'string' ? { processedAt: new Date(upload.priorUpload.processedAt) } : {}),
              ...(typeof upload.priorUpload?.sha256 === 'string' ? { sha256: upload.priorUpload.sha256 } : {}),
              ...(typeof upload.priorUpload?.originalName === 'string' ? { originalName: upload.priorUpload.originalName } : {}) });
            result.preservedReadings++;
          } else {
            purgeUploads.push(upload.id); files.add(upload.storageKey);
            if (upload.recordId) purgeRecords.push(upload.recordId);
          }
        }
        for (const recordId of recordIds) {
          if (purgeRecords.includes(recordId) && members.some((upload) => upload.recordId === recordId && snapshots.some((snapshot) => snapshot.uploadId === upload.id))) throw new ConflictException('Rilevazione parzialmente convalidata: richiede verifica prima del reset.');
          if (!purgeRecords.includes(recordId)) await manager.update(UsageRecordEntity, recordId, { status: 'VALIDATED' });
        }
        // Includes orphan partners from historical alerts with incomplete IDs,
        // and backup files left by repeated failed attempts. Never traverse links.
        for (const subfolder of ['unprocessed', 'processed']) {
          for (const entry of await fs.readdir(resolveStoredFile(`${folder}/${subfolder}`), { withFileTypes: true })) {
            if (subfolder === 'processed' && !purgeUploads.some((id) => entry.name.startsWith(id + '.'))) continue;
            if (!entry.isFile() || entry.isSymbolicLink()) throw new ConflictException('File o cartella non sicuri: Reset non eseguito.');
            files.add(`${folder}/${subfolder}/${entry.name}`);
          }
        }
        for (const notice of group) {
          related.add(notice.id); related.add(notice.uploadId);
          for (const attempt of notice.diagnostics) related.add(attempt.uploadId);
        }
      }
      const noticeIds = notices.map((notice) => notice.id);
      // Remove resolved history of the same failed pair/single as well.
      const history = await manager.findBy(OcrFailureNotificationEntity, { ownerId });
      const deletedNotices = history.filter((item) => notices.some((notice) => item.projectId === notice.projectId
        && (item.id === notice.id || item.uploadId === notice.uploadId || (notice.pairNumber && item.pairNumber === notice.pairNumber))));
      for (const item of deletedNotices) related.add(item.id);
      await manager.query("SELECT set_config('app.allow_usage_purge', 'on', true)");
      await manager.query('DELETE FROM ocr_failure_notifications WHERE owner_id=$1 AND id=ANY($2::uuid[])', [ownerId, deletedNotices.map((item) => item.id)]);
      await manager.query(`DELETE FROM audit_events WHERE owner_id=$1 AND
        ((entity_id=ANY($2::uuid[]) AND (action LIKE '%FAILURE%' OR action IN ('OCR_PAIR_ALERT_ONLY','OCR_PAIR_PREVIOUS_RESTORED','OCR_REPLACEMENT_REQUESTED','OCR_PAIR_MODEL_CHOSEN')))
        OR (entity_type='usage_record' AND NOT EXISTS(SELECT 1 FROM usage_records WHERE id=audit_events.entity_id)))`, [ownerId, [...related]]);
      if (purgeUploads.length) {
        const purgeIds = [...new Set([...purgeUploads, ...purgeRecords])];
        const observations = await manager.query(`SELECT id FROM usage_snapshots WHERE upload_id=ANY($1::uuid[]) UNION ALL SELECT id FROM usage_corrections WHERE upload_id=ANY($1::uuid[]) UNION ALL SELECT id FROM capture_time_observations WHERE upload_id=ANY($1::uuid[])`, [purgeUploads]) as Array<{ id: string }>;
        await manager.query('DELETE FROM audit_events WHERE owner_id=$1 AND entity_id=ANY($2::uuid[])', [ownerId, [...purgeIds, ...observations.map((item) => item.id)]]);
        await manager.query('UPDATE usage_records SET single_upload_id=NULL,start_upload_id=NULL,end_upload_id=NULL WHERE owner_id=$1 AND id=ANY($2::uuid[])', [ownerId, purgeRecords]);
        await manager.query('UPDATE usage_events SET start_upload_id=NULL WHERE owner_id=$1 AND start_upload_id=ANY($2::uuid[])', [ownerId, purgeUploads]);
        await manager.query('UPDATE usage_events SET end_upload_id=NULL WHERE owner_id=$1 AND end_upload_id=ANY($2::uuid[])', [ownerId, purgeUploads]);
        await manager.query('DELETE FROM capture_time_observations WHERE upload_id=ANY($1::uuid[])', [purgeUploads]);
        await manager.query('DELETE FROM usage_corrections WHERE upload_id=ANY($1::uuid[])', [purgeUploads]);
        await manager.query('DELETE FROM usage_snapshots WHERE upload_id=ANY($1::uuid[])', [purgeUploads]);
        await manager.delete(UploadEntity, { ownerId, id: In(purgeUploads) });
        await manager.delete(UsageRecordEntity, { ownerId, id: In([...new Set(purgeRecords)]) });
      }
      const candidates = [...files].filter((key) => !retained.has(key));
      // Every target must belong to one of the user's locked project roots.
      const projects = await manager.find(ProjectEntity, { where: { ownerId, id: In(projectIds) }, withDeleted: true });
      for (const key of candidates) if (!projects.some((project) => key.startsWith(projectFolderName(project) + '/') && resolveStoredFile(key).startsWith(resolveStoredFile(projectFolderName(project)) + path.sep))) throw new Error('INVALID_OCR_RESET_FILE');
      const present: string[] = [];
      for (const key of candidates) {
        const file = resolveStoredFile(key);
        if (!await exists(file)) continue;
        const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('INVALID_OCR_RESET_FILE');
        present.push(relativeStorageKey(file));
      }
      const base = resolveStoredFile('.ocr-reset'); await fs.mkdir(base, { recursive: true });
      if ((await fs.lstat(base)).isSymbolicLink()) throw new Error('INVALID_OCR_RESET_DIRECTORY');
      directory = path.join(base, randomUUID()); journal = { ownerId, noticeIds, files: present };
      await writeSignedStorage(path.join(directory, 'manifest.json'), journalPurpose, journal);
      for (const [index, key] of present.entries()) await fs.rename(resolveStoredFile(key), path.join(directory, String(index)));
      result.notifications = deletedNotices.length; result.images = present.length; result.records = new Set(purgeRecords).size;
    });
  } catch (error) {
    if (directory && journal) await finishReset(source, directory, journal);
    throw error;
  }
  if (directory && journal) await finishReset(source, directory, journal);
  return result;
}
