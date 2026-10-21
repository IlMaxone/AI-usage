import { MigrationInterface, QueryRunner } from 'typeorm';
export class OcrErrorDiagnostics1726500000013 implements MigrationInterface {
  name = 'OcrErrorDiagnostics1726500000013';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE ocr_failure_notifications ADD COLUMN diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb");
  }
  async down(runner: QueryRunner): Promise<void> { await runner.query('ALTER TABLE ocr_failure_notifications DROP COLUMN diagnostics'); }
}
