import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsDateString, IsInt, IsNumber, Min } from 'class-validator';
import { In, IsNull, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { deriveCalibration } from './calibration';
import { AuthUser, CurrentUser } from './common';
import {
  AiModelEntity,
  BillingCalibrationEntity,
  CalculationRuleEntity,
  ExtraCreditPurchaseEntity,
  ProjectEntity,
  UploadEntity,
  UsageCorrectionEntity,
  UsageRecordEntity,
  UsageSnapshotEntity,
} from './entities';
import { FormulaService } from './formula';
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
    @InjectRepository(AiModelEntity) private readonly models: Repository<AiModelEntity>,
    @InjectRepository(CalculationRuleEntity) private readonly rules: Repository<CalculationRuleEntity>,
    @InjectRepository(UsageSnapshotEntity) private readonly snapshots: Repository<UsageSnapshotEntity>,
    @InjectRepository(ExtraCreditPurchaseEntity) private readonly purchases: Repository<ExtraCreditPurchaseEntity>,
    @InjectRepository(BillingCalibrationEntity) private readonly calibrations: Repository<BillingCalibrationEntity>,
    private readonly formulas: FormulaService,
  ) {}

  @Get()
  async summary(@CurrentUser() user: AuthUser) {
    const [records, projects, purchases, calibrations] = await Promise.all([
      this.records.find({ where: { ownerId: user.id }, order: { createdAt: 'DESC' } }),
      this.projects.find({ where: { ownerId: user.id }, order: { name: 'ASC' } }),
      this.purchases.find({ where: { ownerId: user.id }, order: { purchasedAt: 'DESC' } }),
      this.calibrations.find({ where: { ownerId: user.id }, order: { recordedAt: 'DESC' } }),
    ]);
    const uploadIds = records
      .flatMap((item) => [item.singleUploadId, item.startUploadId, item.endUploadId])
      .filter((id): id is string => Boolean(id));
    const modelIds = [...new Set(records.map((item) => item.modelId))];
    const [uploads, snapshots, corrections, models, rules] = await Promise.all([
      uploadIds.length ? this.uploads.find({ where: { id: In(uploadIds), ownerId: user.id } }) : [],
      uploadIds.length ? this.snapshots.find({ where: { uploadId: In(uploadIds) } }) : [],
      uploadIds.length ? this.corrections.find({
        where: { uploadId: In(uploadIds), ownerId: user.id },
        order: { createdAt: 'DESC' },
      }) : [],
      modelIds.length ? this.models.find({ where: { id: In(modelIds), ownerId: user.id }, withDeleted: true }) : [],
      modelIds.length ? this.rules.find({
        where: { modelId: In(modelIds), ownerId: user.id, isDefault: true, supersededAt: IsNull() },
        order: { createdAt: 'ASC' },
      }) : [],
    ]);
    const uploadById = new Map(uploads.map((item) => [item.id, item]));
    const snapshotByUpload = new Map(snapshots.map((item) => [item.uploadId, item]));
    const correctionByUpload = new Map<string, UsageCorrectionEntity>();
    for (const item of corrections) if (!correctionByUpload.has(item.uploadId)) correctionByUpload.set(item.uploadId, item);
    const effective = (uploadId: string | null) => uploadId
      ? correctionByUpload.get(uploadId) ?? snapshotByUpload.get(uploadId)
      : undefined;
    const modelById = new Map(models.map((item) => [item.id, item]));
    const ruleByModel = new Map(rules.map((item) => [item.modelId, item]));
    const projectById = new Map(projects.map((item) => [item.id, item]));
    const calibrationByModel = new Map<string, BillingCalibrationEntity>();
    for (const item of calibrations) if (!calibrationByModel.has(item.modelId)) calibrationByModel.set(item.modelId, item);

    const items = records.map((record) => {
      const single = effective(record.singleUploadId);
      const start = effective(record.startUploadId);
      const end = effective(record.endUploadId);
      const usage = computeRecordUsage(record.mode, single, start, end);
      const model = modelById.get(record.modelId);
      const rule = ruleByModel.get(record.modelId);
      const rawCalibration = calibrationByModel.get(record.modelId);
      let calculated: { value: number; unit: string; ruleName: string } | null = null;
      if (usage.usedPct !== null && model && rule) {
        try {
          const derived = rawCalibration ? deriveCalibration(rawCalibration) : null;
          const variables: Record<string, number> = {
            usedPct: usage.usedPct,
            inputPerMillion: model.pricing.inputPerMillion,
            cachedInputPerMillion: model.pricing.cachedInputPerMillion,
            outputPerMillion: model.pricing.outputPerMillion,
          };
          if (derived) Object.assign(variables, derived);
          calculated = {
            value: this.formulas.evaluate(rule.expression, variables),
            unit: rule.outputUnit,
            ruleName: rule.name,
          };
        } catch {
          calculated = null;
        }
      }
      return {
        id: record.id,
        mode: record.mode,
        status: record.status,
        createdAt: record.createdAt,
        note: record.note,
        project: projectById.get(record.projectId) ?? null,
        model: model ? { id: model.id, name: model.name, provider: model.provider, reasoning: model.reasoning } : null,
        uploads: [record.singleUploadId, record.startUploadId, record.endUploadId]
          .filter((id): id is string => Boolean(id))
          .map((id) => uploadById.get(id))
          .filter(Boolean)
          .map((upload) => ({ id: upload!.id, role: upload!.role, status: upload!.status })),
        usage,
        calculated,
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
      recentRecords: items.slice(0, 20),
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
