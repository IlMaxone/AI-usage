import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsHexColor, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import { AiModelEntity, ProjectEntity, UploadEntity, UserEntity } from './entities';
import { ensureProjectFolders, ownedProjectFolder, projectFolderName } from './storage';
import { scanProjectInbox } from './inbox';
import { claimProjectName, moveProjectFolder } from './project-folders';
import { recoverUserProjects } from './project-recovery';
import { persistProjectManifest } from './project-manifest';

class ProjectDto {
  @IsString() @Length(1, 100) name!: string;
  @IsOptional() @IsHexColor() color?: string;
}

class UpdateProjectDto {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsHexColor() color?: string;
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
  async list(@CurrentUser() user: AuthUser) {
    await recoverUserProjects(this.dataSource, user.id);
    const projects = await this.projects.find({ where: { ownerId: user.id }, order: { name: 'ASC' } });
    return projects.map((project) => ({ ...project, folder: `projects/${projectFolderName(project)}` }));
  }

  @Get(':id/inbox')
  async inbox(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const project = await this.owned(id, user.id);
    const root = await ensureProjectFolders(project);
    const entries = await fs.readdir(path.join(root, 'to-process'), { withFileTypes: true });
    return { folder: `projects/${projectFolderName(project)}`, files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name) };
  }

  @Post(':id/inbox/scan')
  async scan(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return scanProjectInbox(this.dataSource, await this.owned(id, user.id));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: ProjectDto) {
    const name = dto.name.trim();
    const project = await this.dataSource.transaction(async (manager) => {
      const normalizedName = await claimProjectName(manager, user.id, name);
      const owner = await manager.findOneByOrFail(UserEntity, { id: user.id });
      const id = randomUUID(), storageFolder = ownedProjectFolder(owner.storageOwnerId, id, name);
      return manager.save(ProjectEntity, { id, ownerId: user.id, modelId: null, name, normalizedName, storageFolder, color: dto.color ?? '#9BE15D' });
    });
    await ensureProjectFolders(project);
    const owner = await this.dataSource.getRepository(UserEntity).findOneByOrFail({ id: user.id });
    await persistProjectManifest(project, owner.storageOwnerId);
    await this.audit.record(user.id, 'PROJECT_CREATED', 'project', project.id);
    return project;
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    const project = await this.owned(id, user.id);
    const previousFolder = projectFolderName(project);
    if (dto.name !== undefined) project.name = dto.name.trim();
    if (dto.color !== undefined) project.color = dto.color;
    let operation: Awaited<ReturnType<typeof moveProjectFolder>> | undefined;
    let saved: ProjectEntity;
    try {
      saved = await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [project.id]);
        const current = await manager.findOneByOrFail(ProjectEntity, { id: project.id, ownerId: user.id });
        if (projectFolderName(current) !== previousFolder) throw new ConflictException('Progetto modificato: aggiorna e riprova.');
        const owner = await manager.findOneByOrFail(UserEntity, { id: user.id });
        project.normalizedName = await claimProjectName(manager, user.id, project.name, project.id);
        const nextFolder = ownedProjectFolder(owner.storageOwnerId, project.id, project.name);
        project.storageFolder = nextFolder;
        const projectUploads = previousFolder === nextFolder ? [] : await manager.getRepository(UploadEntity)
          .createQueryBuilder('upload').where('upload.project_id = :id', { id }).setLock('pessimistic_write').getMany();
        if (previousFolder !== nextFolder) {
          if (projectUploads.some((upload) => ['UPLOADED', 'PROCESSING'].includes(upload.status))) {
            throw new BadRequestException('Attendi la fine dell’OCR prima di rinominare il progetto.');
          }
          operation = await moveProjectFolder(manager, project.id, previousFolder, nextFolder);
        }
        const updated = await manager.save(ProjectEntity, project);
        return updated;
      });
    } catch (error) {
      if (operation) await operation.undo();
      throw error;
    }
    if (operation) await operation.finish();
    await this.audit.record(user.id, 'PROJECT_UPDATED', 'project', id, { fields: Object.keys(dto) });
    await ensureProjectFolders(saved);
    const owner = await this.dataSource.getRepository(UserEntity).findOneByOrFail({ id: user.id });
    await persistProjectManifest(saved, owner.storageOwnerId);
    return saved;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.owned(id, user.id);
    const owner = await this.dataSource.getRepository(UserEntity).findOneByOrFail({ id: user.id });
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
        const current = await manager.findOneByOrFail(ProjectEntity, { id, ownerId: user.id });
        await persistProjectManifest({ ...current, deletedAt: new Date() }, owner.storageOwnerId);
        await manager.softDelete(ProjectEntity, { id, ownerId: user.id });
      });
    } catch (error) {
      const current = await this.projects.findOneBy({ id, ownerId: user.id });
      if (current) await persistProjectManifest(current, owner.storageOwnerId);
      throw error;
    }
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
