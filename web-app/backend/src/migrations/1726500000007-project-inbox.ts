import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectInbox1726500000007 implements MigrationInterface {
  name = 'ProjectInbox1726500000007';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP INDEX uploads_owner_sha;
      ALTER TABLE uploads ADD COLUMN inbox_fingerprint varchar(160);
      CREATE INDEX uploads_project_sha ON uploads(owner_id, project_id, sha256) WHERE sha256 IS NOT NULL;
      CREATE TABLE ocr_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        upload_id uuid NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        snapshot jsonb NOT NULL,
        replaced_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TRIGGER ocr_revisions_no_update BEFORE UPDATE OR DELETE ON ocr_revisions
        FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
      CREATE OR REPLACE FUNCTION reject_snapshot_mutation() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_setting('app.allow_usage_purge', true) = 'on' THEN RETURN OLD; END IF;
        IF TG_OP = 'UPDATE' AND current_setting('app.allow_ocr_replace', true) = 'on' THEN
          INSERT INTO ocr_revisions(upload_id, snapshot) VALUES (OLD.upload_id, to_jsonb(OLD));
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'validated usage snapshots require a tracked OCR replacement';
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    // May fail if different projects now legitimately contain the same image.
    await runner.query(`
      DROP TABLE ocr_revisions;
      ALTER TABLE uploads DROP COLUMN inbox_fingerprint;
      DROP INDEX uploads_project_sha;
      CREATE UNIQUE INDEX uploads_owner_sha ON uploads(owner_id, sha256) WHERE sha256 IS NOT NULL;
      CREATE OR REPLACE FUNCTION reject_snapshot_mutation() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_setting('app.allow_usage_purge', true) = 'on' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'validated usage snapshots are append-only';
      END;
      $$ LANGUAGE plpgsql;
    `);
  }
}
