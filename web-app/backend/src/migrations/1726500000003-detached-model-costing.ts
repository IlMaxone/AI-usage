import { MigrationInterface, QueryRunner } from 'typeorm';

export class DetachedModelCosting1726500000003 implements MigrationInterface {
  name = 'DetachedModelCosting1726500000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE usage_records ALTER COLUMN model_id DROP NOT NULL;
      UPDATE ai_models
      SET pricing = pricing || jsonb_build_object(
        'fiveHourWindowCost', COALESCE((pricing->>'fiveHourWindowCost')::numeric, 0),
        'costPerMinute', COALESCE((pricing->>'costPerMinute')::numeric, 0)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE usage_records records
      SET model_id = (
        SELECT id FROM ai_models
        WHERE owner_id = records.owner_id AND deleted_at IS NULL
        ORDER BY is_default DESC, created_at ASC
        LIMIT 1
      )
      WHERE records.model_id IS NULL;
      ALTER TABLE usage_records ALTER COLUMN model_id SET NOT NULL;
    `);
  }
}
