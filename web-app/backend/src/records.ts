import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { Express, Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import {
  AuditEventEntity,
  CaptureTimeObservationEntity,
  ProjectEntity,
  UploadEntity,
  UsageCorrectionEntity,
  UsageRecordEntity,
  UsageRecordMode,
  UsageSnapshotEntity,
} from './entities';
import { incomingDir, projectFolderName, relativeStorageKey, resolveStoredFile, uploadDir } from './storage';

class CreateRecordDto {
  @IsUUID() projectId!: string;
  @IsIn(['CONSTANT', 'SEGMENT']) mode!: UsageRecordMode;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

class CorrectionDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) fiveHourRemainingPct!: number;
  @IsDateString() fiveHourResetsAt!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) weeklyRemainingPct!: number;
  @IsDateString() weeklyResetsOn!: string;
  @IsString() @Length(3, 500) reason!: string;
}

export interface SnapshotInput {
  fiveHourUsedPct: number | string;
  fiveHourResetsAt: Date | string;
  weeklyUsedPct?: number | string;
  weeklyResetsOn?: Date | string;
}

const FIVE_HOUR_RESET_TOLERANCE_MS = 60 * 60_000;

function weeklyResetSignal(start: SnapshotInput, end: SnapshotInput) {
  if (!start.weeklyResetsOn || !end.weeklyResetsOn) return 'UNAVAILABLE' as const;
  const startReset = new Date(start.weeklyResetsOn).getTime();
  const endReset = new Date(end.weeklyResetsOn).getTime();
  if (!Number.isFinite(startReset) || !Number.isFinite(endReset)) return 'UNAVAILABLE' as const;
  if (startReset === endReset) return 'SAME_WINDOW' as const;
  const startUsed = Number(start.weeklyUsedPct);
  const endUsed = Number(end.weeklyUsedPct);
  if (endReset > startReset && Number.isFinite(startUsed) && Number.isFinite(endUsed) && endUsed <= startUsed) {
    return 'ROLLOVER' as const;
  }
  return 'SHIFTED' as const;
}

export function computeRecordUsage(
  mode: UsageRecordMode,
  single?: SnapshotInput,
  start?: SnapshotInput,
  end?: SnapshotInput,
) {
  if (mode === 'CONSTANT') {
    return single
      ? { status: 'MEASURED' as const, usedPct: Number(single.fiveHourUsedPct) }
      : { status: 'WAITING_FOR_OCR' as const, usedPct: null };
  }
  if (!start || !end) return { status: 'WAITING_FOR_OCR' as const, usedPct: null };
  const resetOffsetMinutes = Math.abs(
    new Date(end.fiveHourResetsAt).getTime() - new Date(start.fiveHourResetsAt).getTime(),
  ) / 60_000;
  const alignment = {
    fiveHourResetOffsetMinutes: Math.round(resetOffsetMinutes * 100) / 100,
    weeklyResetSignal: weeklyResetSignal(start, end),
  };
  if (!Number.isFinite(resetOffsetMinutes) || resetOffsetMinutes * 60_000 > FIVE_HOUR_RESET_TOLERANCE_MS) {
    return { status: 'WINDOW_MISMATCH' as const, usedPct: null, alignment };
  }
  return {
    status: 'SEGMENT_MEASURED' as const,
    usedPct: Math.max(0, Number(end.fiveHourUsedPct) - Number(start.fiveHourUsedPct)),
    alignment,
  };
}

const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp']);
type RecordFiles = { single?: Express.Multer.File[]; start?: Express.Multer.File[]; end?: Express.Multer.File[] };

function storedFilePath(storageKey: string): string {
  try {
    return resolveStoredFile(storageKey);
  } catch {
    throw new BadRequestException('Percorso immagine non valido');
  }
}

