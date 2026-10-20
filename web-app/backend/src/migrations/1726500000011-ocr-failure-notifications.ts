import { MigrationInterface, QueryRunner } from 'typeorm';

export class OcrFailureNotifications1726500000011 implements MigrationInterface {
  name = 'OcrFailureNotifications1726500000011';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE uploads ADD COLUMN pending_ocr jsonb, ADD COLUMN prior_upload jsonb;
    CREATE TABLE ocr_failure_notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
      project_id uuid NOT NULL REFERENCES projects(id), upload_id uuid NOT NULL, record_id uuid,
      original_name varchar(255) NOT NULL, reason varchar(500) NOT NULL,
      pair_number varchar(255), files jsonb NOT NULL DEFAULT '[]'::jsonb, storage_key varchar(255) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
    );
    CREATE UNIQUE INDEX ocr_failure_active_upload ON ocr_failure_notifications(upload_id) WHERE resolved_at IS NULL;
    CREATE INDEX ocr_failure_owner ON ocr_failure_notifications(owner_id, created_at DESC) WHERE resolved_at IS NULL;`);
  }
  async down(runner: QueryRunner): Promise<void> { await runner.query('DROP TABLE ocr_failure_notifications; ALTER TABLE uploads DROP COLUMN pending_ocr, DROP COLUMN prior_upload'); }
}
