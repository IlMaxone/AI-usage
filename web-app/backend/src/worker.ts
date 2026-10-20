import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker, PSM, Worker } from 'tesseract.js';
import { IsNull } from 'typeorm';
import { AppDataSource } from './database';
import { AiModelEntity, AuditEventEntity, ProjectEntity, UploadEntity, UsageRecordEntity, UsageRecordStatus, UsageSnapshotEntity } from './entities';
import { parseScreenshotCapturedAt } from './ocr-time';
import { scanProjectInbox } from './inbox';
import { projectFolderName, relativeStorageKey, resolveStoredFile } from './storage';
import { modelSelectorFailure, recognizeModelSelector } from './ocr-model';
import { archiveOcrFailure, resolveOcrFailure, settleFailedPair } from './ocr-failures';
import { stagePairOcr } from './pair-processing';

interface ParsedUsage {
  fiveHourRemainingPct: number;
  fiveHourUsedPct: number;
  fiveHourResetsAt: Date;
  weeklyRemainingPct: number;
  weeklyUsedPct: number;
  weeklyResetsOn: string;
}

interface Candidate {
  pass: string;
  usage: ParsedUsage;
  confidence: number;
}

interface TimestampCandidate {
  pass: string;
  capturedAt: Date;
  confidence: number;
}

const months = new Map<string, number>([
  ['gen', 0], ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['mag', 4], ['may', 4],
  ['giu', 5], ['jun', 5], ['lug', 6], ['jul', 6], ['ago', 7], ['aug', 7],
  ['set', 8], ['sep', 8], ['ott', 9], ['oct', 9], ['nov', 10], ['dic', 11], ['dec', 11],
]);

function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[|]/g, 'I')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseClock(token: string): { hour: number; minute: number } {
  const explicit = token.match(/(\d{1,2})[:.;](\d{2})/);
  if (!explicit) throw new Error('RESET_TIME_UNREADABLE');
  const hour = Number(explicit[1]);
  const minute = Number(explicit[2]);
  if (hour > 23 || minute > 59) throw new Error('RESET_TIME_OUT_OF_RANGE');
  return { hour, minute };
}

function parseUsage(text: string, capturedAt: Date): ParsedUsage {
  const normalized = normalize(text);
  const fiveHour = normalized.match(/5\s*h[\s\S]{0,100}?(\d{1,3})\s*%[\s\S]{0,50}?([0-9:.;]{4,5})/i);
  const weekly = normalized.match(/(?:Settimanale|Weekly)[\s\S]{0,120}?(\d{1,3})\s*%[\s\S]{0,60}?(\d{1,2})\s*(gen|jan|feb|mar|apr|mag|may|giu|jun|lug|jul|ago|aug|set|sep|ott|oct|nov|dic|dec)/i);
  if (!fiveHour || !weekly) throw new Error('USAGE_VALUES_UNREADABLE');
  const fiveHourRemainingPct = Number(fiveHour[1]);
  const weeklyRemainingPct = Number(weekly[1]);
  if ([fiveHourRemainingPct, weeklyRemainingPct].some((value) => value < 0 || value > 100)) {
    throw new Error('USAGE_VALUE_OUT_OF_RANGE');
  }
  const { hour, minute } = parseClock(fiveHour[2]!);
  const resetAt = new Date(capturedAt);
  resetAt.setHours(hour, minute, 0, 0);
  if (resetAt <= capturedAt) resetAt.setDate(resetAt.getDate() + 1);

  const month = months.get(weekly[3]!.toLowerCase());
  if (month === undefined) throw new Error('WEEKLY_RESET_UNREADABLE');
  const weeklyReset = new Date(capturedAt.getFullYear(), month, Number(weekly[2]), 12, 0, 0, 0);
  if (weeklyReset < new Date(capturedAt.getFullYear(), capturedAt.getMonth(), capturedAt.getDate())) {
    weeklyReset.setFullYear(weeklyReset.getFullYear() + 1);
  }
  const weeklyResetsOn = [
    weeklyReset.getFullYear(),
    String(weeklyReset.getMonth() + 1).padStart(2, '0'),
    String(weeklyReset.getDate()).padStart(2, '0'),
  ].join('-');
  return {
    fiveHourRemainingPct,
    fiveHourUsedPct: 100 - fiveHourRemainingPct,
    fiveHourResetsAt: resetAt,
    weeklyRemainingPct,
    weeklyUsedPct: 100 - weeklyRemainingPct,
    weeklyResetsOn,
  };
}