@Controller('records')
export class RecordsController {
  constructor(
    @InjectRepository(UsageRecordEntity) private readonly records: Repository<UsageRecordEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UploadEntity) private readonly uploads: Repository<UploadEntity>,
    @InjectRepository(UsageSnapshotEntity) private readonly snapshots: Repository<UsageSnapshotEntity>,
    @InjectRepository(UsageCorrectionEntity) private readonly corrections: Repository<UsageCorrectionEntity>,
    @InjectRepository(CaptureTimeObservationEntity) private readonly captureTimes: Repository<CaptureTimeObservationEntity>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const records = await this.records.find({ where: { ownerId: user.id }, order: { createdAt: 'DESC' } });
    return this.enrich(records, user.id);
  }

  @Get('uploads/gallery')
  async gallery(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    if (!projectId) throw new BadRequestException('Seleziona un progetto');
    const project = await this.projects.findOne({ where: { id: projectId, ownerId: user.id }, withDeleted: true });
    if (!project) throw new NotFoundException('Progetto non trovato');
    const uploads = await this.uploads.find({ where: { ownerId: user.id, projectId }, order: { createdAt: 'DESC' } });
    const [records, snapshots, captureTimes] = await Promise.all([
      this.records.find({ where: { ownerId: user.id }, withDeleted: true }),
      uploads.length ? this.snapshots.find({ where: { uploadId: In(uploads.map((item) => item.id)) } }) : [],
      uploads.length ? this.captureTimes.find({ where: { uploadId: In(uploads.map((item) => item.id)), ownerId: user.id }, order: { createdAt: 'DESC' } }) : [],
    ]);
    const recordById = new Map(records.map((item) => [item.id, item]));
    const snapshotByUpload = new Map(snapshots.map((item) => [item.uploadId, item]));
    const captureTimeByUpload = new Map<string, CaptureTimeObservationEntity>();
    for (const item of captureTimes) if (!captureTimeByUpload.has(item.uploadId)) captureTimeByUpload.set(item.uploadId, item);
    const available = await Promise.all(uploads.map(async (upload) => {
      try {
        await fs.access(storedFilePath(upload.storageKey));
        const record = upload.recordId ? recordById.get(upload.recordId) : null;
        return {
          id: upload.id,
          recordId: upload.recordId,
          role: upload.role,
          originalName: upload.originalName,
          mime: upload.mime,
          size: upload.size,
          status: upload.status,
          createdAt: upload.createdAt,
          capturedAt: captureTimeByUpload.get(upload.id)?.capturedAt ?? snapshotByUpload.get(upload.id)?.capturedAt ?? null,
          recordDeleted: Boolean(record?.deletedAt),
          project: { id: project.id, name: project.name, color: project.color },
        };
      } catch {
        return null;
      }
    }));
    return available.filter((item) => item !== null);
  }

  @Get('uploads/:uploadId/content')
  async image(
    @CurrentUser() user: AuthUser,
    @Param('uploadId') uploadId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const upload = await this.uploads.findOneBy({ id: uploadId, ownerId: user.id });
    if (!upload) throw new NotFoundException('Screenshot non trovato');
    const filePath = storedFilePath(upload.storageKey);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('File dello screenshot non trovato');
    }
    response.setHeader('Content-Type', upload.mime);
    response.setHeader('Content-Length', String(upload.size));
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(upload.originalName)}`);
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(createReadStream(filePath));
  }

  @Post()
  @UseInterceptors(FileFieldsInterceptor(
    [{ name: 'single', maxCount: 1 }, { name: 'start', maxCount: 1 }, { name: 'end', maxCount: 1 }],
    {
      storage: diskStorage({
        destination: (_request, _file, callback) => {
          void fs.mkdir(incomingDir, { recursive: true }).then(
            () => callback(null, incomingDir),
            (error: unknown) => callback(error as Error, incomingDir),
          );
        },
        filename: (_request, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 10_485_760), files: 2 },
      fileFilter: (_request, file, callback) => callback(null, allowedMime.has(file.mimetype)),
    },
  ))
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRecordDto,
    @UploadedFiles() files: RecordFiles = {},
  ) {
    const allFiles = [...(files.single ?? []), ...(files.start ?? []), ...(files.end ?? [])];
    let record: UsageRecordEntity;
    try {
      const project = await this.validateProject(user.id, dto.projectId);
      const destination = path.join(uploadDir, projectFolderName(project));
      await fs.mkdir(destination, { recursive: true });
      for (const file of allFiles) {
        const movedPath = path.join(destination, file.filename);
        await fs.rename(file.path, movedPath);
        file.path = movedPath;
        file.filename = relativeStorageKey(movedPath);
      }
      if (dto.mode === 'CONSTANT' && (!(files.single?.[0]) || allFiles.length !== 1)) {
        throw new BadRequestException('Usage costante richiede un solo screenshot');
      }
      if (dto.mode === 'SEGMENT' && (!(files.start?.[0]) || !(files.end?.[0]) || allFiles.length !== 2)) {
        throw new BadRequestException('Il segmento di usage richiede screenshot iniziale e finale');
      }

      record = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.save(UsageRecordEntity, {
          ownerId: user.id,
          projectId: dto.projectId,
          modelId: null,
          mode: dto.mode,
          status: 'DRAFT',
          note: dto.note?.trim() || null,
        });
        const makeUpload = async (file: Express.Multer.File, role: 'SINGLE' | 'START' | 'END') => manager.save(UploadEntity, {
          ownerId: user.id,
          projectId: dto.projectId,
          eventId: null,
          recordId: saved.id,
          role,
          originalName: path.basename(file.originalname).slice(0, 255),
          storageKey: file.filename,
          mime: file.mimetype,
          size: file.size,
          status: 'DRAFT',
        });
        if (dto.mode === 'CONSTANT') {
          const upload = await makeUpload(files.single![0]!, 'SINGLE');
          saved.singleUploadId = upload.id;
        } else {
          const start = await makeUpload(files.start![0]!, 'START');
          const end = await makeUpload(files.end![0]!, 'END');
          saved.startUploadId = start.id;
          saved.endUploadId = end.id;
        }
        await manager.save(UsageRecordEntity, saved);
        await manager.insert(AuditEventEntity, {
          ownerId: user.id,
          action: 'USAGE_RECORD_CREATED',
          entityType: 'usage_record',
          entityId: saved.id,
          metadata: { projectId: dto.projectId, mode: dto.mode, files: allFiles.length },
        });
        return saved;
      });
    } catch (error) {
      await Promise.all(allFiles.map((file) => fs.unlink(file.path).catch(() => undefined)));
      throw error;
    }
    return (await this.enrich([record], user.id))[0];
  }

  @Post(':id/validate')
  async validate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const record = await this.owned(id, user.id);
    if (record.status === 'VALIDATING') throw new BadRequestException('Convalida già in corso');
    const uploadIds = this.uploadIds(record);
    const uploads = await this.uploads.find({ where: { id: In(uploadIds), ownerId: user.id, recordId: record.id } });
    if (uploads.length !== uploadIds.length) throw new BadRequestException('Rilevazione incompleta');
    const queued = uploads.filter((upload) => upload.status !== 'VALIDATED');
    if (!queued.length) throw new BadRequestException('Rilevazione già convalidata');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(UploadEntity, { id: In(queued.map((item) => item.id)) }, {
        status: 'UPLOADED',
        reviewReason: null,
        processedAt: null,
      });
      await manager.update(UsageRecordEntity, { id: record.id }, { status: 'VALIDATING' });
      await manager.insert(AuditEventEntity, {
        ownerId: user.id,
        action: 'TRIPLE_OCR_REQUESTED',
        entityType: 'usage_record',
        entityId: record.id,
        metadata: { uploadIds: queued.map((item) => item.id), passes: 3, requiredAgreement: 2 },
      });
    });
    return { id: record.id, status: 'VALIDATING', queuedUploads: queued.length };
  }

  @Patch(':recordId/snapshots/:uploadId')
  async correct(
    @CurrentUser() user: AuthUser,
    @Param('recordId') recordId: string,
    @Param('uploadId') uploadId: string,
    @Body() dto: CorrectionDto,
  ) {
    const record = await this.owned(recordId, user.id);
    if (!this.uploadIds(record).includes(uploadId)) throw new NotFoundException('Screenshot non appartenente alla rilevazione');
    const upload = await this.uploads.findOneBy({ id: uploadId, ownerId: user.id, recordId });
    if (!upload) throw new NotFoundException('Screenshot non trovato');
    const correction = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(UsageCorrectionEntity, {
        ownerId: user.id,
        recordId,
        uploadId,
        fiveHourRemainingPct: dto.fiveHourRemainingPct,
        fiveHourUsedPct: 100 - dto.fiveHourRemainingPct,
        fiveHourResetsAt: new Date(dto.fiveHourResetsAt),
        weeklyRemainingPct: dto.weeklyRemainingPct,
        weeklyUsedPct: 100 - dto.weeklyRemainingPct,
        weeklyResetsOn: dto.weeklyResetsOn.slice(0, 10),
        reason: dto.reason.trim(),
      });
      await manager.update(UploadEntity, { id: uploadId }, {
        status: 'VALIDATED',
        reviewReason: 'Valori corretti manualmente',
        processedAt: new Date(),
      });
      await manager.insert(AuditEventEntity, {
        ownerId: user.id,
        action: 'USAGE_MANUALLY_CORRECTED',
        entityType: 'usage_correction',
        entityId: saved.id,
        metadata: { recordId, uploadId, reason: dto.reason.trim() },
      });
      return saved;
    });
    await this.refreshStatus(record);
    return correction;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.owned(id, user.id);
    await this.records.softDelete({ id, ownerId: user.id });
    await this.audit.record(user.id, 'USAGE_RECORD_DELETED', 'usage_record', id, { softDeleted: true });
    return { deleted: true };
  }

  private async enrich(records: UsageRecordEntity[], ownerId: string) {
    const uploadIds = records.flatMap((item) => this.uploadIds(item));
    const projectIds = [...new Set(records.map((item) => item.projectId))];
    const [uploads, snapshots, corrections, captureTimes, projects] = await Promise.all([
      uploadIds.length ? this.uploads.find({ where: { id: In(uploadIds), ownerId } }) : [],
      uploadIds.length ? this.snapshots.find({ where: { uploadId: In(uploadIds) } }) : [],
      uploadIds.length ? this.corrections.find({ where: { uploadId: In(uploadIds), ownerId }, order: { createdAt: 'DESC' } }) : [],
      uploadIds.length ? this.captureTimes.find({ where: { uploadId: In(uploadIds), ownerId }, order: { createdAt: 'DESC' } }) : [],
      projectIds.length ? this.projects.find({ where: { id: In(projectIds), ownerId }, withDeleted: true }) : [],
    ]);
    const uploadById = new Map(uploads.map((item) => [item.id, item]));
    const snapshotByUpload = new Map(snapshots.map((item) => [item.uploadId, item]));
    const correctionByUpload = new Map<string, UsageCorrectionEntity>();
    for (const item of corrections) if (!correctionByUpload.has(item.uploadId)) correctionByUpload.set(item.uploadId, item);
    const captureTimeByUpload = new Map<string, CaptureTimeObservationEntity>();
    for (const item of captureTimes) if (!captureTimeByUpload.has(item.uploadId)) captureTimeByUpload.set(item.uploadId, item);
    const projectById = new Map(projects.map((item) => [item.id, item]));
    const reading = (uploadId: string | null) => {
      if (!uploadId) return null;
      const upload = uploadById.get(uploadId) ?? null;
      const storedSnapshot = snapshotByUpload.get(uploadId) ?? null;
      const observedCapture = captureTimeByUpload.get(uploadId);
      const rawSnapshot = storedSnapshot && observedCapture
        ? { ...storedSnapshot, capturedAt: observedCapture.capturedAt }
        : storedSnapshot;
      const correction = correctionByUpload.get(uploadId) ?? null;
      return { upload, rawSnapshot, correction, effectiveSnapshot: correction ?? rawSnapshot };
    };
    return records.map((record) => {
      const single = reading(record.singleUploadId);
      const start = reading(record.startUploadId);
      const end = reading(record.endUploadId);
      return {
        ...record,
        project: projectById.get(record.projectId) ?? null,
        single,
        start,
        end,
        usage: computeRecordUsage(
          record.mode,
          single?.effectiveSnapshot ?? undefined,
          start?.effectiveSnapshot ?? undefined,
          end?.effectiveSnapshot ?? undefined,
        ),
      };
    });
  }

  private uploadIds(record: UsageRecordEntity): string[] {
    return [record.singleUploadId, record.startUploadId, record.endUploadId].filter((id): id is string => Boolean(id));
  }

  private async owned(id: string, ownerId: string) {
    const record = await this.records.findOneBy({ id, ownerId });
    if (!record) throw new NotFoundException('Rilevazione non trovata');
    return record;
  }

  private async validateProject(ownerId: string, projectId: string) {
    const project = await this.projects.findOneBy({ id: projectId, ownerId });
    if (!project) throw new NotFoundException('Progetto non trovato');
    return project;
  }

  private async refreshStatus(record: UsageRecordEntity) {
    const uploads = await this.uploads.find({ where: { id: In(this.uploadIds(record)), ownerId: record.ownerId } });
    let status: 'VALIDATED' | 'MANUAL_REVIEW' = 'MANUAL_REVIEW';
    if (uploads.every((item) => item.status === 'VALIDATED')) {
      const uploadIds = this.uploadIds(record);
      const [snapshots, corrections] = await Promise.all([
        this.snapshots.find({ where: { uploadId: In(uploadIds) } }),
        this.corrections.find({
          where: { uploadId: In(uploadIds), ownerId: record.ownerId },
          order: { createdAt: 'DESC' },
        }),
      ]);
      const effective = new Map<string, SnapshotInput>();
      for (const snapshot of snapshots) effective.set(snapshot.uploadId, snapshot);
      for (const correction of corrections) if (!effective.has(`correction:${correction.uploadId}`)) {
        effective.set(correction.uploadId, correction);
        effective.set(`correction:${correction.uploadId}`, correction);
      }
      const usage = computeRecordUsage(
        record.mode,
        record.singleUploadId ? effective.get(record.singleUploadId) : undefined,
        record.startUploadId ? effective.get(record.startUploadId) : undefined,
        record.endUploadId ? effective.get(record.endUploadId) : undefined,
      );
      status = usage.status === 'WINDOW_MISMATCH' ? 'MANUAL_REVIEW' : 'VALIDATED';
    }
    await this.records.update(record.id, { status });
  }
}
