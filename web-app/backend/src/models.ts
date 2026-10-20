import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuthUser, CurrentUser } from './common';
import { AiModelEntity } from './entities';
import { FIXED_WINDOW } from './fixed-window';

@Controller('models')
export class ModelsController {
  constructor(@InjectRepository(AiModelEntity) private readonly models: Repository<AiModelEntity>) {}

  @Get('window-pricing')
  windowPricing() { return FIXED_WINDOW; }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.models.find({
      where: { ownerId: user.id, catalogAvailable: true, supersededAt: IsNull() },
      order: { name: 'ASC', reasoning: 'ASC' },
    });
  }
}
