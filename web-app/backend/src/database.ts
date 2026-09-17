import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { InitialSchema1726500000000 } from './migrations/1726500000000-initial-schema';
import { UsageRecords1726500000001 } from './migrations/1726500000001-usage-records';

export function databaseOptions(migrationsRun = false) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return {
    type: 'postgres' as const,
    url,
    entities: ENTITIES,
    migrations: [InitialSchema1726500000000, UsageRecords1726500000001],
    migrationsRun,
    synchronize: false,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  };
}

export const AppDataSource = new DataSource(databaseOptions());
