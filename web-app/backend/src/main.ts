import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';
import { migrateProjectStorage } from './inbox';
import { uploadDir } from './storage';
import { ModelCatalogService } from './model-catalog';

async function bootstrap() {
  await fs.mkdir(uploadDir, { recursive: true });
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  await app.get(ModelCatalogService).loadAndSync();
  await migrateProjectStorage(app.get(DataSource));
  app.setGlobalPrefix('api');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:4200').split(','), credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const config = new DocumentBuilder()
    .setTitle('AI Usage Web API')
    .setDescription('API privata per rilevazioni OCR, progetti, modelli e formule.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
