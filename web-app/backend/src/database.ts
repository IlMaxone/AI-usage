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
import { ProjectInbox1726500000007 } from './migrations/1726500000007-project-inbox';
import { ImmutableModelTags1726500000008 } from './migrations/1726500000008-immutable-model-tags';
import { ModelTagJobRecovery1726500000009 } from './migrations/1726500000009-model-tag-job-recovery';
import { CsvModelCatalog1726500000010 } from './migrations/1726500000010-csv-model-catalog';
import { OcrFailureNotifications1726500000011 } from './migrations/1726500000011-ocr-failure-notifications';
import { ReadableProjectFolders1726500000012 } from './migrations/1726500000012-readable-project-folders';
import { OcrErrorDiagnostics1726500000013 } from './migrations/1726500000013-ocr-error-diagnostics';
import { PrivateProjectFolders1726500000014 } from './migrations/1726500000014-private-project-folders';

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
      ProjectInbox1726500000007,
      ImmutableModelTags1726500000008,
      ModelTagJobRecovery1726500000009,
      CsvModelCatalog1726500000010,
      OcrFailureNotifications1726500000011,
      ReadableProjectFolders1726500000012,
      OcrErrorDiagnostics1726500000013,
      PrivateProjectFolders1726500000014,
    ],
    migrationsRun,
    synchronize: false,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  };
}

export const AppDataSource = new DataSource(databaseOptions());
