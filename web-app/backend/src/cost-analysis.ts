import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
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
  UploadEntity,
} from './entities';
import { computeRecordUsage, SnapshotInput } from './records';
import { FIXED_WINDOW } from './fixed-window';
import { currentObservations } from './observations';

import { allocateWindowUsage, groupByWindow } from './usage-allocation';
export { allocateWindowUsage } from './usage-allocation';

export function calculateModelCost(usedPct: number, pricing: ModelPricing) {
  const attributedUsedPct = Math.max(0, Number(usedPct));
  const windowCostAt100 = FIXED_WINDOW.fiveHourWindowCost;
  const costPerMinute = Math.max(0, Number(pricing.costPerMinute));
  const estimatedCost = (attributedUsedPct / 100) * windowCostAt100;
  // Estimated time is driven by attributed usage and the original model's rate.
  // The CSV duration remains a separately declared limit displayed in the catalog.
  const usageMinutesAt100 = costPerMinute > 0 ? windowCostAt100 / costPerMinute : null;
  const estimatedUsageMinutes = costPerMinute > 0 ? estimatedCost / costPerMinute : null;
  return {
    attributedUsedPct: round(attributedUsedPct, 4),
    windowCostAt100: round(windowCostAt100, 14),
    usageMinutesAt100: usageMinutesAt100 === null ? null : round(usageMinutesAt100, 8),
    estimatedCost: round(estimatedCost, 14),
    estimatedUsageMinutes: estimatedUsageMinutes === null ? null : round(estimatedUsageMinutes, 8),
  };
}

