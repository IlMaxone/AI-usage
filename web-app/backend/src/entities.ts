import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index({ unique: true }) @Column({ type: 'varchar', length: 320 }) email!: string;
  @Column({ name: 'password_hash', type: 'varchar', length: 100 }) passwordHash!: string;
  @Column({ name: 'display_name', type: 'varchar', length: 120 }) displayName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
}

@Entity('projects')
@Index(['ownerId', 'name'], { unique: true, where: 'deleted_at IS NULL' })
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'model_id', type: 'uuid', nullable: true }) modelId!: string | null;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @Column({ type: 'varchar', length: 7, default: '#9BE15D' }) color!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
}

export interface ModelPricing {
  currency: 'USD' | 'EUR';
  fiveHourWindowCost: number;
  costPerMinute: number;
  inputPerMillion?: number;
  cachedInputPerMillion?: number;
  outputPerMillion?: number;
  creditsPerMillionInput?: number;
  creditsPerMillionCachedInput?: number;
  creditsPerMillionOutput?: number;
}

export interface ModelCalibration {
  fullWindowCredits?: number;
  fullWindowEur?: number;
  fullWindowPilotMinutes?: number;
}

@Entity('ai_models')
@Index(['ownerId', 'logicalKey', 'version'], { unique: true })
export class AiModelEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'logical_key', type: 'uuid' }) logicalKey!: string;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'varchar', length: 80 }) provider!: string;
  @Column({ type: 'varchar', length: 120 }) name!: string;
  @Column({ type: 'varchar', length: 80 }) reasoning!: string;
  @Column({ name: 'is_default', type: 'boolean', default: false }) isDefault!: boolean;
  @Column({ type: 'jsonb' }) pricing!: ModelPricing;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) calibration!: ModelCalibration;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true }) supersededAt!: Date | null;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
}

export type FormulaExpression =
  | number
  | { variable: string }
  | { operation: 'add' | 'subtract' | 'multiply' | 'divide' | 'min' | 'max'; args: FormulaExpression[] };

@Entity('calculation_rules')
@Index(['ownerId', 'logicalKey', 'version'], { unique: true })
export class CalculationRuleEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'model_id', type: 'uuid' }) modelId!: string;
  @Column({ name: 'logical_key', type: 'uuid' }) logicalKey!: string;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @Column({ name: 'output_unit', type: 'varchar', length: 40 }) outputUnit!: string;
  @Column({ type: 'jsonb' }) expression!: FormulaExpression;
  @Column({ name: 'is_default', type: 'boolean', default: false }) isDefault!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true }) supersededAt!: Date | null;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
}

@Entity('usage_events')
export class UsageEventEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'model_id', type: 'uuid' }) modelId!: string;
  @Column({ type: 'varchar', length: 160 }) title!: string;
  @Column({ name: 'starts_at', type: 'timestamptz' }) startsAt!: Date;
  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true }) endsAt!: Date | null;
  @Column({ name: 'start_upload_id', type: 'uuid', nullable: true }) startUploadId!: string | null;
  @Column({ name: 'end_upload_id', type: 'uuid', nullable: true }) endUploadId!: string | null;
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
}

export type UsageRecordMode = 'CONSTANT' | 'SEGMENT';
export type UsageRecordStatus = 'DRAFT' | 'VALIDATING' | 'VALIDATED' | 'MANUAL_REVIEW' | 'FAILED';

@Entity('usage_records')
export class UsageRecordEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'model_id', type: 'uuid', nullable: true }) modelId!: string | null;
  @Column({ type: 'varchar', length: 12 }) mode!: UsageRecordMode;
  @Column({ type: 'varchar', length: 20, default: 'DRAFT' }) status!: UsageRecordStatus;
  @Column({ name: 'single_upload_id', type: 'uuid', nullable: true }) singleUploadId!: string | null;
  @Column({ name: 'start_upload_id', type: 'uuid', nullable: true }) startUploadId!: string | null;
  @Column({ name: 'end_upload_id', type: 'uuid', nullable: true }) endUploadId!: string | null;
  @Column({ type: 'text', nullable: true }) note!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
}

export type UploadRole = 'SINGLE' | 'START' | 'END';
export type UploadStatus = 'DRAFT' | 'UPLOADED' | 'PROCESSING' | 'VALIDATED' | 'MANUAL_REVIEW' | 'FAILED';

@Entity('uploads')
@Index(['ownerId', 'sha256'], { unique: true, where: 'sha256 IS NOT NULL' })
export class UploadEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'event_id', type: 'uuid', nullable: true }) eventId!: string | null;
  @Column({ name: 'record_id', type: 'uuid', nullable: true }) recordId!: string | null;
  @Column({ type: 'varchar', length: 10 }) role!: UploadRole;
  @Column({ name: 'original_name', type: 'varchar', length: 255 }) originalName!: string;
  @Column({ name: 'storage_key', type: 'varchar', length: 255, unique: true }) storageKey!: string;
  @Column({ type: 'varchar', length: 80 }) mime!: string;
  @Column({ type: 'integer' }) size!: number;
  @Column({ type: 'char', length: 64, nullable: true }) sha256!: string | null;
  @Column({ type: 'varchar', length: 20, default: 'UPLOADED' }) status!: UploadStatus;
  @Column({ name: 'review_reason', type: 'varchar', length: 500, nullable: true }) reviewReason!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true }) processedAt!: Date | null;
}

