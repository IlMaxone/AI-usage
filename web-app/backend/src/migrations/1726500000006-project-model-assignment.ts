import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectModelAssignment1726500000006 implements MigrationInterface {
  name = 'ProjectModelAssignment1726500000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE projects ADD COLUMN model_id uuid;
      UPDATE projects AS project
      SET model_id = (
        SELECT candidate.id
        FROM ai_models AS candidate
        WHERE candidate.owner_id = project.owner_id
          AND candidate.superseded_at IS NULL
          AND candidate.deleted_at IS NULL
        ORDER BY candidate.is_default DESC, candidate.created_at ASC
        LIMIT 1
      );
      ALTER TABLE projects
        ADD CONSTRAINT projects_model_id_fkey
        FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE SET NULL;
      CREATE INDEX projects_model_id_idx ON projects(model_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS projects_model_id_idx;
      ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_model_id_fkey;
      ALTER TABLE projects DROP COLUMN IF EXISTS model_id;
    `);
  }
}
