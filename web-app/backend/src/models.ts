import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import {
  AiModelEntity,
  BillingCalibrationEntity,
  CalculationRuleEntity,
  FormulaExpression,
  ModelPricing,
} from './entities';
import { FormulaService } from './formula';
import { deriveCalibration } from './calibration';

class ModelDto {
  @IsString() @Length(1, 80) provider!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(1, 80) reasoning!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsObject() pricing!: ModelPricing;
}

class RuleDto {
  @IsString() @Length(1, 100) name!: string;
  @IsString() @Length(1, 40) outputUnit!: string;
  @IsObject() expression!: FormulaExpression;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class CalibrationDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) observedUsagePct!: number;
  @IsInt() @Min(1) observedDurationSeconds!: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) estimatedBilledEur!: number;
  @IsInt() @Min(1) creditPackCredits!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) creditPackPaidEur!: number;
  @IsString() @Length(1, 80) pilotReasoning!: string;
  @IsString() @Length(1, 80) pilotExecutionMode!: string;
  @IsInt() @Min(1) pilotDurationSeconds!: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) pilotBilledEur!: number;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

@Controller('models')
export class ModelsController {
  constructor(
    @InjectRepository(AiModelEntity) private readonly models: Repository<AiModelEntity>,
    @InjectRepository(CalculationRuleEntity) private readonly rules: Repository<CalculationRuleEntity>,
    @InjectRepository(BillingCalibrationEntity) private readonly calibrations: Repository<BillingCalibrationEntity>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly formulas: FormulaService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const models = await this.models.find({
      where: { ownerId: user.id, supersededAt: IsNull() },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
    const rules = await this.rules.find({ where: { ownerId: user.id, supersededAt: IsNull() } });
    const calibrations = await this.calibrations.find({ where: { ownerId: user.id }, order: { recordedAt: 'DESC' } });
    const latestByModel = new Map<string, BillingCalibrationEntity>();
    for (const item of calibrations) if (!latestByModel.has(item.modelId)) latestByModel.set(item.modelId, item);
    return models.map((model) => {
      const raw = latestByModel.get(model.id);
      return {
        ...model,
        rules: rules.filter((rule) => rule.modelId === model.id),
        latestCalibration: raw ? { ...raw, derived: deriveCalibration(raw) } : null,
      };
    });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: ModelDto) {
    this.validatePricing(dto.pricing);
    const model = await this.dataSource.transaction(async (manager) => {
      if (dto.isDefault) await manager.update(AiModelEntity, { ownerId: user.id, isDefault: true }, { isDefault: false });
      return manager.save(AiModelEntity, {
        ownerId: user.id,
        logicalKey: randomUUID(),
        version: 1,
        provider: dto.provider.trim(),
        name: dto.name.trim(),
        reasoning: dto.reasoning.trim(),
        isDefault: dto.isDefault ?? false,
        pricing: dto.pricing,
        calibration: {},
      });
    });
    await this.audit.record(user.id, 'MODEL_CREATED', 'model', model.id);
    return model;
  }

  @Patch(':id')
  async revise(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ModelDto) {
    this.validatePricing(dto.pricing);
    const current = await this.models.findOneBy({ id, ownerId: user.id, supersededAt: IsNull() });
    if (!current) throw new NotFoundException('Modello non trovato');
    const replacement = await this.dataSource.transaction(async (manager) => {
      const supersededAt = new Date();
      await manager.update(AiModelEntity, { id: current.id }, { supersededAt, isDefault: false });
      if (dto.isDefault ?? current.isDefault) {
        await manager.update(AiModelEntity, { ownerId: user.id, isDefault: true }, { isDefault: false });
      }
      return manager.save(AiModelEntity, {
        ownerId: user.id,
        logicalKey: current.logicalKey,
        version: current.version + 1,
        provider: dto.provider.trim(),
        name: dto.name.trim(),
        reasoning: dto.reasoning.trim(),
        isDefault: dto.isDefault ?? current.isDefault,
        pricing: dto.pricing,
        calibration: {},
      });
    });
    await this.audit.record(user.id, 'MODEL_REVISED', 'model', replacement.id, { replaces: current.id });
    return replacement;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const model = await this.models.findOneBy({ id, ownerId: user.id, supersededAt: IsNull() });
    if (!model) throw new NotFoundException('Modello non trovato');
    await this.models.softDelete({ id, ownerId: user.id });
    await this.audit.record(user.id, 'MODEL_DELETED', 'model', id);
    return { deleted: true };
  }

  @Post(':id/rules')
  async addRule(@CurrentUser() user: AuthUser, @Param('id') modelId: string, @Body() dto: RuleDto) {
    await this.ownedModel(modelId, user.id);
    this.formulas.validate(dto.expression);
    const rule = await this.rules.save({
      ownerId: user.id,
      modelId,
      logicalKey: randomUUID(),
      version: 1,
      name: dto.name.trim(),
      outputUnit: dto.outputUnit.trim(),
      expression: dto.expression,
      isDefault: dto.isDefault ?? false,
    });
    await this.audit.record(user.id, 'RULE_CREATED', 'calculation_rule', rule.id, { modelId });
    return rule;
  }

  @Post(':id/calibrations')
  async addCalibration(@CurrentUser() user: AuthUser, @Param('id') modelId: string, @Body() dto: CalibrationDto) {
    await this.ownedModel(modelId, user.id);
    const calibration = await this.calibrations.save({
      ownerId: user.id,
      modelId,
      observedUsagePct: dto.observedUsagePct,
      observedDurationSeconds: dto.observedDurationSeconds,
      estimatedBilledEur: dto.estimatedBilledEur,
      creditPackCredits: dto.creditPackCredits,
      creditPackPaidEur: dto.creditPackPaidEur,
      pilotReasoning: dto.pilotReasoning.trim(),
      pilotExecutionMode: dto.pilotExecutionMode.trim(),
      pilotDurationSeconds: dto.pilotDurationSeconds,
      pilotBilledEur: dto.pilotBilledEur,
      note: dto.note?.trim() || null,
    });
    const derived = deriveCalibration(calibration);
    await this.audit.record(user.id, 'BILLING_CALIBRATION_RECORDED', 'billing_calibration', calibration.id, {
      modelId,
      source: 'user-declared',
    });
    return { ...calibration, derived };
  }

  @Patch(':modelId/rules/:ruleId')
  async reviseRule(
    @CurrentUser() user: AuthUser,
    @Param('modelId') modelId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: RuleDto,
  ) {
    await this.ownedModel(modelId, user.id);
    this.formulas.validate(dto.expression);
    const current = await this.rules.findOneBy({ id: ruleId, modelId, ownerId: user.id, supersededAt: IsNull() });
    if (!current) throw new NotFoundException('Formula non trovata');
    const replacement = await this.dataSource.transaction(async (manager) => {
      await manager.update(CalculationRuleEntity, { id: ruleId }, { supersededAt: new Date() });
      return manager.save(CalculationRuleEntity, {
        ownerId: user.id,
        modelId,
        logicalKey: current.logicalKey,
        version: current.version + 1,
        name: dto.name.trim(),
        outputUnit: dto.outputUnit.trim(),
        expression: dto.expression,
        isDefault: dto.isDefault ?? current.isDefault,
      });
    });
    await this.audit.record(user.id, 'RULE_REVISED', 'calculation_rule', replacement.id, { replaces: ruleId });
    return replacement;
  }

  private async ownedModel(id: string, ownerId: string) {
    const model = await this.models.findOneBy({ id, ownerId, supersededAt: IsNull() });
    if (!model) throw new NotFoundException('Modello non trovato');
    return model;
  }

  private validatePricing(pricing: ModelPricing) {
    if (!pricing || !['USD', 'EUR'].includes(pricing.currency)) throw new NotFoundException('Valuta non valida');
    for (const key of ['inputPerMillion', 'cachedInputPerMillion', 'outputPerMillion'] as const) {
      if (!Number.isFinite(pricing[key]) || pricing[key] < 0) throw new NotFoundException(`Prezzo non valido: ${key}`);
    }
  }
}
