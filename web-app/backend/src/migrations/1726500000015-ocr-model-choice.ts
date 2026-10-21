import { MigrationInterface, QueryRunner } from 'typeorm';

export class OcrModelChoice1726500000015 implements MigrationInterface {
  name = 'OcrModelChoice1726500000015';
  async up(runner: QueryRunner) {
    await runner.query('ALTER TABLE uploads ADD COLUMN model_choice jsonb; ALTER TABLE ocr_failure_notifications ADD COLUMN model_choice jsonb');
  }
  async down(runner: QueryRunner) {
    await runner.query('ALTER TABLE uploads DROP COLUMN model_choice; ALTER TABLE ocr_failure_notifications DROP COLUMN model_choice');
  }
}
