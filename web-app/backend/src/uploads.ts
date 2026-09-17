import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { Express } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import { ProjectEntity, UploadEntity, UploadRole, UsageEventEntity } from './entities';

class UploadDto {
  @IsUUID() projectId!: string;
  @IsOptional() @IsUUID() eventId?: string;
  @IsIn(['SINGLE', 'START', 'END']) role!: UploadRole;
}

const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp']);
const uploadDir = process.env.UPLOAD_DIR ?? path.resolve('storage/uploads');

@Controller('uploads')
export class UploadsController {
  constructor(
    @InjectRepository(UploadEntity) private readonly uploads: Repository<UploadEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UsageEventEntity) private readonly events: Repository<UsageEventEntity>,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.uploads.find({ where: { ownerId: user.id }, order: { createdAt: 'DESC' }, take: 100 });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: uploadDir,
      filename: (_request, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 10_485_760), files: 1 },
    fileFilter: (_request, file, callback) => callback(null, allowedMime.has(file.mimetype)),
  }))
  async upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Immagine PNG, JPEG o WebP richiesta');
    let event: UsageEventEntity | null = null;
    let upload: UploadEntity;
    try {
      const project = await this.projects.findOneBy({ id: dto.projectId, ownerId: user.id });
      if (!project) throw new NotFoundException('Progetto non trovato');
      if (dto.eventId) {
        event = await this.events.findOneBy({ id: dto.eventId, ownerId: user.id, projectId: dto.projectId });
        if (!event) throw new NotFoundException('Evento non trovato nel progetto');
      }
      if ((dto.role === 'START' || dto.role === 'END') && !event) {
        throw new BadRequestException('Gli screenshot inizio/fine richiedono un evento');
      }
      upload = await this.uploads.save({
        ownerId: user.id,
        projectId: dto.projectId,
        eventId: event?.id ?? null,
        role: dto.role,
        originalName: path.basename(file.originalname).slice(0, 255),
        storageKey: file.filename,
        mime: file.mimetype,
        size: file.size,
        status: 'UPLOADED',
      });
    } catch (error) {
      await fs.unlink(file.path).catch(() => undefined);
      throw error;
    }
    if (event && dto.role === 'START') await this.events.update(event.id, { startUploadId: upload.id });
    if (event && (dto.role === 'END' || dto.role === 'SINGLE')) {
      await this.events.update(event.id, { endUploadId: upload.id });
    }
    await this.audit.record(user.id, 'UPLOAD_RECEIVED', 'upload', upload.id, {
      projectId: dto.projectId,
      eventId: event?.id ?? null,
      role: dto.role,
      size: file.size,
    });
    return upload;
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const upload = await this.uploads.findOneBy({ id, ownerId: user.id });
    if (!upload) throw new NotFoundException('Upload non trovato');
    return upload;
  }
}
