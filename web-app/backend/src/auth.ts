import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ExecutionContext,
  Injectable,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DataSource, Repository } from 'typeorm';
import { IS_PUBLIC_KEY, Public, publicUser } from './common';
import {
  AiModelEntity,
  AuditEventEntity,
  CalculationRuleEntity,
  ProjectEntity,
  UserEntity,
} from './entities';

class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @Length(2, 120) displayName!: string;
  @IsString() @MinLength(12) password!: string;
}

class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@InjectRepository(UserEntity) private readonly users: Repository<UserEntity>) {
    const secret = process.env.JWT_SECRET ?? '';
    if (secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret });
  }

  async validate(payload: { sub?: string }): Promise<{ id: string; email: string; displayName: string }> {
    if (!payload.sub) throw new UnauthorizedException();
    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user) throw new UnauthorizedException();
    return publicUser(user);
  }
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    return super.canActivate(context);
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.exist({ where: { email } })) throw new ConflictException('Email già registrata');
    const passwordHash = await hash(dto.password, 12);

    const user = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(UserEntity, {
        email,
        displayName: dto.displayName.trim(),
        passwordHash,
      });
      const logicalKey = randomUUID();
      const model = await manager.save(AiModelEntity, {
        ownerId: created.id,
        logicalKey,
        version: 1,
        provider: 'OpenAI',
        name: 'GPT-5.6 Sol',
        reasoning: 'high',
        isDefault: true,
        pricing: {
          currency: 'USD',
          fiveHourWindowCost: 0,
          costPerMinute: 0,
        },
        calibration: {},
      });
      await manager.save(CalculationRuleEntity, {
        ownerId: created.id,
        modelId: model.id,
        logicalKey: randomUUID(),
        version: 1,
        name: 'Crediti calibrati per finestra 5h',
        outputUnit: 'crediti',
        isDefault: true,
        expression: {
          operation: 'multiply',
          args: [
            { operation: 'divide', args: [{ variable: 'usedPct' }, 100] },
            { variable: 'fullWindowCredits' },
          ],
        },
      });
      await manager.save(ProjectEntity, {
        ownerId: created.id,
        modelId: model.id,
        name: 'Generale',
        color: '#9BE15D',
      });
      await manager.insert(AuditEventEntity, {
        ownerId: created.id,
        action: 'USER_REGISTERED',
        entityType: 'user',
        entityId: created.id,
        metadata: {},
      });
      return created;
    });
    return this.issueToken(user);
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.users.findOneBy({ email: dto.email.trim().toLowerCase() });
    const valid = user ? await compare(dto.password, user.passwordHash) : false;
    if (!user || !valid) throw new UnauthorizedException('Credenziali non valide');
    return this.issueToken(user);
  }

  private issueToken(user: UserEntity) {
    if (!user.id) throw new BadRequestException();
    return {
      accessToken: this.jwt.sign({ sub: user.id, email: user.email }),
      expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
      user: publicUser(user),
    };
  }
}