function signature(usage: ParsedUsage): string {
  return [
    usage.fiveHourRemainingPct,
    usage.fiveHourResetsAt.toISOString(),
    usage.weeklyRemainingPct,
    usage.weeklyResetsOn,
  ].join('|');
}

async function candidate(worker: Worker, pass: string, input: string | Buffer, capturedAt: Date): Promise<Candidate | null> {
  try {
    const result = await worker.recognize(input);
    return {
      pass,
      usage: parseUsage(result.data.text, capturedAt),
      confidence: Number(result.data.confidence.toFixed(2)),
    };
  } catch {
    return null;
  }
}

async function rectangleCandidate(
  worker: Worker,
  pass: string,
  filePath: string,
  rectangle: { left: number; top: number; width: number; height: number },
  capturedAt: Date,
): Promise<Candidate | null> {
  try {
    const result = await worker.recognize(filePath, { rectangle });
    return {
      pass,
      usage: parseUsage(result.data.text, capturedAt),
      confidence: Number(result.data.confidence.toFixed(2)),
    };
  } catch {
    return null;
  }
}

function hasUsageAgreement(candidates: Candidate[]): boolean {
  const counts = new Map<string, number>();
  for (const item of candidates) counts.set(signature(item.usage), (counts.get(signature(item.usage)) ?? 0) + 1);
  return [...counts.values()].some((count) => count >= 2);
}

async function timestampCandidate(worker: Worker, pass: string, input: Buffer): Promise<TimestampCandidate | null> {
  try {
    const result = await worker.recognize(input);
    return {
      pass,
      capturedAt: parseScreenshotCapturedAt(result.data.text),
      confidence: Number(result.data.confidence.toFixed(2)),
    };
  } catch {
    return null;
  }
}

