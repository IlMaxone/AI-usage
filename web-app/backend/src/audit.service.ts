import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEventEntity } from './entities';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEventEntity) private readonly repository: Repository<AuditEventEntity>,
  ) {}

  async record(
    ownerId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.repository.save(this.repository.create({ ownerId, action, entityType, entityId, metadata }));
  }
}
