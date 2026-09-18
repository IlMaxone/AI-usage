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

const WINDOW_ALIGNMENT_TOLERANCE_MS = 60 * 60_000;

export function calculateModelCost(usedPct: number, pricing: ModelPricing) {
  const attributedUsedPct = Math.min(100, Math.max(0, Number(usedPct)));
  const maximumWindowCost = Math.max(0, Number(pricing.fiveHourWindowCost));
  const costPerMinute = Math.max(0, Number(pricing.costPerMinute));
  const estimatedCost = (attributedUsedPct / 100) * maximumWindowCost;
  const maximumUsageMinutes = costPerMinute > 0 ? maximumWindowCost / costPerMinute : null;
  const estimatedUsageMinutes = costPerMinute > 0 ? estimatedCost / costPerMinute : null;
  return {
    attributedUsedPct: round(attributedUsedPct, 4),
    maximumWindowCost: round(maximumWindowCost, 14),
    maximumUsageMinutes: maximumUsageMinutes === null ? null : round(maximumUsageMinutes, 8),
    estimatedCost: round(Math.min(estimatedCost, maximumWindowCost), 14),
    estimatedUsageMinutes: estimatedUsageMinutes === null
      ? null
      : round(Math.min(estimatedUsageMinutes, maximumUsageMinutes!), 8),
    remainingWindowCost: round(Math.max(0, maximumWindowCost - estimatedCost), 14),
  };
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function allocateWindowUsage(values: number[]) {
  const normalized = values.map((value) => Math.max(0, Number(value)));
  const rawUsedPct = normalized.reduce((sum, value) => sum + value, 0);
  const allocationScale = rawUsedPct > 100 ? 100 / rawUsedPct : 1;
  return {
    rawUsedPct: round(rawUsedPct, 4),
    attributedUsedPct: round(Math.min(100, rawUsedPct), 4),
    cappedByWindow: allocationScale < 1,
    allocations: normalized.map((value) => round(value * allocationScale, 8)),
  };
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

    const baseItems = records.flatMap((record) => {
      const single = effective(record.singleUploadId);
      const start = effective(record.startUploadId);
      const end = effective(record.endUploadId);
      const usage = computeRecordUsage(
        record.mode,
        single,
        start,
        end,
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
        fiveHourResetsAt: record.mode === 'SEGMENT'
          ? end?.fiveHourResetsAt ?? null
          : single?.fiveHourResetsAt ?? null,
        elapsedMinutes,
      }];
    });

    const groupedWindows: Array<{ anchor: number | null; resetAt: Date | string | null; records: typeof baseItems }> = [];
    for (const item of baseItems) {
      const resetTime = item.fiveHourResetsAt ? new Date(item.fiveHourResetsAt).getTime() : null;
      const group = resetTime === null
        ? undefined
        : groupedWindows.find((candidate) => candidate.anchor !== null
          && Math.abs(candidate.anchor - resetTime) <= WINDOW_ALIGNMENT_TOLERANCE_MS);
      if (group) group.records.push(item);
      else groupedWindows.push({ anchor: resetTime, resetAt: item.fiveHourResetsAt, records: [item] });
    }

    const costsByRecord = new Map<string, ReturnType<typeof calculateModelCost> & { cappedByWindow: boolean }>();
    const windows = groupedWindows.map((group) => {
      const allocation = allocateWindowUsage(group.records.map((item) => item.usedPct));
      for (const [index, item] of group.records.entries()) {
        costsByRecord.set(item.recordId, {
          ...calculateModelCost(allocation.allocations[index]!, model.pricing),
          cappedByWindow: allocation.cappedByWindow,
        });
      }
      return {
        resetsAt: group.resetAt,
        records: group.records.length,
        rawUsedPct: allocation.rawUsedPct,
        cappedByWindow: allocation.cappedByWindow,
        ...calculateModelCost(allocation.attributedUsedPct, model.pricing),
      };
    });

    const items = baseItems.map((item) => ({ ...item, ...costsByRecord.get(item.recordId)! }));
    const totalEstimatedMinutes = windows.every((window) => window.estimatedUsageMinutes !== null)
      ? windows.reduce((sum, window) => sum + (window.estimatedUsageMinutes ?? 0), 0)
      : null;
    const fullWindow = calculateModelCost(100, model.pricing);

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
        windows: windows.length,
        cappedWindows: windows.filter((window) => window.cappedByWindow).length,
        attributedUsedPct: round(windows.reduce((sum, window) => sum + window.attributedUsedPct, 0), 4),
        estimatedCost: round(windows.reduce((sum, window) => sum + window.estimatedCost, 0), 14),
        estimatedUsageMinutes: totalEstimatedMinutes === null ? null : round(totalEstimatedMinutes, 8),
        maximumWindowCost: fullWindow.maximumWindowCost,
        maximumUsageMinutesPerWindow: fullWindow.maximumUsageMinutes,
      },
      items,
      windows,
    };
  }
}