export async function recognizeScreenshot(worker: Worker, filePath: string) {
  const originalBuffer = await fs.readFile(filePath);
  const metadata = await sharp(originalBuffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error('IMAGE_DIMENSIONS_UNREADABLE');
  // Nei normali screenshot desktop il pannello usage occupa circa il 20% a sinistra.
  // Il ritaglio rimuove il testo estraneo che altera l'ordine OCR; sulle immagini
  // strette viene mantenuta l'intera larghezza.
  const regionWidth = Math.min(
    metadata.width,
    Math.max(360, Math.min(600, Math.round(metadata.width * 0.22))),
  );
  const usageRegion = {
    left: 0,
    top: 0,
    width: regionWidth,
    height: Math.min(metadata.height, Math.max(300, Math.round(metadata.height * 0.9))),
  };
  const timestampLeft = Math.max(0, Math.round(metadata.width * 0.72));
  const timestampTop = Math.max(0, Math.round(metadata.height * 0.78));
  const timestampRegion = {
    left: timestampLeft,
    top: timestampTop,
    width: metadata.width - timestampLeft,
    height: metadata.height - timestampTop,
  };
  const [cropNormalized, cropNormalized4x, timestampNormalized, timestampSoft, timestampThreshold] = await Promise.all([
    sharp(originalBuffer)
      .extract(usageRegion)
      .resize({ width: usageRegion.width * 3, kernel: sharp.kernel.lanczos3 })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer(),
    sharp(originalBuffer)
      .extract(usageRegion)
      .resize({ width: usageRegion.width * 4, kernel: sharp.kernel.lanczos3 })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer(),
    sharp(originalBuffer)
      .extract(timestampRegion)
      .resize({ width: 1600, withoutEnlargement: false, fit: 'inside' })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer(),
    sharp(originalBuffer)
      .extract(timestampRegion)
      .resize({ width: 1600, withoutEnlargement: false, fit: 'inside' })
      .grayscale()
      .linear(1.25, 8)
      .sharpen()
      .png()
      .toBuffer(),
    sharp(originalBuffer)
      .extract(timestampRegion)
      .resize({ width: 1600, withoutEnlargement: false, fit: 'inside' })
      .grayscale()
      .threshold(150)
      .png()
      .toBuffer(),
  ]);

  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const timestampCandidates: TimestampCandidate[] = [];
  for (const [pass, input] of [
    ['timestamp-normalized', timestampNormalized],
    ['timestamp-soft', timestampSoft],
    ['timestamp-threshold', timestampThreshold],
  ] as const) {
    const item = await timestampCandidate(worker, pass, input);
    if (item) timestampCandidates.push(item);
  }
  const timestampGroups = new Map<string, TimestampCandidate[]>();
  for (const item of timestampCandidates) {
    const key = item.capturedAt.toISOString();
    timestampGroups.set(key, [...(timestampGroups.get(key) ?? []), item]);
  }
  const timestampAgreement = [...timestampGroups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  if (timestampAgreement.length < 2) {
    return {
      accepted: false as const,
      reason: 'I passaggi OCR non concordano su data e ora visibili nello screenshot.',
      validation: {
        requiredMatchingPasses: 2,
        timestampValidPasses: timestampCandidates.map((item) => item.pass),
        fullOcrTextStored: false,
      },
    };
  }
  const capturedAt = timestampAgreement[0]!.capturedAt;

  const candidates: Candidate[] = [];
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  const panelOriginal = await rectangleCandidate(
    worker,
    'left-panel-original',
    filePath,
    usageRegion,
    capturedAt,
  );
  if (panelOriginal) candidates.push(panelOriginal);
  for (const [pass, input] of [
    ['left-panel-preprocessed', cropNormalized],
    ['left-panel-preprocessed-4x', cropNormalized4x],
  ] as const) {
    const item = await candidate(worker, pass, input, capturedAt);
    if (item) candidates.push(item);
  }
  if (!hasUsageAgreement(candidates)) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const sparse = await candidate(worker, 'left-panel-sparse-text', cropNormalized, capturedAt);
    if (sparse) candidates.push(sparse);
  }
  if (!hasUsageAgreement(candidates)) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const fullImage = await candidate(worker, 'full-image-fallback', originalBuffer, capturedAt);
    if (fullImage) candidates.push(fullImage);
  }

  const groups = new Map<string, Candidate[]>();
  for (const item of candidates) {
    const key = signature(item.usage);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const agreement = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  if (agreement.length < 2) {
    return {
      accepted: false as const,
      reason: 'I passaggi OCR non concordano sui valori di utilizzo e reset.',
      validation: { requiredMatchingPasses: 2, validPasses: candidates.map((item) => item.pass) },
    };
  }
  const selected = agreement.slice().sort((a, b) => b.confidence - a.confidence)[0]!;
  return {
    accepted: true as const,
    usage: selected.usage,
    confidence: selected.confidence,
    validation: {
      requiredMatchingPasses: 2,
      matchingPasses: agreement.map((item) => item.pass),
      timestampMatchingPasses: timestampAgreement.map((item) => item.pass),
      confidences: agreement.map((item) => ({ pass: item.pass, confidence: item.confidence })),
      fullOcrTextStored: false,
    },
    capturedAt,
  };
}

async function claimUpload(): Promise<UploadEntity | null> {
  return AppDataSource.transaction(async (manager) => {
    const rows = await manager.query(`
      SELECT id FROM uploads
      WHERE status = 'UPLOADED'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `) as Array<{ id: string }>;
    const id = rows[0]?.id;
    if (!id) return null;
    await manager.update(UploadEntity, { id }, { status: 'PROCESSING' });
    return manager.findOneByOrFail(UploadEntity, { id });
  });
}

async function refreshRecordStatus(recordId: string | null): Promise<void> {
  if (!recordId) return;
  const records = AppDataSource.getRepository(UsageRecordEntity);
  const record = await records.findOneBy({ id: recordId });
  if (!record) return;
  const requiredIds = [record.singleUploadId, record.startUploadId, record.endUploadId]
    .filter((id): id is string => Boolean(id));
  const uploads = await AppDataSource.getRepository(UploadEntity)
    .createQueryBuilder('upload')
    .where('upload.id IN (:...ids)', { ids: requiredIds })
    .getMany();
  let status: UsageRecordStatus = 'VALIDATING';
  if (uploads.some((item) => item.status === 'FAILED')) status = 'FAILED';
  else if (uploads.some((item) => item.status === 'MANUAL_REVIEW')) status = 'MANUAL_REVIEW';
  else if (uploads.length === requiredIds.length && uploads.every((item) => item.status === 'VALIDATED')) {
    status = 'VALIDATED';
    if (record.mode === 'SEGMENT' && record.startUploadId && record.endUploadId) {
      const snapshots = await AppDataSource.getRepository(UsageSnapshotEntity)
        .createQueryBuilder('snapshot')
        .where('snapshot.upload_id IN (:...ids)', { ids: [record.startUploadId, record.endUploadId] })
        .getMany();
      const byUpload = new Map(snapshots.map((item) => [item.uploadId, item]));
      const start = byUpload.get(record.startUploadId);
      const end = byUpload.get(record.endUploadId);
      const resetOffsetMs = start && end
        ? Math.abs(start.fiveHourResetsAt.getTime() - end.fiveHourResetsAt.getTime())
        : 0;
      if (start && end && resetOffsetMs > 60 * 60_000) {
        status = 'MANUAL_REVIEW';
      }
      if (new Set(uploads.map((item) => item.modelId)).size !== 1 || uploads.some((item) => !item.modelId)) status = 'MANUAL_REVIEW';
    }
  }
  await records.update(recordId, { status });
}

export async function processUpload(worker: Worker, upload: UploadEntity): Promise<void> {
  const filePath = resolveStoredFile(upload.storageKey);
  const buffer = await fs.readFile(filePath);
  const imageSha256 = createHash('sha256').update(buffer).digest('hex');
  const result = await recognizeScreenshot(worker, filePath);
  if (createHash('sha256').update(await fs.readFile(filePath)).digest('hex') !== imageSha256) {
    throw new Error('IMAGE_CHANGED_DURING_OCR');
  }
  if (!result.accepted) {
    await archiveOcrFailure(AppDataSource, upload.id, result.reason, 'MANUAL_REVIEW', imageSha256);
    if (upload.role !== 'SINGLE' && upload.recordId) await settleFailedPair(AppDataSource, upload.recordId);
    else await refreshRecordStatus(upload.recordId);
    return;
  }

  const models = await AppDataSource.getRepository(AiModelEntity).find({ where: { ownerId: upload.ownerId, catalogAvailable: true, supersededAt: IsNull() } });
  const selector = await recognizeModelSelector(worker, filePath, models);
  const modelTag = selector.status === 'MATCHED' ? selector : null;
  if (!modelTag || (upload.modelId && upload.modelId !== modelTag.modelId)) {
    await archiveOcrFailure(AppDataSource, upload.id, !modelTag ? modelSelectorFailure(selector) : 'Il modello letto contraddice il tag OCR originale, che è immutabile.', 'MANUAL_REVIEW', imageSha256);
    if (upload.role !== 'SINGLE' && upload.recordId) await settleFailedPair(AppDataSource, upload.recordId);
    else await refreshRecordStatus(upload.recordId);
    return;
  }
  if (createHash('sha256').update(await fs.readFile(filePath)).digest('hex') !== imageSha256) throw new Error('IMAGE_CHANGED_DURING_OCR');

  if (upload.role !== 'SINGLE' && upload.recordId) {
    await stagePairOcr(AppDataSource, upload, {
      sha256: imageSha256, capturedAt: result.capturedAt.toISOString(), confidence: result.confidence, modelId: modelTag.modelId,
      usage: { ...result.usage, fiveHourResetsAt: result.usage.fiveHourResetsAt.toISOString() },
      validation: result.validation, modelMatchingPasses: modelTag.matchingPasses,
    });
    return;
  }
  const project = await AppDataSource.getRepository(ProjectEntity).findOneByOrFail({ id: upload.projectId });
  const destination = resolveStoredFile(`${projectFolderName(project)}/processed/${upload.id}${path.extname(upload.originalName).toLowerCase()}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const moved = filePath !== destination;
  const backup = `${destination}.previous`;
  let backedUp = false;
  if (moved) {
    try { await fs.rename(destination, backup); backedUp = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { await fs.rename(filePath, destination); }
    catch (error) { if (backedUp) await fs.rename(backup, destination); throw error; }
  }
  try {
    await AppDataSource.transaction(async (manager) => {
    await manager.query("SELECT set_config('app.allow_ocr_replace', 'on', true)");
    await manager.query("SELECT set_config('app.allow_model_tag', 'on', true)");
    await manager.upsert(UsageSnapshotEntity, {
      uploadId: upload.id,
      capturedAt: result.capturedAt,
      ...result.usage,
      ocrConfidence: result.confidence,
      validation: { ...result.validation, modelId: modelTag.modelId, modelMatchingPasses: modelTag.matchingPasses },
      createdAt: new Date(),
    }, ['uploadId']);
    await manager.update(UploadEntity, { id: upload.id }, {
      sha256: imageSha256,
      status: 'VALIDATED',
      reviewReason: null,
      processedAt: new Date(),
      storageKey: relativeStorageKey(destination),
      modelId: modelTag.modelId, pendingOcr: null, priorUpload: null,
    });
    await resolveOcrFailure(manager, upload);
    await manager.insert(AuditEventEntity, {
      ownerId: upload.ownerId,
      action: 'OCR_VALIDATED',
      entityType: 'upload',
      entityId: upload.id,
      metadata: { matchingPasses: result.validation.matchingPasses, modelId: modelTag.modelId, modelMatchingPasses: modelTag.matchingPasses, fullOcrTextStored: false },
    });
    });
  } catch (error) {
    if (moved) await fs.rename(destination, filePath);
    if (backedUp) await fs.rename(backup, destination);
    throw error;
  }
  if (backedUp) await fs.unlink(backup);
  await refreshRecordStatus(upload.recordId);
}

// Enrich historical validated screenshots without rewriting their usage data.
export async function tagHistoricalUpload(worker: Worker, upload: UploadEntity) {
  if (upload.storageKey.includes('/unprocessed/')) return processUpload(worker, upload);
  const filePath = resolveStoredFile(upload.storageKey);
  const before = createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
  if (upload.sha256 && upload.sha256 !== before) throw new Error('IMAGE_HASH_CHANGED');
  const models = await AppDataSource.getRepository(AiModelEntity).find({ where: { ownerId: upload.ownerId, catalogAvailable: true, supersededAt: IsNull() } });
  const selector = await recognizeModelSelector(worker, filePath, models);
  const tag = selector.status === 'MATCHED' ? selector : null;
  const after = createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
  if (before !== after) throw new Error('IMAGE_CHANGED_DURING_OCR');
  if (!tag) {
    await archiveOcrFailure(AppDataSource, upload.id, modelSelectorFailure(selector), 'MANUAL_REVIEW');
    if (upload.role !== 'SINGLE' && upload.recordId) await settleFailedPair(AppDataSource, upload.recordId);
    else await refreshRecordStatus(upload.recordId);
    return;
  }
  await AppDataSource.transaction(async (manager) => {
    await manager.query("SELECT set_config('app.allow_model_tag', 'on', true)");
    await manager.update(UploadEntity, upload.id, tag ? {
      modelId: tag.modelId, status: 'VALIDATED', reviewReason: null, modelTagOnly: false,
    } : { status: 'MANUAL_REVIEW', modelTagOnly: false, reviewReason: 'Modello/reasoning non riconosciuto con due letture concordi nel catalogo.' });
    await manager.insert(AuditEventEntity, {
      ownerId: upload.ownerId, action: tag ? 'OCR_MODEL_TAGGED' : 'OCR_MODEL_REQUIRES_REVIEW', entityType: 'upload', entityId: upload.id,
      metadata: tag ? { modelId: tag.modelId, modelMatchingPasses: tag.matchingPasses, historicalUsageUnchanged: true } : { historicalUsageUnchanged: true },
    });
    await resolveOcrFailure(manager, upload);
  });
  await refreshRecordStatus(upload.recordId);
}

async function claimHistoricalUpload() {
  return AppDataSource.transaction(async (manager) => {
    const rows = await manager.query("SELECT id FROM uploads WHERE model_id IS NULL AND status = 'VALIDATED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1") as Array<{ id: string }>;
    if (!rows[0]) return null;
    await manager.update(UploadEntity, rows[0].id, { status: 'PROCESSING', modelTagOnly: true });
    return manager.findOneByOrFail(UploadEntity, { id: rows[0].id });
  });
}

async function main() {
  await AppDataSource.initialize();
  await AppDataSource.query("UPDATE uploads SET status = 'VALIDATED', model_tag_only = false WHERE status = 'PROCESSING' AND model_tag_only = true");
  await AppDataSource.getRepository(UploadEntity).createQueryBuilder().update()
    .set({ status: 'UPLOADED', reviewReason: null }).where("status = 'PROCESSING'").execute();
  const cachePath = process.env.OCR_CACHE_DIR ?? path.resolve('storage/ocr-cache');
  await fs.mkdir(cachePath, { recursive: true });
  const worker = await createWorker('eng', 1, { cachePath });
  const pollInterval = Math.max(500, Number(process.env.OCR_POLL_INTERVAL_MS ?? 2000));
  let stopping = false;
  let lastScan = 0;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    while (!stopping) {
      if (Date.now() - lastScan >= 5000) {
        lastScan = Date.now();
        const projects = await AppDataSource.getRepository(ProjectEntity).find();
        for (const project of projects) {
          try { await scanProjectInbox(AppDataSource, project); }
          catch { console.error('PROJECT_INBOX_SCAN_FAILED', project.id); }
        }
      }
      let upload = await claimUpload();
      let historical = false;
      if (!upload) { upload = await claimHistoricalUpload(); historical = Boolean(upload); }
      if (!upload) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        continue;
      }
      try {
        if (historical) await tagHistoricalUpload(worker, upload);
        else await processUpload(worker, upload);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
        await archiveOcrFailure(AppDataSource, upload.id, message.slice(0, 500), 'FAILED');
        if (upload.role !== 'SINGLE' && upload.recordId) await settleFailedPair(AppDataSource, upload.recordId);
        await refreshRecordStatus(upload.recordId);
      }
    }
  } finally {
    await worker.terminate();
    await AppDataSource.destroy();
  }
}

if (require.main === module) void main();
