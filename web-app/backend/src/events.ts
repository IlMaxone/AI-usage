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
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsDateString, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { In, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import {
  AiModelEntity,
  ProjectEntity,
  UploadEntity,
  UsageEventEntity,
  UsageSnapshotEntity,
} from './entities';

class CreateEventDto {
  @IsUUID() projectId!: string;
  @IsUUID() modelId!: string;
  @IsString() @Length(1, 160) title!: string;
  @IsDateString() startsAt!: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsString() @Length(0, 4000) notes?: string;
}

class UpdateEventDto {
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() modelId?: string;
  @IsOptional() @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsString() @Length(0, 4000) notes?: string;
}

export interface SnapshotInput {
  fiveHourUsedPct: number | string;
  fiveHourResetsAt: Date;
}

export function computeEventUsage(start?: SnapshotInput, end?: SnapshotInput) {
  if (!end) return { status: start ? 'WAITING_FOR_END' : 'NO_USAGE', usedPct: null };
  const endValue = Number(end.fiveHourUsedPct);
  if (!start) return { status: 'END_ONLY', usedPct: endValue };
  if (new Date(start.fiveHourResetsAt).getTime() !== new Date(end.fiveHourResetsAt).getTime()) {
    return { status: 'WINDOW_MISMATCH', usedPct: null };
  }
  return { status: 'PAIRED', usedPct: Math.max(0, endValue - Number(start.fiveHourUsedPct)) };
}

@Controller('events')
export class EventsController {
  constructor(
    @InjectRepository(UsageEventEntity) private readonly events: Repository<UsageEventEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AiModelEntity) private readonly models: Repository<AiModelEntity>,
    @InjectRepository(UploadEntity) private readonly uploads: Repository<UploadEntity>,
    @InjectRepository(UsageSnapshotEntity) private readonly snapshots: Repository<UsageSnapshotEntity>,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const events = await this.events.find({ where: { ownerId: user.id }, order: { startsAt: 'DESC' } });
    const uploadIds = events.flatMap((item) => [item.startUploadId, item.endUploadId]).filter((id): id is string => Boolean(id));
    const snapshots = uploadIds.length ? await this.snapshots.find({ where: { uploadId: In(uploadIds) } }) : [];
    const byUpload = new Map(snapshots.map((item) => [item.uploadId, item]));
    return events.map((event) => {
      const start = event.startUploadId ? byUpload.get(event.startUploadId) : undefined;
      const end = event.endUploadId ? byUpload.get(event.endUploadId) : undefined;
      return { ...event, startSnapshot: start ?? null, endSnapshot: end ?? null, usage: computeEventUsage(start, end) };
    });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    await this.validateReferences(user.id, dto.projectId, dto.modelId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt < startsAt) throw new BadRequestException('La fine precede l’inizio');
    const event = await this.events.save({
      ownerId: user.id,
      projectId: dto.projectId,
      modelId: dto.modelId,
      title: dto.title.trim(),
      startsAt,
      endsAt,
      notes: dto.notes?.trim() || null,
    });
    await this.audit.record(user.id, 'EVENT_CREATED', 'usage_event', event.id);
    return event;
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    const event = await this.owned(id, user.id);
    const projectId = dto.projectId ?? event.projectId;
    const modelId = dto.modelId ?? event.modelId;
    await this.validateReferences(user.id, projectId, modelId);
    if (dto.title !== undefined) event.title = dto.title.trim();
    if (dto.projectId !== undefined) event.projectId = dto.projectId;
    if (dto.modelId !== undefined) event.modelId = dto.modelId;
    if (dto.startsAt !== undefined) event.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) event.endsAt = new Date(dto.endsAt);
    if (dto.notes !== undefined) event.notes = dto.notes.trim() || null;
    if (event.endsAt && event.endsAt < event.startsAt) throw new BadRequestException('La fine precede l’inizio');
    const saved = await this.events.save(event);
    await this.audit.record(user.id, 'EVENT_UPDATED', 'usage_event', id, { fields: Object.keys(dto) });
    return saved;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.owned(id, user.id);
    await this.events.softDelete({ id, ownerId: user.id });
    await this.audit.record(user.id, 'EVENT_DELETED', 'usage_event', id);
    return { deleted: true };
  }

  private async owned(id: string, ownerId: string) {
    const event = await this.events.findOneBy({ id, ownerId });
    if (!event) throw new NotFoundException('Evento non trovato');
    return event;
  }

  private async validateReferences(ownerId: string, projectId: string, modelId: string) {
    const [project, model] = await Promise.all([
      this.projects.findOneBy({ id: projectId, ownerId }),
      this.models.findOneBy({ id: modelId, ownerId }),
    ]);
    if (!project) throw new NotFoundException('Progetto non trovato');
    if (!model) throw new NotFoundException('Modello non trovato');
  }
}
