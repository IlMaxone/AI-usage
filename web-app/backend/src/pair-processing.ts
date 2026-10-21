import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import { AiModelEntity, AuditEventEntity, ProjectEntity, UploadEntity, UsageRecordEntity, UsageSnapshotEntity } from './entities';
import { FileMove, discardMoveBackups, moveFile, rollbackMoves } from './file-moves';
import { archiveOcrFailure, resolveOcrFailure, settleFailedPair } from './ocr-failures';
import { ensureProjectFolders, projectFolderName, relativeStorageKey, resolveStoredFile } from './storage';
import { logOcr, OcrTrace } from './ocr-diagnostics';

export interface PendingPairOcr {
  diagnostics?: OcrTrace;
  reuseAccepted?: boolean;
  sha256: string; capturedAt: string; confidence: number; modelId: string;
  usage: { fiveHourUsedPct: number; fiveHourRemainingPct: number; fiveHourResetsAt: string; weeklyUsedPct: number; weeklyRemainingPct: number; weeklyResetsOn: string };
  validation: Record<string, unknown>; modelMatchingPasses: string[];
}

export async function stagePairOcr(source: DataSource, upload: UploadEntity, result: PendingPairOcr) {
  await source.query("UPDATE uploads SET pending_ocr=$2::jsonb, status='PROCESSING' WHERE id=$1", [upload.id, JSON.stringify(result)]);
  const members = await source.getRepository(UploadEntity).findBy({ recordId: upload.recordId! });
  for (const member of members) if (!member.pendingOcr && member.status === 'VALIDATED' && member.modelId && member.sha256) {
    const snapshot = await source.getRepository(UsageSnapshotEntity).findOneBy({ uploadId: member.id });
    if (!snapshot) continue;
    const reused: PendingPairOcr = {
      reuseAccepted: true, sha256: member.sha256, modelId: member.modelId, capturedAt: snapshot.capturedAt.toISOString(), confidence: Number(snapshot.ocrConfidence),
      usage: { fiveHourUsedPct: Number(snapshot.fiveHourUsedPct), fiveHourRemainingPct: Number(snapshot.fiveHourRemainingPct), fiveHourResetsAt: snapshot.fiveHourResetsAt.toISOString(),
        weeklyUsedPct: Number(snapshot.weeklyUsedPct), weeklyRemainingPct: Number(snapshot.weeklyRemainingPct), weeklyResetsOn: snapshot.weeklyResetsOn },
      validation: snapshot.validation, modelMatchingPasses: [],
    };
    member.pendingOcr = reused as unknown as Record<string, unknown>;
    await source.query('UPDATE uploads SET pending_ocr=$2::jsonb WHERE id=$1', [member.id, JSON.stringify(reused)]);
  }
  if (members.length !== 2 || members.some((item) => !item.pendingOcr)) return;
  const results = members.map((item) => item.pendingOcr as unknown as PendingPairOcr);
  if (results[0]!.modelId !== results[1]!.modelId || Math.abs(new Date(results[0]!.usage.fiveHourResetsAt).getTime() - new Date(results[1]!.usage.fiveHourResetsAt).getTime()) > 60 * 60_000) {
    const trace = result.diagnostics ?? [];
    const differentModels = results[0]!.modelId !== results[1]!.modelId;
    const resetOffsetMinutes = Math.abs(new Date(results[0]!.usage.fiveHourResetsAt).getTime() - new Date(results[1]!.usage.fiveHourResetsAt).getTime()) / 60000;
    logOcr(trace, 'pair', 'error', differentModels ? 'PAIR_MODEL_MISMATCH' : 'PAIR_RESET_MISMATCH', {
      modelId: results[0]!.modelId, expectedModelId: results[1]!.modelId, resetOffsetMinutes,
    });
    const models = differentModels ? await source.getRepository(AiModelEntity).findBy({ id: In(results.map((item) => item.modelId)) }) : [];
    const reason = differentModels ? `La coppia contiene modelli/reasoning diversi: ${results.map((item) => {
      const model = models.find((candidate) => candidate.id === item.modelId); return `${model?.name ?? item.modelId} ${model?.reasoning ?? ''}`;
    }).join(' / ')}. Usa screenshot della stessa sessione e dello stesso modello.`
      : `I reset 5h della coppia differiscono di ${Math.round(resetOffsetMinutes)} minuti (massimo 60). Verifica che gli screenshot appartengano alla stessa finestra e che il reset mostrato sia corretto.`;
    await archiveOcrFailure(source, upload.id, reason, 'MANUAL_REVIEW', result.sha256, false, trace);
    await settleFailedPair(source, upload.recordId!); return;
  }
  const moves: FileMove[] = [];
  try {
    await source.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [upload.projectId]);
      const current = await manager.findBy(UploadEntity, { id: In(members.map((item) => item.id)) });
      if (current.length !== 2 || current.some((item) => !item.pendingOcr)) throw new Error('PAIR_ATTEMPT_CHANGED');
      const project = await manager.findOneByOrFail(ProjectEntity, { id: upload.projectId });
      await ensureProjectFolders(project);
      await manager.query("SELECT set_config('app.allow_ocr_replace', 'on', true)");
      await manager.query("SELECT set_config('app.allow_model_tag', 'on', true)");
      for (const member of current) {
        const pending = member.pendingOcr as unknown as PendingPairOcr;
        const destination = resolveStoredFile(`${projectFolderName(project)}/processed/${member.id}${path.extname(member.originalName).toLowerCase()}`);
        const actual = createHash('sha256').update(await fs.readFile(resolveStoredFile(member.storageKey))).digest('hex');
        if (actual !== pending.sha256) throw new Error('IMAGE_CHANGED_DURING_OCR');
        if (pending.reuseAccepted) {
          await manager.update(UploadEntity, member.id, { pendingOcr: null, priorUpload: null });
          await resolveOcrFailure(manager, member);
          continue;
        }
        await moveFile(resolveStoredFile(member.storageKey), destination, moves);
        await manager.upsert(UsageSnapshotEntity, {
          uploadId: member.id, capturedAt: new Date(pending.capturedAt), ...pending.usage,
          fiveHourResetsAt: new Date(pending.usage.fiveHourResetsAt), ocrConfidence: pending.confidence,
          validation: { ...pending.validation, modelId: pending.modelId, modelMatchingPasses: pending.modelMatchingPasses }, createdAt: new Date(),
        }, ['uploadId']);
        await manager.update(UploadEntity, member.id, {
          status: 'VALIDATED', reviewReason: null, storageKey: relativeStorageKey(destination), sha256: pending.sha256,
          modelId: pending.modelId, processedAt: new Date(), pendingOcr: null, priorUpload: null,
        });
        await resolveOcrFailure(manager, member);
        await manager.insert(AuditEventEntity, { ownerId: member.ownerId, action: 'OCR_VALIDATED', entityType: 'upload', entityId: member.id,
          metadata: { pairAtomic: true, modelId: pending.modelId, fullOcrTextStored: false } });
      }
      await manager.update(UsageRecordEntity, upload.recordId!, { status: 'VALIDATED' });
    });
  } catch (error) { await rollbackMoves(moves); throw error; }
  await discardMoveBackups(moves).catch(() => console.error('OCR_BACKUP_CLEANUP_FAILED'));
}
