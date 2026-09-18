import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AuthUser, CurrentUser } from './common';
import {
  AiModelEntity,
  CaptureTimeObservationEntity,
  ModelPricing,
  ProjectEntity,
  UsageCorrectionEntity,
  UsageRecordEntity,
  UsageSnapshotEntity,
} from './entities';
import { computeRecordUsage, SnapshotInput } from './records';

const WINDOW_MINUTES = 5 * 60;

export function calculateModelCost(usedPct: number, pricing: ModelPricing) {
  const equivalentUsageMinutes = (usedPct / 100) * WINDOW_MINUTES;
  const windowBasedCost = (usedPct / 100) * Number(pricing.fiveHourWindowCost);
  const minuteBasedCost = equivalentUsageMinutes * Number(pricing.costPerMinute);
  return {
    equivalentUsageMinutes: round(equivalentUsageMinutes, 2),
    windowBasedCost: round(windowBasedCost, 14),
    minuteBasedCost: round(minuteBasedCost, 14),
    difference: round(minuteBasedCost - windowBasedCost, 14),
  };
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

@Controller('cost-analysis')
export class CostAnalysisController {
  constructor(
    @InjectRepository(AiModelEntity) private readonly models: Repository<AiModelEntity>,
    @InjectRepository(UsageRecordEntity) private readonly records: Repository<UsageRecordEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UsageSnapshotEntity) private readonly snapshots: Repository<UsageSnapshotEntity>,
    @InjectRepository(UsageCorrectionEntity) private readonly corrections: Repository<UsageCorrectionEntity>,
    @InjectRepository(CaptureTimeObservationEntity) private readonly captureTimes: Repository<CaptureTimeObservationEntity>,
  ) {}

  @Get(':modelId')
  async analyse(
    @CurrentUser() user: AuthUser,
    @Param('modelId') modelId: string,
    @Query('projectId') projectId?: string,
  ) {
    const model = await this.models.findOneBy({ id: modelId, ownerId: user.id, supersededAt: IsNull() });
    if (!model) throw new NotFoundException('Modello non trovato');

    const allRecords = await this.records.find({ where: { ownerId: user.id }, order: { createdAt: 'DESC' } });
    const records = projectId ? allRecords.filter((record) => record.projectId === projectId) : allRecords;
    const uploadIds = records
      .flatMap((record) => [record.singleUploadId, record.startUploadId, record.endUploadId])
      .filter((id): id is string => Boolean(id));
    const projectIds = [...new Set(records.map((record) => record.projectId))];
    const [projects, snapshots, corrections, captureTimes] = await Promise.all([
      projectIds.length ? this.projects.find({ where: { id: In(projectIds), ownerId: user.id }, withDeleted: true }) : [],
      uploadIds.length ? this.snapshots.find({ where: { uploadId: In(uploadIds) } }) : [],
      uploadIds.length ? this.corrections.find({
        where: { uploadId: In(uploadIds), ownerId: user.id },
        order: { createdAt: 'DESC' },
      }) : [],
      uploadIds.length ? this.captureTimes.find({
        where: { uploadId: In(uploadIds), ownerId: user.id },
        order: { createdAt: 'DESC' },
      }) : [],
    ]);

    const projectById = new Map(projects.map((project) => [project.id, project]));
    const snapshotByUpload = new Map(snapshots.map((snapshot) => [snapshot.uploadId, snapshot]));
    const correctionByUpload = new Map<string, UsageCorrectionEntity>();
    for (const item of corrections) if (!correctionByUpload.has(item.uploadId)) correctionByUpload.set(item.uploadId, item);
    const captureByUpload = new Map<string, CaptureTimeObservationEntity>();
    for (const item of captureTimes) if (!captureByUpload.has(item.uploadId)) captureByUpload.set(item.uploadId, item);
    const effective = (uploadId: string | null): SnapshotInput | undefined => uploadId
      ? correctionByUpload.get(uploadId) ?? snapshotByUpload.get(uploadId)
      : undefined;
    const capturedAt = (uploadId: string | null) => uploadId
      ? captureByUpload.get(uploadId)?.capturedAt ?? snapshotByUpload.get(uploadId)?.capturedAt ?? null
      : null;

    const items = records.flatMap((record) => {
      const usage = computeRecordUsage(
        record.mode,
        effective(record.singleUploadId),
        effective(record.startUploadId),
        effective(record.endUploadId),
      );
      if (usage.usedPct === null) return [];
      const startAt = capturedAt(record.startUploadId);
      const endAt = capturedAt(record.mode === 'SEGMENT' ? record.endUploadId : record.singleUploadId);
      const elapsedMinutes = startAt && endAt
        ? round(Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000), 2)
        : null;
      return [{
        recordId: record.id,
        project: projectById.get(record.projectId) ?? null,
        mode: record.mode,
        capturedAt: endAt ?? record.createdAt,
        usedPct: usage.usedPct,
        elapsedMinutes,
        ...calculateModelCost(usage.usedPct, model.pricing),
      }];
    });

    const totals = items.reduce((result, item) => ({
      usedPct: result.usedPct + item.usedPct,
      equivalentUsageMinutes: result.equivalentUsageMinutes + item.equivalentUsageMinutes,
      windowBasedCost: result.windowBasedCost + item.windowBasedCost,
      minuteBasedCost: result.minuteBasedCost + item.minuteBasedCost,
    }), { usedPct: 0, equivalentUsageMinutes: 0, windowBasedCost: 0, minuteBasedCost: 0 });

    return {
      model: {
        id: model.id,
        provider: model.provider,
        name: model.name,
        reasoning: model.reasoning,
        pricing: model.pricing,
      },
      summary: {
        records: items.length,
        usedPct: round(totals.usedPct, 2),
        equivalentUsageMinutes: round(totals.equivalentUsageMinutes, 2),
        windowBasedCost: round(totals.windowBasedCost, 14),
        minuteBasedCost: round(totals.minuteBasedCost, 14),
        difference: round(totals.minuteBasedCost - totals.windowBasedCost, 14),
      },
      items,
    };
  }
}
