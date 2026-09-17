import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsHexColor, IsOptional, IsString, Length } from 'class-validator';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import { ProjectEntity, UploadEntity } from './entities';
import { projectFolderName, uploadDir } from './storage';

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
    const project = await this.projects.save({ ownerId: user.id, name, color: dto.color ?? '#9BE15D' });
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
}