@Entity('usage_snapshots')
export class UsageSnapshotEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index({ unique: true }) @Column({ name: 'upload_id', type: 'uuid' }) uploadId!: string;
  @Column({ name: 'captured_at', type: 'timestamptz' }) capturedAt!: Date;
  @Column({ name: 'five_hour_remaining_pct', type: 'decimal', precision: 5, scale: 2 }) fiveHourRemainingPct!: number;
  @Column({ name: 'five_hour_used_pct', type: 'decimal', precision: 5, scale: 2 }) fiveHourUsedPct!: number;
  @Column({ name: 'five_hour_resets_at', type: 'timestamptz' }) fiveHourResetsAt!: Date;
  @Column({ name: 'weekly_remaining_pct', type: 'decimal', precision: 5, scale: 2 }) weeklyRemainingPct!: number;
  @Column({ name: 'weekly_used_pct', type: 'decimal', precision: 5, scale: 2 }) weeklyUsedPct!: number;
  @Column({ name: 'weekly_resets_on', type: 'date' }) weeklyResetsOn!: string;
  @Column({ name: 'ocr_confidence', type: 'decimal', precision: 5, scale: 2 }) ocrConfidence!: number;
  @Column({ type: 'jsonb' }) validation!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity('usage_corrections')
export class UsageCorrectionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'record_id', type: 'uuid' }) recordId!: string;
  @Column({ name: 'upload_id', type: 'uuid' }) uploadId!: string;
  @Column({ name: 'five_hour_remaining_pct', type: 'decimal', precision: 5, scale: 2 }) fiveHourRemainingPct!: number;
  @Column({ name: 'five_hour_used_pct', type: 'decimal', precision: 5, scale: 2 }) fiveHourUsedPct!: number;
  @Column({ name: 'five_hour_resets_at', type: 'timestamptz' }) fiveHourResetsAt!: Date;
  @Column({ name: 'weekly_remaining_pct', type: 'decimal', precision: 5, scale: 2 }) weeklyRemainingPct!: number;
  @Column({ name: 'weekly_used_pct', type: 'decimal', precision: 5, scale: 2 }) weeklyUsedPct!: number;
  @Column({ name: 'weekly_resets_on', type: 'date' }) weeklyResetsOn!: string;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity('capture_time_observations')
export class CaptureTimeObservationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'upload_id', type: 'uuid' }) uploadId!: string;
  @Column({ name: 'captured_at', type: 'timestamptz' }) capturedAt!: Date;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity('extra_credit_purchases')
export class ExtraCreditPurchaseEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ type: 'integer' }) credits!: number;
  @Column({ name: 'paid_eur', type: 'decimal', precision: 12, scale: 2 }) paidEur!: number;
  @Column({ name: 'purchased_at', type: 'timestamptz' }) purchasedAt!: Date;
  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' }) recordedAt!: Date;
}

@Entity('billing_calibrations')
export class BillingCalibrationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'model_id', type: 'uuid' }) modelId!: string;
  @Column({ name: 'observed_usage_pct', type: 'decimal', precision: 5, scale: 2 }) observedUsagePct!: number;
  @Column({ name: 'observed_duration_seconds', type: 'integer' }) observedDurationSeconds!: number;
  @Column({ name: 'estimated_billed_eur', type: 'decimal', precision: 12, scale: 4 }) estimatedBilledEur!: number;
  @Column({ name: 'credit_pack_credits', type: 'integer' }) creditPackCredits!: number;
  @Column({ name: 'credit_pack_paid_eur', type: 'decimal', precision: 12, scale: 2 }) creditPackPaidEur!: number;
  @Column({ name: 'pilot_reasoning', type: 'varchar', length: 80 }) pilotReasoning!: string;
  @Column({ name: 'pilot_execution_mode', type: 'varchar', length: 80 }) pilotExecutionMode!: string;
  @Column({ name: 'pilot_duration_seconds', type: 'integer' }) pilotDurationSeconds!: number;
  @Column({ name: 'pilot_billed_eur', type: 'decimal', precision: 12, scale: 4 }) pilotBilledEur!: number;
  @Column({ type: 'text', nullable: true }) note!: string | null;
  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' }) recordedAt!: Date;
}

@Entity('audit_events')
export class AuditEventEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid', nullable: true }) ownerId!: string | null;
  @Column({ type: 'varchar', length: 80 }) action!: string;
  @Column({ name: 'entity_type', type: 'varchar', length: 80 }) entityType!: string;
  @Column({ name: 'entity_id', type: 'uuid', nullable: true }) entityId!: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) metadata!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

export const ENTITIES = [
  UserEntity,
  ProjectEntity,
  AiModelEntity,
  CalculationRuleEntity,
  UsageEventEntity,
  UsageRecordEntity,
  UploadEntity,
  UsageSnapshotEntity,
  UsageCorrectionEntity,
  CaptureTimeObservationEntity,
  ExtraCreditPurchaseEntity,
  BillingCalibrationEntity,
  AuditEventEntity,
];
