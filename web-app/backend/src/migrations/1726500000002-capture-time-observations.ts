import { MigrationInterface, QueryRunner } from 'typeorm';

export class CaptureTimeObservations1726500000002 implements MigrationInterface {
  name = 'CaptureTimeObservations1726500000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE capture_time_observations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES users(id),
        upload_id uuid NOT NULL REFERENCES uploads(id),
        captured_at timestamptz NOT NULL,
        reason varchar(500) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX capture_time_observations_upload_created
        ON capture_time_observations(upload_id, created_at DESC);
      CREATE TRIGGER capture_time_observations_no_update
        BEFORE UPDATE OR DELETE ON capture_time_observations
        FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS capture_time_observations CASCADE');
  }
}
