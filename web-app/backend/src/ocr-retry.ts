import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, IsNull } from 'typeorm';
import { AuditEventEntity, OcrFailureNotificationEntity, ProjectEntity, UploadEntity } from './entities';
import { ImportImage, importRecord, pairIdentity, planPairs } from './inbox';
import { ensureProjectFolders, projectFolderName, resolveStoredFile } from './storage';
import { logOcr, makeAttempt, OcrTrace, technicalOcrError } from './ocr-diagnostics';

// Rebuild a failed attempt from retained references, never from directory order,
// filename similarity or another project's images. Old purged pairs without a
// retained partner cannot be guessed and require a fresh A/B upload once.
export async function retryOcrFailures(source: DataSource, ownerId: string) {
  const lock = source.createQueryRunner(); await lock.connect();
  let acquired = false;
  const result = { queued: 0, skipped: 0, busy: false, issues: [] as Array<{ notificationId: string; code: string; reason: string }> };
  try {
    acquired = (await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [`ocr-retry:${ownerId}`]))[0].acquired;
    if (!acquired) return { ...result, busy: true };
    const notices = await source.getRepository(OcrFailureNotificationEntity).find({ where: { ownerId, resolvedAt: IsNull() }, order: { createdAt: 'ASC' } });
    for (const notice of notices) {
      const temporary: string[] = [];
      try {
        const project = await source.getRepository(ProjectEntity).findOneBy({ id: notice.projectId, ownerId });
        if (!project) throw new Error('RETRY_PROJECT_UNAVAILABLE');
        const members = (await source.getRepository(UploadEntity).findBy({ ownerId, projectId: project.id, ...(notice.recordId ? { recordId: notice.recordId } : {}) }))
          .filter((upload) => notice.recordId || (notice.pairNumber ? upload.role !== 'SINGLE' && pairIdentity(upload.originalName)?.number === notice.pairNumber : upload.id === notice.uploadId || upload.originalName.toLowerCase() === notice.originalName.toLowerCase()));
        if (members.some((member) => ['UPLOADED', 'PROCESSING'].includes(member.status))) { result.skipped++; continue; }
        const names = notice.pairNumber ? notice.files : [notice.originalName];
        if (notice.pairNumber && (names.length !== 2 || planPairs(names).pairs.length !== 1)) throw new Error('RETRY_PAIR_REFERENCE_MISSING');
        const root = await ensureProjectFolders(project);
        const images: ImportImage[] = [];
        for (const originalName of names) {
          const priorAttempt = [...(notice.diagnostics ?? [])].reverse().find((attempt) => attempt.originalName === originalName && attempt.status !== 'RETRY_UNAVAILABLE');
          const member = members.find((upload) => upload.originalName.toLowerCase() === originalName.toLowerCase()
            || (notice.pairNumber && upload.role === pairIdentity(originalName)?.role));
          let key = priorAttempt ? `${projectFolderName(project)}/unprocessed/${path.basename(priorAttempt.storageKey)}`
            : member ? `${projectFolderName(project)}/unprocessed/${member.id}${path.extname(originalName).toLowerCase()}`
              : originalName === notice.originalName ? notice.storageKey : null;
          if (!key) throw new Error('RETRY_PAIR_REFERENCE_MISSING');
          try { await fs.access(resolveStoredFile(key)); }
          catch { if (!priorAttempt && member?.status === 'VALIDATED') key = member.storageKey; else throw new Error('RETRY_IMAGE_UNAVAILABLE'); }
          const from = resolveStoredFile(key);
          const stat = await fs.lstat(from);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('RETRY_IMAGE_UNAVAILABLE');
          const destination = path.join(root, 'to-process', `retry-${randomUUID()}${path.extname(originalName).toLowerCase()}`);
          await fs.copyFile(from, destination); temporary.push(destination);
          images.push({ filePath: destination, originalName, role: notice.pairNumber ? pairIdentity(originalName)!.role : 'SINGLE',
            mime: /\.png$/i.test(originalName) ? 'image/png' : /\.webp$/i.test(originalName) ? 'image/webp' : 'image/jpeg', size: stat.size });
        }
        await importRecord(source, project, images, null, true);
        temporary.length = 0; // The queue now owns these private input copies.
        result.queued++;
        await source.getRepository(AuditEventEntity).save({ ownerId, action: 'OCR_FAILURE_RETRY_QUEUED', entityType: 'ocr_failure_notification', entityId: notice.id,
          metadata: { projectId: project.id, pairNumber: notice.pairNumber, imageCount: images.length } });
      } catch (error) {
        for (const file of temporary) await fs.unlink(file).catch(() => {});
        const code = technicalOcrError(error).code;
        const reason = code === 'RETRY_PAIR_REFERENCE_MISSING' ? 'Vecchio tentativo senza riferimenti completi alla coppia: ricarica A e B dalla UI una volta.'
          : code === 'RETRY_IMAGE_UNAVAILABLE' ? 'Una delle immagini non è disponibile in unprocessed.'
            : code === 'RETRY_PROJECT_UNAVAILABLE' ? 'Il progetto non è più disponibile.' : 'Tentativo non accodato. Consulta Debug per il codice tecnico.';
        result.issues.push({ notificationId: notice.id, code, reason });
        const trace: OcrTrace = []; logOcr(trace, 'retry', 'error', code);
        const diagnostic = makeAttempt({ id: notice.uploadId, originalName: notice.originalName, role: notice.pairNumber ? pairIdentity(notice.originalName)?.role ?? 'UNKNOWN' : 'SINGLE' }, notice.storageKey, 'RETRY_UNAVAILABLE', trace);
        await source.query('UPDATE ocr_failure_notifications SET diagnostics=diagnostics || $2::jsonb WHERE id=$1 AND owner_id=$3 AND resolved_at IS NULL', [notice.id, JSON.stringify([diagnostic]), ownerId]);
      }
    }
    return result;
  } finally {
    if (acquired) await lock.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`ocr-retry:${ownerId}`]);
    await lock.release();
  }
}
