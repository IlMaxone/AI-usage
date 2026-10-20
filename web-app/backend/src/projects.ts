import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsHexColor, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import { AiModelEntity, ProjectEntity, UploadEntity } from './entities';
import { ensureProjectFolders, projectFolderName, uploadDir } from './storage';
import { scanProjectInbox } from './inbox';

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
    const duplicate = await this.projects
      .createQueryBuilder('project')
      .where('project.owner_id = :ownerId', { ownerId: user.id })
      .andWhere('lower(project.name) = lower(:name)', { name })
      .getOne();
    if (duplicate) throw new ConflictException('Progetto già presente');
    const project = await this.projects.save({ ownerId: user.id, modelId: null, name, color: dto.color ?? '#9BE15D' });
    await ensureProjectFolders(project);
    await this.audit.record(user.id, 'PROJECT_CREATED', 'project', project.id);
    return project;
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    const project = await this.owned(id, user.id);
    const previousFolder = projectFolderName(project);
    if (dto.name !== undefined) project.name = dto.name.trim();
    if (dto.color !== undefined) project.color = dto.color;
    const nextFolder = projectFolderName(project);
    let folderMoved = false;
    let saved: ProjectEntity;
    try {
      saved = await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [project.id]);
        const current = await manager.findOneByOrFail(ProjectEntity, { id: project.id, ownerId: user.id });
        if (projectFolderName(current) !== previousFolder) throw new ConflictException('Progetto modificato: aggiorna e riprova.');
        const projectUploads = previousFolder === nextFolder ? [] : await manager.getRepository(UploadEntity)
          .createQueryBuilder('upload').where('upload.project_id = :id', { id }).setLock('pessimistic_write').getMany();
        if (previousFolder !== nextFolder) {
          if (projectUploads.some((upload) => ['UPLOADED', 'PROCESSING'].includes(upload.status))) {
            throw new BadRequestException('Attendi la fine dell’OCR prima di rinominare il progetto.');
          }
          try {
            await fs.rename(path.join(uploadDir, previousFolder), path.join(uploadDir, nextFolder));
            folderMoved = true;
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        const updated = await manager.save(ProjectEntity, project);
        if (folderMoved) {
          for (const upload of projectUploads) {
            const key = upload.storageKey.replace(/\\/g, '/');
            if (key.startsWith(previousFolder + '/')) {
              await manager.update(UploadEntity, upload.id, { storageKey: nextFolder + key.slice(previousFolder.length) });
            }
          }
        }
        return updated;
      });
    } catch (error) {
      if (folderMoved) await fs.rename(path.join(uploadDir, nextFolder), path.join(uploadDir, previousFolder)).catch(() => undefined);
      throw error;
    }
    await this.audit.record(user.id, 'PROJECT_UPDATED', 'project', id, { fields: Object.keys(dto) });
    await ensureProjectFolders(saved);
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
