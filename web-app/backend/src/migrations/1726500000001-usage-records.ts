import { MigrationInterface, QueryRunner } from 'typeorm';

export class UsageRecords1726500000001 implements MigrationInterface {
  name = 'UsageRecords1726500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE usage_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
        project_id uuid NOT NULL REFERENCES projects(id), model_id uuid NOT NULL REFERENCES ai_models(id),
        mode varchar(12) NOT NULL CHECK (mode IN ('CONSTANT','SEGMENT')),
        status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','VALIDATING','VALIDATED','MANUAL_REVIEW','FAILED')),
        single_upload_id uuid, start_upload_id uuid, end_upload_id uuid, note text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
        CHECK (
          (mode = 'CONSTANT' AND start_upload_id IS NULL AND end_upload_id IS NULL)
          OR (mode = 'SEGMENT' AND single_upload_id IS NULL)
        )
      );
      CREATE INDEX usage_records_owner_created ON usage_records(owner_id, created_at DESC) WHERE deleted_at IS NULL;

      ALTER TABLE uploads ADD COLUMN record_id uuid REFERENCES usage_records(id);
      CREATE INDEX uploads_record_id ON uploads(record_id);
      ALTER TABLE uploads DROP CONSTRAINT uploads_status_check;
      ALTER TABLE uploads ADD CONSTRAINT uploads_status_check
        CHECK (status IN ('DRAFT','UPLOADED','PROCESSING','VALIDATED','MANUAL_REVIEW','FAILED'));
      ALTER TABLE usage_records ADD CONSTRAINT usage_records_single_upload_fk FOREIGN KEY (single_upload_id) REFERENCES uploads(id);
      ALTER TABLE usage_records ADD CONSTRAINT usage_records_start_upload_fk FOREIGN KEY (start_upload_id) REFERENCES uploads(id);
      ALTER TABLE usage_records ADD CONSTRAINT usage_records_end_upload_fk FOREIGN KEY (end_upload_id) REFERENCES uploads(id);

      CREATE TABLE usage_corrections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
        record_id uuid NOT NULL REFERENCES usage_records(id), upload_id uuid NOT NULL REFERENCES uploads(id),
        five_hour_remaining_pct numeric(5,2) NOT NULL CHECK (five_hour_remaining_pct BETWEEN 0 AND 100),
        five_hour_used_pct numeric(5,2) NOT NULL CHECK (five_hour_used_pct BETWEEN 0 AND 100),
        five_hour_resets_at timestamptz NOT NULL,
        weekly_remaining_pct numeric(5,2) NOT NULL CHECK (weekly_remaining_pct BETWEEN 0 AND 100),
        weekly_used_pct numeric(5,2) NOT NULL CHECK (weekly_used_pct BETWEEN 0 AND 100),
        weekly_resets_on date NOT NULL, reason varchar(500) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX usage_corrections_upload_created ON usage_corrections(upload_id, created_at DESC);
      CREATE TRIGGER usage_corrections_no_update BEFORE UPDATE OR DELETE ON usage_corrections
      FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS usage_corrections CASCADE;
      ALTER TABLE usage_records DROP CONSTRAINT IF EXISTS usage_records_single_upload_fk;
      ALTER TABLE usage_records DROP CONSTRAINT IF EXISTS usage_records_start_upload_fk;
      ALTER TABLE usage_records DROP CONSTRAINT IF EXISTS usage_records_end_upload_fk;
      ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_status_check;
      ALTER TABLE uploads ADD CONSTRAINT uploads_status_check
        CHECK (status IN ('UPLOADED','PROCESSING','VALIDATED','MANUAL_REVIEW','FAILED'));
      ALTER TABLE uploads DROP COLUMN IF EXISTS record_id;
      DROP TABLE IF EXISTS usage_records CASCADE;
    `);
  }
}
