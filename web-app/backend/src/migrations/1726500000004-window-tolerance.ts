import { MigrationInterface, QueryRunner } from 'typeorm';

export class WindowTolerance1726500000004 implements MigrationInterface {
  name = 'WindowTolerance1726500000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE usage_records records
      SET status = 'VALIDATED', updated_at = now()
      FROM usage_snapshots start_snapshot, usage_snapshots end_snapshot,
           uploads start_upload, uploads end_upload
      WHERE records.mode = 'SEGMENT'
        AND records.status = 'MANUAL_REVIEW'
        AND start_snapshot.upload_id = records.start_upload_id
        AND end_snapshot.upload_id = records.end_upload_id
        AND start_upload.id = records.start_upload_id
        AND end_upload.id = records.end_upload_id
        AND start_upload.status = 'VALIDATED'
        AND end_upload.status = 'VALIDATED'
        AND abs(extract(epoch FROM (end_snapshot.five_hour_resets_at - start_snapshot.five_hour_resets_at))) <= 3600;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE usage_records records
      SET status = 'MANUAL_REVIEW', updated_at = now()
      FROM usage_snapshots start_snapshot, usage_snapshots end_snapshot
      WHERE records.mode = 'SEGMENT'
        AND records.status = 'VALIDATED'
        AND start_snapshot.upload_id = records.start_upload_id
        AND end_snapshot.upload_id = records.end_upload_id
        AND abs(extract(epoch FROM (end_snapshot.five_hour_resets_at - start_snapshot.five_hour_resets_at))) > 0
        AND abs(extract(epoch FROM (end_snapshot.five_hour_resets_at - start_snapshot.five_hour_resets_at))) <= 3600;
    `);
  }
}
