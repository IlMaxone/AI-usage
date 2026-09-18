import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { InitialSchema1726500000000 } from './migrations/1726500000000-initial-schema';
import { UsageRecords1726500000001 } from './migrations/1726500000001-usage-records';
import { CaptureTimeObservations1726500000002 } from './migrations/1726500000002-capture-time-observations';
import { DetachedModelCosting1726500000003 } from './migrations/1726500000003-detached-model-costing';
import { WindowTolerance1726500000004 } from './migrations/1726500000004-window-tolerance';
import { UsageRecordPurge1726500000005 } from './migrations/1726500000005-usage-record-purge';
import { ProjectModelAssignment1726500000006 } from './migrations/1726500000006-project-model-assignment';

export function databaseOptions(migrationsRun = false) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return {
    type: 'postgres' as const,
    url,
    entities: ENTITIES,
    migrations: [
      InitialSchema1726500000000,
      UsageRecords1726500000001,
      CaptureTimeObservations1726500000002,
      DetachedModelCosting1726500000003,
      WindowTolerance1726500000004,
      UsageRecordPurge1726500000005,
      ProjectModelAssignment1726500000006,
    ],
    migrationsRun,
    synchronize: false,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  };
}

export const AppDataSource = new DataSource(databaseOptions());
