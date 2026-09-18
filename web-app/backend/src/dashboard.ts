import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsDateString, IsInt, IsNumber, Min } from 'class-validator';
import { In, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import {
  CaptureTimeObservationEntity,
  ExtraCreditPurchaseEntity,
  ProjectEntity,
  UploadEntity,
  UsageCorrectionEntity,
  UsageRecordEntity,
  UsageSnapshotEntity,
} from './entities';
import { computeRecordUsage } from './records';

class ExtraCreditsDto {
  @IsInt() @Min(1) credits!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) paidEur!: number;
  @IsDateString() purchasedAt!: string;
}

@Controller('dashboard')
export class DashboardController {
  constructor(
    @InjectRepository(UsageRecordEntity) private readonly records: Repository<UsageRecordEntity>,
    @InjectRepository(UploadEntity) private readonly uploads: Repository<UploadEntity>,
    @InjectRepository(UsageCorrectionEntity) private readonly corrections: Repository<UsageCorrectionEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UsageSnapshotEntity) private readonly snapshots: Repository<UsageSnapshotEntity>,
    @InjectRepository(ExtraCreditPurchaseEntity) private readonly purchases: Repository<ExtraCreditPurchaseEntity>,
    @InjectRepository(CaptureTimeObservationEntity) private readonly captureTimes: Repository<CaptureTimeObservationEntity>,
  ) {}

  @Get()
  async summary(@CurrentUser() user: AuthUser) {
    const [records, projects, purchases] = await Promise.all([
      this.records.find({ where: { ownerId: user.id }, order: { createdAt: 'DESC' } }),
      this.projects.find({ where: { ownerId: user.id }, order: { name: 'ASC' } }),
      this.purchases.find({ where: { ownerId: user.id }, order: { purchasedAt: 'DESC' } }),
    ]);
    const uploadIds = records
      .flatMap((item) => [item.singleUploadId, item.startUploadId, item.endUploadId])
      .filter((id): id is string => Boolean(id));
    const [uploads, snapshots, corrections, captureTimes] = await Promise.all([
      uploadIds.length ? this.uploads.find({ where: { id: In(uploadIds), ownerId: user.id } }) : [],
      uploadIds.length ? this.snapshots.find({ where: { uploadId: In(uploadIds) } }) : [],
      uploadIds.length ? this.corrections.find({
        where: { uploadId: In(uploadIds), ownerId: user.id },
        order: { createdAt: 'DESC' },
      }) : [],
      uploadIds.length ? this.captureTimes.find({ where: { uploadId: In(uploadIds), ownerId: user.id }, order: { createdAt: 'DESC' } }) : [],
    ]);
    const uploadById = new Map(uploads.map((item) => [item.id, item]));
    const snapshotByUpload = new Map(snapshots.map((item) => [item.uploadId, item]));
    const correctionByUpload = new Map<string, UsageCorrectionEntity>();
    for (const item of corrections) if (!correctionByUpload.has(item.uploadId)) correctionByUpload.set(item.uploadId, item);
    const captureTimeByUpload = new Map<string, CaptureTimeObservationEntity>();
    for (const item of captureTimes) if (!captureTimeByUpload.has(item.uploadId)) captureTimeByUpload.set(item.uploadId, item);
    const effective = (uploadId: string | null) => uploadId
      ? correctionByUpload.get(uploadId) ?? snapshotByUpload.get(uploadId)
      : undefined;
    const projectById = new Map(projects.map((item) => [item.id, item]));

    const items = records.map((record) => {
      const single = effective(record.singleUploadId);
      const start = effective(record.startUploadId);
      const end = effective(record.endUploadId);
      const captureUploadId = record.mode === 'SEGMENT' ? record.endUploadId : record.singleUploadId;
      const capturedAt = captureUploadId
        ? captureTimeByUpload.get(captureUploadId)?.capturedAt ?? snapshotByUpload.get(captureUploadId)?.capturedAt
        : undefined;
      const usage = computeRecordUsage(record.mode, single, start, end);
      return {
        id: record.id,
        mode: record.mode,
        status: record.status,
        createdAt: record.createdAt,
        capturedAt: capturedAt ?? null,
        note: record.note,
        project: projectById.get(record.projectId) ?? null,
        uploads: [record.singleUploadId, record.startUploadId, record.endUploadId]
          .filter((id): id is string => Boolean(id))
          .map((id) => uploadById.get(id))
          .filter(Boolean)
          .map((upload) => ({ id: upload!.id, role: upload!.role, status: upload!.status })),
        usage,
      };
    });

    const extraCredits = purchases.reduce((sum, item) => sum + Number(item.credits), 0);
    const extraPaidEur = purchases.reduce((sum, item) => sum + Number(item.paidEur), 0);
    const measured = items.filter((item) => item.usage.usedPct !== null);
    return {
      metrics: {
        records: records.length,
        measuredRecords: measured.length,
        segments: items.filter((item) => item.mode === 'SEGMENT').length,
        usedPctSum: measured.reduce((sum, item) => sum + (item.usage.usedPct ?? 0), 0),
        extraCreditsSpent: extraCredits,
        extraPaidEur: Math.round(extraPaidEur * 100) / 100,
      },
      projects: projects.map((project) => ({
        ...project,
        recordCount: items.filter((item) => item.project?.id === project.id).length,
        usedPctSum: items
          .filter((item) => item.project?.id === project.id)
          .reduce((sum, item) => sum + (item.usage.usedPct ?? 0), 0),
      })),
      recentRecords: items
        .slice()
        .sort((left, right) => new Date(right.capturedAt ?? right.createdAt).getTime() - new Date(left.capturedAt ?? left.createdAt).getTime())
        .slice(0, 20),
    };
  }
}

@Controller('extra-credits')
export class ExtraCreditsController {
  constructor(
    @InjectRepository(ExtraCreditPurchaseEntity) private readonly purchases: Repository<ExtraCreditPurchaseEntity>,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.purchases.find({ where: { ownerId: user.id }, order: { purchasedAt: 'DESC' } });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: ExtraCreditsDto) {
    const purchase = await this.purchases.save({
      ownerId: user.id,
      credits: dto.credits,
      paidEur: dto.paidEur,
      purchasedAt: new Date(dto.purchasedAt),
    });
    await this.audit.record(user.id, 'EXTRA_CREDITS_RECORDED', 'extra_credit_purchase', purchase.id, {
      credits: dto.credits,
      paidEur: dto.paidEur,
      residualAssumed: 0,
    });
    return purchase;
  }
}
