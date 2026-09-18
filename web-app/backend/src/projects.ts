import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsHexColor, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import { AiModelEntity, ProjectEntity, UploadEntity } from './entities';
import { projectFolderName, uploadDir } from './storage';

class ProjectDto {
  @IsString() @Length(1, 100) name!: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsUUID() modelId?: string;
}

class UpdateProjectDto {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsUUID() modelId?: string;
}

@Controller('projects')
export class ProjectsController {
  constructor(
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AiModelEntity) private readonly models: Repository<AiModelEntity>,
    @InjectRepository(UploadEntity) private readonly uploads: Repository<UploadEntity>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.find({ where: { ownerId: user.id }, order: { name: 'ASC' } });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: ProjectDto) {
    const name = dto.name.trim();
    const duplicate = await this.projects
      .createQueryBuilder('project')
      .where('project.owner_id = :ownerId', { ownerId: user.id })
      .andWhere('lower(project.name) = lower(:name)', { name })
      .getOne();
    if (duplicate) throw new ConflictException('Progetto già presente');
    const modelId = dto.modelId ?? await this.defaultModelId(user.id);
    if (modelId) await this.ownedModel(modelId, user.id);
    const project = await this.projects.save({ ownerId: user.id, modelId, name, color: dto.color ?? '#9BE15D' });
    await this.audit.record(user.id, 'PROJECT_CREATED', 'project', project.id);
    return project;
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    const project = await this.owned(id, user.id);
    const previousFolder = projectFolderName(project);
    if (dto.name !== undefined) project.name = dto.name.trim();
    if (dto.color !== undefined) project.color = dto.color;
    if (dto.modelId !== undefined) {
      await this.ownedModel(dto.modelId, user.id);
      project.modelId = dto.modelId;
    }
    const nextFolder = projectFolderName(project);
    const projectUploads = previousFolder === nextFolder
      ? []
      : await this.uploads.find({ where: { ownerId: user.id, projectId: id } });
    let folderMoved = false;
    if (projectUploads.length) {
      try {
        await fs.rename(path.join(uploadDir, previousFolder), path.join(uploadDir, nextFolder));
        folderMoved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    let saved: ProjectEntity;
    try {
      saved = await this.dataSource.transaction(async (manager) => {
        const updated = await manager.save(ProjectEntity, project);
        if (folderMoved) {
          for (const upload of projectUploads) {
            const fileName = path.posix.basename(upload.storageKey.replace(/\\/g, '/'));
            await manager.update(UploadEntity, upload.id, { storageKey: `${nextFolder}/${fileName}` });
          }
        }
        return updated;
      });
    } catch (error) {
      if (folderMoved) await fs.rename(path.join(uploadDir, nextFolder), path.join(uploadDir, previousFolder)).catch(() => undefined);
      throw error;
    }
    await this.audit.record(user.id, 'PROJECT_UPDATED', 'project', id, { fields: Object.keys(dto) });
    return saved;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.owned(id, user.id);
    await this.projects.softDelete({ id, ownerId: user.id });
    await this.audit.record(user.id, 'PROJECT_DELETED', 'project', id);
    return { deleted: true };
  }

  private async owned(id: string, ownerId: string) {
    const project = await this.projects.findOneBy({ id, ownerId });
    if (!project) throw new NotFoundException('Progetto non trovato');
    return project;
  }

  private async ownedModel(id: string, ownerId: string) {
    const model = await this.models.findOneBy({ id, ownerId, supersededAt: IsNull() });
    if (!model) throw new NotFoundException('Modello non trovato');
    return model;
  }

  private async defaultModelId(ownerId: string) {
    const model = await this.models.findOne({
      where: { ownerId, supersededAt: IsNull() },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
    return model?.id ?? null;
  }
}