export function calculateExploredCost(usedPct: number, source: ModelPricing, target?: ModelPricing) {
  const original = calculateModelCost(usedPct, source);
  const estimatedCost = target
    ? original.estimatedUsageMinutes === null || target.costPerMinute <= 0 ? null : round(original.estimatedUsageMinutes * target.costPerMinute, 14)
    : original.estimatedCost;
  return { ...original, actualEstimatedCost: original.estimatedCost, estimatedCost,
    costDifference: estimatedCost === null ? null : round(estimatedCost - original.estimatedCost, 14) };
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
    @InjectRepository(UploadEntity) private readonly uploads: Repository<UploadEntity>,
  ) {}

  @Get()
  async analyse(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('explore') explore?: string,
    @Query('modelId') modelId?: string,
  ) {
    const exploratory = explore === 'true';
    if ((explore !== undefined && !['true', 'false'].includes(explore)) || (Boolean(modelId) !== exploratory)) {
      throw new BadRequestException('Il modello alternativo richiede la modalità esplorativa.');
    }
    const models = await this.models.find({ where: { ownerId: user.id }, withDeleted: true });
    const byModel = new Map(models.map((model) => [model.id, model]));
    const target = exploratory ? models.find((model) => model.id === modelId && model.catalogAvailable && !model.deletedAt && !model.supersededAt) : undefined;
    if (exploratory && !target) throw new NotFoundException('Modello esplorativo non trovato');
    if (target && target.pricing.costPerMinute <= 0) throw new BadRequestException('Il modello esplorativo richiede un costo al minuto maggiore di zero.');
    const records = await this.records.find({ where: { ownerId: user.id }, order: { createdAt: 'DESC' } });
    const ids = records.flatMap((record) => [record.singleUploadId, record.startUploadId, record.endUploadId]).filter((id): id is string => Boolean(id));
    const projectIds = [...new Set(records.map((record) => record.projectId))];
    const [projects, snapshots, corrections, captureTimes, uploads] = await Promise.all([
      projectIds.length ? this.projects.find({ where: { id: In(projectIds), ownerId: user.id }, withDeleted: true }) : [],
      ids.length ? this.snapshots.findBy({ uploadId: In(ids) }) : [],
      ids.length ? this.corrections.find({ where: { uploadId: In(ids), ownerId: user.id }, order: { createdAt: 'DESC' } }) : [],
      ids.length ? this.captureTimes.find({ where: { uploadId: In(ids), ownerId: user.id }, order: { createdAt: 'DESC' } }) : [],
      ids.length ? this.uploads.findBy({ id: In(ids), ownerId: user.id }) : [],
    ]);
    if (projectId && !projects.some((project) => project.id === projectId)) {
      const ownedProject = await this.projects.findOne({ where: { id: projectId, ownerId: user.id }, withDeleted: true });
      if (!ownedProject) throw new NotFoundException('Progetto non trovato');
    }
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const snapshotByUpload = new Map(snapshots.map((snapshot) => [snapshot.uploadId, snapshot]));
    const uploadById = new Map(uploads.map((upload) => [upload.id, upload]));
    const corrected = new Map<string, UsageCorrectionEntity>();
    for (const item of currentObservations(corrections, snapshots)) if (!corrected.has(item.uploadId)) corrected.set(item.uploadId, item);
    const captures = new Map<string, Date>();
    for (const item of currentObservations(captureTimes, snapshots)) if (!captures.has(item.uploadId)) captures.set(item.uploadId, item.capturedAt);
    const effective = (id: string | null): SnapshotInput | undefined => id ? corrected.get(id) ?? snapshotByUpload.get(id) : undefined;
    const capturedAt = (id: string | null) => id ? captures.get(id) ?? snapshotByUpload.get(id)?.capturedAt : undefined;
    const describe = (model: AiModelEntity) => ({ id: model.id, provider: model.provider, name: model.name, reasoning: model.reasoning, pricing: model.pricing });
    const base = records.flatMap((record) => {
      const single = effective(record.singleUploadId), start = effective(record.startUploadId), end = effective(record.endUploadId);
      const usage = computeRecordUsage(record.mode, single, start, end);
      if (usage.usedPct === null) return [];
      const requiredIds = [record.singleUploadId, record.startUploadId, record.endUploadId].filter((id): id is string => Boolean(id));
      const tags = requiredIds.map((id) => uploadById.get(id)?.modelId);
      const source = tags.length && tags.every((tag) => tag && tag === tags[0]) ? byModel.get(tags[0]!) : undefined;
      const from = capturedAt(record.startUploadId), to = capturedAt(record.mode === 'SEGMENT' ? record.endUploadId : record.singleUploadId);
      return [{ recordId: record.id, project: projectById.get(record.projectId) ?? null, mode: record.mode,
        capturedAt: to ?? record.createdAt, usedPct: usage.usedPct,
        endingUsedPct: Number(record.mode === 'SEGMENT' ? end?.fiveHourUsedPct : single?.fiveHourUsedPct),
        fiveHourResetsAt: (record.mode === 'SEGMENT' ? end?.fiveHourResetsAt : single?.fiveHourResetsAt) ?? null,
        elapsedMinutes: from && to ? round(Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 60000), 2) : null,
        sourceModel: source ? describe(source) : null,
        tagStatus: tags.some((tag) => !tag) ? 'UNTAGGED' : !source ? 'MODEL_MISMATCH' : !source.catalogAvailable ? 'UNAVAILABLE' : 'TAGGED',
      }];
    });
    // Allocate across every project and model before filtering. Cumulative
    // account usage cannot be counted again when the project or model changes.
    const groups = groupByWindow(base);
    const items = groups.flatMap((group) => {
      const allocations = allocateWindowUsage(group.records).allocations;
      return group.records.map((item, index) => {
        const attributedUsedPct = allocations[index]!;
        const cost = item.tagStatus === 'TAGGED' && item.sourceModel ? calculateExploredCost(attributedUsedPct, item.sourceModel.pricing, target?.pricing) : null;
        return { ...item, attributedUsedPct, model: target ? describe(target) : item.sourceModel,
          windowCostAt100: FIXED_WINDOW.fiveHourWindowCost, usageMinutesAt100: cost?.usageMinutesAt100 ?? null,
          estimatedUsageMinutes: cost?.estimatedUsageMinutes ?? null, actualEstimatedCost: cost?.actualEstimatedCost ?? null,
          estimatedCost: cost?.estimatedCost ?? null, costDifference: cost?.costDifference ?? null };
      });
    }).filter((item) => !projectId || item.project?.id === projectId);
    const selectedRecords = records.filter((record) => !projectId || record.projectId === projectId);
    const fullWindow = target ? calculateModelCost(100, target.pricing) : null;
    const summary = {
      records: items.length, windows: groups.filter((group) => group.records.some((record) => !projectId || record.project?.id === projectId)).length,
      unpricedRecords: selectedRecords.length - items.filter((item) => item.estimatedCost !== null).length,
      attributedUsedPct: round(items.reduce((sum, item) => sum + item.attributedUsedPct, 0), 4),
      actualEstimatedCost: round(items.reduce((sum, item) => sum + (item.estimatedCost === null ? 0 : item.actualEstimatedCost ?? 0), 0), 14),
      estimatedCost: round(items.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0), 14),
      costDifference: round(items.reduce((sum, item) => sum + (item.costDifference ?? 0), 0), 14),
      estimatedUsageMinutes: items.every((item) => item.estimatedUsageMinutes !== null) ? round(items.reduce((sum, item) => sum + (item.estimatedUsageMinutes ?? 0), 0), 8) : null,
      windowCostAt100: FIXED_WINDOW.fiveHourWindowCost, usageMinutesAt100: fullWindow?.usageMinutesAt100 ?? null,
    };
    return { exploratory, reference: FIXED_WINDOW, model: target ? describe(target) : null, summary, items };
  }
}
