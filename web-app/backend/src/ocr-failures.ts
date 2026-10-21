import { Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { AuthUser, CurrentUser } from './common';
import { AuditEventEntity, OcrFailureNotificationEntity, ProjectEntity, UploadEntity, UsageRecordEntity, UsageSnapshotEntity } from './entities';
import { ensureProjectFolders, projectFolderName, relativeStorageKey, resolveStoredFile } from './storage';
import { pairIdentity } from './inbox';
import { FileMove, moveFile, rollbackMoves } from './file-moves';
import { buildOcrDebugReport, logOcr, makeAttempt, OcrTrace, technicalOcrError } from './ocr-diagnostics';
import { retryOcrFailures } from './ocr-retry';

export const isLegacyDuplicateNotice = (reason: string) => /^Immagine già registrata; nessun nuovo snapshot creato\./i.test(reason.trim());

export async function requeueLegacyDuplicateNotices(source: DataSource) {
  await source.transaction(async (manager) => {
    const notices = await manager.find(OcrFailureNotificationEntity, { where: { resolvedAt: IsNull() } });
    for (const notice of notices.filter((item) => isLegacyDuplicateNotice(item.reason))) {
      await manager.update(OcrFailureNotificationEntity, notice.id, { resolvedAt: new Date() });
    }
    const uploads = await manager.find(UploadEntity, { where: { status: In(['MANUAL_REVIEW', 'FAILED']) } });
    for (const upload of uploads.filter((item) => isLegacyDuplicateNotice(item.reviewReason ?? ''))) {
      let available = false;
      try { await fs.access(resolveStoredFile(upload.storageKey)); available = true; } catch {}
      await manager.update(UploadEntity, upload.id, { status: available ? 'UPLOADED' : 'DRAFT', reviewReason: null, modelTagOnly: false, pendingOcr: null });
      if (upload.recordId) await manager.update(UsageRecordEntity, upload.recordId, { status: available ? 'VALIDATING' : 'DRAFT' });
      await manager.insert(AuditEventEntity, { ownerId: upload.ownerId, action: 'LEGACY_DUPLICATE_REQUEUED', entityType: 'upload', entityId: upload.id, metadata: { duplicateIsNotOcrFailure: true } });
    }
  });
}

export async function resolveOcrFailure(manager: EntityManager, upload: UploadEntity) {
  const number = upload.role === 'SINGLE' ? null : pairIdentity(upload.originalName)?.number ?? null;
  await manager.query(`UPDATE ocr_failure_notifications SET resolved_at=now()
    WHERE owner_id=$1 AND project_id=$2 AND resolved_at IS NULL
    AND (upload_id=$3 OR lower(original_name)=lower($4) OR ($5::text IS NOT NULL AND pair_number=$5))`,
  [upload.ownerId, upload.projectId, upload.id, upload.originalName, number]);
}

// Keep the file move, upload reference and pinned notification consistent.
export async function archiveOcrFailure(source: DataSource, uploadId: string, reason: string,
  status: 'MANUAL_REVIEW' | 'FAILED', sha256?: string, recovery = false, trace: OcrTrace = []) {
  if (isLegacyDuplicateNotice(reason)) { await requeueLegacyDuplicateNotices(source); return; }
  let from = '', destination = '', backup = '', moved = false;
  try {
    await source.transaction(async (manager) => {
      const upload = await manager.findOne(UploadEntity, { where: { id: uploadId }, lock: { mode: 'pessimistic_write' } });
      if (!upload || (recovery && !['MANUAL_REVIEW', 'FAILED'].includes(upload.status))) return;
      const project = await manager.findOne(ProjectEntity, { where: { id: upload.projectId, ownerId: upload.ownerId }, withDeleted: true });
      if (!project) return;
      await ensureProjectFolders(project);
      from = resolveStoredFile(upload.storageKey);
      destination = resolveStoredFile(`${projectFolderName(project)}/unprocessed/${upload.id}${path.extname(upload.originalName).toLowerCase()}`);
      let storageKey = upload.storageKey;
      let message = reason.replace(/[\r\n]/g, ' ').slice(0, 500);
      if (from !== destination) {
        try {
          await fs.access(from);
          try { await fs.access(destination); backup = `${destination}.previous-${randomUUID()}`; await fs.rename(destination, backup); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          await fs.rename(from, destination); moved = true;
          storageKey = relativeStorageKey(destination);
        } catch (error) {
          logOcr(trace, 'archive', 'warning', 'UNPROCESSED_MOVE_FAILED', { cause: technicalOcrError(error).code });
          if (backup && !moved) { await fs.rename(backup, destination); backup = ''; }
          message = `${message} · ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'File sorgente non disponibile.' : 'Spostamento in unprocessed non riuscito.'}`.slice(0, 500);
        }
      }
      await manager.update(UploadEntity, upload.id, {
        status, reviewReason: message, storageKey, processedAt: new Date(), modelTagOnly: false,
        ...(sha256 ? { sha256 } : {}),
      });
      const pairNumber = upload.role === 'SINGLE' ? null : pairIdentity(upload.originalName)?.number ?? null;
      const notification = await manager.findOne(OcrFailureNotificationEntity, { where: pairNumber
        ? { ownerId: upload.ownerId, projectId: upload.projectId, pairNumber, resolvedAt: IsNull() }
        : { uploadId, resolvedAt: IsNull() } });
      const members = upload.recordId ? await manager.findBy(UploadEntity, { recordId: upload.recordId }) : [upload];
      const files = members.map((item) => item.originalName);
      const diagnostics = [...(notification?.diagnostics ?? [])];
      if (!recovery || !notification) {
        const events = [...trace];
        if (!events.length) logOcr(events, 'processing', 'error', recovery ? 'LEGACY_FAILURE' : 'FAILURE_RECORDED', { status });
        logOcr(events, 'archive', 'info', 'FAILURE_PINNED', { fileMoved: moved, status });
        diagnostics.push(makeAttempt(upload, storageKey, status, events, sha256));
        for (const member of members.filter((item) => item.id !== upload.id)) {
          if (member.pendingOcr?.reuseAccepted || (member.status === 'VALIDATED' && !member.pendingOcr && !member.priorUpload)) continue;
          const memberEvents = Array.isArray(member.pendingOcr?.diagnostics) ? [...member.pendingOcr.diagnostics] as OcrTrace : [];
          logOcr(memberEvents, 'pair', 'error', 'PAIR_BLOCKED', { cause: 'OTHER_IMAGE_FAILED' });
          const memberKey = `${projectFolderName(project)}/unprocessed/${member.id}${path.extname(member.originalName).toLowerCase()}`;
          diagnostics.push(makeAttempt(member, memberKey, 'PAIR_BLOCKED', memberEvents, typeof member.pendingOcr?.sha256 === 'string' ? member.pendingOcr.sha256 : undefined));
        }
      }
      if (!notification) await manager.save(OcrFailureNotificationEntity, {
        ownerId: upload.ownerId, projectId: upload.projectId, uploadId, recordId: upload.recordId,
        originalName: upload.originalName, reason: message, pairNumber, files, storageKey, diagnostics,
      });
      else if (!recovery || notification.reason !== message) await manager.save(OcrFailureNotificationEntity, { id: notification.id,
        reason: message, storageKey, files, uploadId, recordId: upload.recordId, originalName: upload.originalName, diagnostics,
      });
      if (!recovery || !notification || moved) await manager.insert(AuditEventEntity, {
        ownerId: upload.ownerId, action: 'OCR_FAILURE_PINNED', entityType: 'upload', entityId: uploadId,
        metadata: { reason: message, unprocessed: storageKey.includes('/unprocessed/'), recovery },
      });
    });
  } catch (error) {
    if (moved) await fs.rename(destination, from);
    if (backup) await fs.rename(backup, destination);
    throw error;
  }
}

export async function recoverOcrFailures(source: DataSource) {
  await requeueLegacyDuplicateNotices(source);
  const uploads = await source.getRepository(UploadEntity).find({ where: { status: In(['MANUAL_REVIEW', 'FAILED']) } });
  for (const upload of uploads) {
    await archiveOcrFailure(source, upload.id, upload.reviewReason ?? 'Lettura OCR non convalidata.', upload.status as 'MANUAL_REVIEW' | 'FAILED', undefined, true);
    if (upload.role !== 'SINGLE' && upload.recordId) await settleFailedPair(source, upload.recordId);
  }
}

// Failed first attempts leave only files and pinned alerts. A failed reread
// restores the previous upload references; the accepted snapshots were never changed.
export async function settleFailedPair(source: DataSource, recordId: string) {
  const moves: FileMove[] = [];
  try {
    await source.transaction(async (manager) => {
      const record = await manager.findOneBy(UsageRecordEntity, { id: recordId });
      if (!record || record.mode !== 'SEGMENT') return;
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [record.projectId]);
      const uploads = await manager.findBy(UploadEntity, { recordId });
      const project = await manager.findOne(ProjectEntity, { where: { id: record.projectId }, withDeleted: true });
      if (!project) return;
      await ensureProjectFolders(project);
      const snapshots = await manager.findBy(UsageSnapshotEntity, { uploadId: In(uploads.map((upload) => upload.id)) });
      const preserved = uploads.length === 2 && snapshots.length === 2 && uploads.every((u) => u.modelId && u.modelId === uploads[0]!.modelId)
        && Math.abs(snapshots[0]!.fiveHourResetsAt.getTime() - snapshots[1]!.fiveHourResetsAt.getTime()) <= 60 * 60_000;
      for (const upload of uploads) {
        const destination = resolveStoredFile(`${projectFolderName(project)}/unprocessed/${upload.id}${path.extname(upload.originalName).toLowerCase()}`);
        // On reread only new input files move; never move the last accepted file.
        const prior = upload.priorUpload;
        const legacyAcceptedPath = `${projectFolderName(project)}/processed/${upload.id}${path.extname(upload.originalName).toLowerCase()}`;
        if (!preserved || prior || upload.pendingOcr || ['MANUAL_REVIEW', 'FAILED'].includes(upload.status)) {
          await moveFile(resolveStoredFile(upload.storageKey), destination, moves, true);
        }
        if (preserved) {
          let storageKey = typeof prior?.storageKey === 'string' ? prior.storageKey : upload.storageKey;
          if (!prior) { try { await fs.access(resolveStoredFile(legacyAcceptedPath)); storageKey = legacyAcceptedPath; } catch {} }
          await manager.update(UploadEntity, upload.id, {
            storageKey, originalName: typeof prior?.originalName === 'string' ? prior.originalName : upload.originalName,
            sha256: typeof prior?.sha256 === 'string' ? prior.sha256 : upload.sha256,
            status: 'VALIDATED', reviewReason: null, pendingOcr: null, priorUpload: null, modelTagOnly: false,
          });
        }
      }
      if (preserved) {
        await manager.update(UsageRecordEntity, recordId, { status: 'VALIDATED' });
      } else {
        const ids = uploads.map((upload) => upload.id);
        await manager.query("SELECT set_config('app.allow_usage_purge', 'on', true)");
        await manager.update(OcrFailureNotificationEntity, { recordId, ownerId: record.ownerId, resolvedAt: IsNull() }, { recordId: null });
        await manager.query('UPDATE usage_records SET single_upload_id=NULL,start_upload_id=NULL,end_upload_id=NULL WHERE id=$1', [recordId]);
        await manager.query('DELETE FROM capture_time_observations WHERE upload_id=ANY($1::uuid[])', [ids]);
        await manager.query('DELETE FROM usage_corrections WHERE upload_id=ANY($1::uuid[])', [ids]);
        await manager.query('DELETE FROM usage_snapshots WHERE upload_id=ANY($1::uuid[])', [ids]);
        await manager.query('DELETE FROM uploads WHERE id=ANY($1::uuid[])', [ids]);
        await manager.delete(UsageRecordEntity, recordId);
      }
      await manager.insert(AuditEventEntity, { ownerId: record.ownerId, action: preserved ? 'OCR_PAIR_PREVIOUS_RESTORED' : 'OCR_PAIR_ALERT_ONLY', entityType: 'usage_record', entityId: recordId,
        metadata: { previousReadingPreserved: preserved, failedAttemptFiles: 'unprocessed' } });
    });
  } catch (error) { await rollbackMoves(moves); throw error; }
}

@Controller('notifications/ocr-failures')
export class OcrFailureNotificationsController {
  constructor(
    @InjectRepository(OcrFailureNotificationEntity) private readonly notifications: Repository<OcrFailureNotificationEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UploadEntity) private readonly uploads: Repository<UploadEntity>,
  ) {}
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.load(user, false);
  }
  @Get('debug')
  async debug(@CurrentUser() user: AuthUser) {
    return buildOcrDebugReport(await this.load(user, true));
  }
  @Post('retry')
  async retry(@CurrentUser() user: AuthUser) {
    return retryOcrFailures(this.notifications.manager.connection, user.id);
  }
  private async load(user: AuthUser, includeDiagnostics: boolean) {
    const notifications = await this.notifications.find({ where: { ownerId: user.id, resolvedAt: IsNull() }, order: { createdAt: 'DESC' } });
    if (!notifications.length) return [];
    const [projects, uploads] = await Promise.all([
      this.projects.find({ where: { ownerId: user.id, id: In([...new Set(notifications.map((n) => n.projectId))]) }, withDeleted: true }),
      this.uploads.find({ where: { ownerId: user.id, id: In(notifications.map((n) => n.uploadId)) } }),
    ]);
    return Promise.all(notifications.map(async (notification) => {
      const project = projects.find((p) => p.id === notification.projectId);
      const upload = uploads.find((u) => u.id === notification.uploadId);
      let fileAvailable = false;
      try { await fs.access(resolveStoredFile(notification.storageKey)); fileAvailable = true; } catch {}
      const { diagnostics, ...summary } = notification;
      const detailed = includeDiagnostics ? await Promise.all((diagnostics ?? []).map(async (attempt) => {
        let available = false;
        const key = project ? `${projectFolderName(project)}/unprocessed/${path.basename(attempt.storageKey)}` : attempt.storageKey;
        try { await fs.access(resolveStoredFile(key)); available = true; } catch {}
        return { ...attempt, fileAvailable: available };
      })) : undefined;
      return { ...summary, ...(includeDiagnostics ? { diagnostics: detailed } : {}), project: project ? { id: project.id, name: project.name, folder: `projects/${projectFolderName(project)}/unprocessed` } : null,
        status: upload?.status ?? 'FAILED', fileAvailable };
    }));
  }
}
