import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuthController, JwtAuthGuard, JwtStrategy } from './auth';
import { databaseOptions } from './database';
import { CostAnalysisController } from './cost-analysis';
import { DashboardController, ExtraCreditsController } from './dashboard';
import { ENTITIES } from './entities';
import { FormulaService } from './formula';
import { HealthController } from './health';
import { ModelsController } from './models';
import { ProjectsController } from './projects';
import { RecordsController } from './records';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(databaseOptions(true)),
    TypeOrmModule.forFeature(ENTITIES),
    PassportModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '15m') as never },
    }),
  ],
  controllers: [
    AuthController,
    HealthController,
    ProjectsController,
    ModelsController,
    CostAnalysisController,
    RecordsController,
    DashboardController,
    ExtraCreditsController,
  ],
  providers: [
    AuditService,
    FormulaService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
