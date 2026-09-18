import { MigrationInterface, QueryRunner } from 'typeorm';

export class UsageRecordPurge1726500000005 implements MigrationInterface {
  name = 'UsageRecordPurge1726500000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_snapshot_mutation() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_setting('app.allow_usage_purge', true) = 'on' THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'validated usage snapshots are append-only';
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_setting('app.allow_usage_purge', true) = 'on' THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'audit_events is append-only';
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_snapshot_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'validated usage snapshots are append-only'; END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit_events is append-only'; END;
      $$ LANGUAGE plpgsql;
    `);
  }
}
