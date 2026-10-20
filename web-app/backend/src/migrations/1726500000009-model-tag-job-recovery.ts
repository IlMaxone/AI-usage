import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModelTagJobRecovery1726500000009 implements MigrationInterface {
  name = 'ModelTagJobRecovery1726500000009';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE uploads ADD COLUMN model_tag_only boolean NOT NULL DEFAULT false');
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE uploads DROP COLUMN model_tag_only');
  }
}
