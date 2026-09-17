import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsHexColor, IsOptional, IsString, Length } from 'class-validator';
import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuthUser, CurrentUser } from './common';
import { ProjectEntity, UsageEventEntity } from './entities';

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
    @InjectRepository(UsageEventEntity) private readonly events: Repository<UsageEventEntity>,
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
    if (dto.name !== undefined) project.name = dto.name.trim();
    if (dto.color !== undefined) project.color = dto.color;
    const saved = await this.projects.save(project);
    await this.audit.record(user.id, 'PROJECT_UPDATED', 'project', id, { fields: Object.keys(dto) });
    return saved;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.owned(id, user.id);
    if (await this.events.exist({ where: { ownerId: user.id, projectId: id } })) {
      throw new ConflictException('Il progetto contiene eventi: elimina prima gli eventi attivi');
    }
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
