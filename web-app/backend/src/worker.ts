import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker, PSM, Worker } from 'tesseract.js';
import { AppDataSource } from './database';
import { AuditEventEntity, UploadEntity, UsageRecordEntity, UsageRecordStatus, UsageSnapshotEntity } from './entities';

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

async function recognize(worker: Worker, filePath: string, capturedAt: Date) {
  const originalBuffer = await fs.readFile(filePath);
  const metadata = await sharp(originalBuffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error('IMAGE_DIMENSIONS_UNREADABLE');
  // Nei normali screenshot desktop il pannello usage occupa circa il 20% a sinistra.
  // Il ritaglio rimuove il testo estraneo che altera l'ordine OCR; sulle immagini
  // strette viene mantenuta l'intera larghezza.
  const regionWidth = metadata.width >= 900
    ? Math.min(metadata.width, Math.max(360, Math.round(metadata.width * 0.2)))
    : metadata.width;
  const usageRegion = { left: 0, top: 0, width: regionWidth, height: metadata.height };
  const [cropNormalized, cropSoft] = await Promise.all([
    sharp(originalBuffer)
      .extract(usageRegion)
      .resize({ width: 1800, withoutEnlargement: false, fit: 'inside' })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer(),
    sharp(originalBuffer)
      .extract(usageRegion)
      .resize({ width: 1800, withoutEnlargement: false, fit: 'inside' })
      .grayscale()
      .linear(1.25, 8)
      .sharpen()
      .png()
      .toBuffer(),
  ]);

  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  const candidates = (await Promise.all([
    candidate(worker, 'original', originalBuffer, capturedAt),
    candidate(worker, 'crop-normalized', cropNormalized, capturedAt),
    candidate(worker, 'crop-soft', cropSoft, capturedAt),
  ])).filter((item): item is Candidate => item !== null);

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
      confidences: agreement.map((item) => ({ pass: item.pass, confidence: item.confidence })),
      fullOcrTextStored: false,
    },
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
      if (start && end && start.fiveHourResetsAt.getTime() !== end.fiveHourResetsAt.getTime()) {
        status = 'MANUAL_REVIEW';
      }
    }
  }
  await records.update(recordId, { status });
}

async function processUpload(worker: Worker, upload: UploadEntity): Promise<void> {
  const uploadDir = process.env.UPLOAD_DIR ?? path.resolve('storage/uploads');
  const filePath = path.resolve(uploadDir, upload.storageKey);
  if (!filePath.startsWith(path.resolve(uploadDir) + path.sep)) throw new Error('INVALID_STORAGE_KEY');
  const [buffer, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
  const imageSha256 = createHash('sha256').update(buffer).digest('hex');
  const duplicate = await AppDataSource.getRepository(UploadEntity)
    .createQueryBuilder('upload')
    .where('upload.owner_id = :ownerId', { ownerId: upload.ownerId })
    .andWhere('upload.sha256 = :sha', { sha: imageSha256 })
    .andWhere('upload.id <> :id', { id: upload.id })
    .getOne();
  if (duplicate) {
    await AppDataSource.getRepository(UploadEntity).update(upload.id, {
      status: 'MANUAL_REVIEW',
      reviewReason: 'Immagine già registrata; nessun nuovo snapshot creato.',
      processedAt: new Date(),
    });
    await refreshRecordStatus(upload.recordId);
    return;
  }

  const result = await recognize(worker, filePath, stat.mtime);
  if (!result.accepted) {
    await AppDataSource.transaction(async (manager) => {
      await manager.update(UploadEntity, { id: upload.id }, {
        sha256: imageSha256,
        status: 'MANUAL_REVIEW',
        reviewReason: result.reason,
        processedAt: new Date(),
      });
      await manager.insert(AuditEventEntity, {
        ownerId: upload.ownerId,
        action: 'OCR_REQUIRES_REVIEW',
        entityType: 'upload',
        entityId: upload.id,
        metadata: result.validation,
      });
    });
    await refreshRecordStatus(upload.recordId);
    return;
  }

  await AppDataSource.transaction(async (manager) => {
    await manager.insert(UsageSnapshotEntity, {
      uploadId: upload.id,
      capturedAt: stat.mtime,
      ...result.usage,
      ocrConfidence: result.confidence,
      validation: result.validation,
    });
    await manager.update(UploadEntity, { id: upload.id }, {
      sha256: imageSha256,
      status: 'VALIDATED',
      reviewReason: null,
      processedAt: new Date(),
    });
    await manager.insert(AuditEventEntity, {
      ownerId: upload.ownerId,
      action: 'OCR_VALIDATED',
      entityType: 'upload',
      entityId: upload.id,
      metadata: { matchingPasses: result.validation.matchingPasses, fullOcrTextStored: false },
    });
  });
  await refreshRecordStatus(upload.recordId);
}

async function main() {
  await AppDataSource.initialize();
  const cachePath = process.env.OCR_CACHE_DIR ?? path.resolve('storage/ocr-cache');
  await fs.mkdir(cachePath, { recursive: true });
  const worker = await createWorker('eng', 1, { cachePath });
  const pollInterval = Math.max(500, Number(process.env.OCR_POLL_INTERVAL_MS ?? 2000));
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    while (!stopping) {
      const upload = await claimUpload();
      if (!upload) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        continue;
      }
      try {
        await processUpload(worker, upload);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
        await AppDataSource.getRepository(UploadEntity).update(upload.id, {
          status: 'FAILED',
          reviewReason: message.slice(0, 500),
          processedAt: new Date(),
        });
        await refreshRecordStatus(upload.recordId);
      }
    }
  } finally {
    await worker.terminate();
    await AppDataSource.destroy();
  }
}

void main();
