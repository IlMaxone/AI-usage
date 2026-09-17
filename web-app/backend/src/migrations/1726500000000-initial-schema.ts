import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1726500000000 implements MigrationInterface {
  name = 'InitialSchema1726500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(320) NOT NULL UNIQUE,
        password_hash varchar(100) NOT NULL,
        display_name varchar(120) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE TABLE projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
        name varchar(100) NOT NULL, color varchar(7) NOT NULL DEFAULT '#9BE15D',
        created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
      );
      CREATE UNIQUE INDEX projects_owner_name_active ON projects(owner_id, lower(name)) WHERE deleted_at IS NULL;

      CREATE TABLE ai_models (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
        logical_key uuid NOT NULL, version integer NOT NULL CHECK (version > 0),
        provider varchar(80) NOT NULL, name varchar(120) NOT NULL, reasoning varchar(80) NOT NULL,
        is_default boolean NOT NULL DEFAULT false, pricing jsonb NOT NULL, calibration jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz, deleted_at timestamptz,
        UNIQUE(owner_id, logical_key, version)
      );
      CREATE UNIQUE INDEX ai_models_one_default ON ai_models(owner_id) WHERE is_default AND superseded_at IS NULL AND deleted_at IS NULL;

      CREATE TABLE calculation_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
        model_id uuid NOT NULL REFERENCES ai_models(id), logical_key uuid NOT NULL,
        version integer NOT NULL CHECK (version > 0), name varchar(100) NOT NULL,
        output_unit varchar(40) NOT NULL, expression jsonb NOT NULL, is_default boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz, deleted_at timestamptz,
        UNIQUE(owner_id, logical_key, version)
      );

      CREATE TABLE usage_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
        project_id uuid NOT NULL REFERENCES projects(id), model_id uuid NOT NULL REFERENCES ai_models(id),
        title varchar(160) NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz,
        start_upload_id uuid, end_upload_id uuid, notes text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
        CHECK (ends_at IS NULL OR ends_at >= starts_at)
      );

      CREATE TABLE uploads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
        project_id uuid NOT NULL REFERENCES projects(id), event_id uuid REFERENCES usage_events(id),
        role varchar(10) NOT NULL CHECK (role IN ('SINGLE','START','END')),
        original_name varchar(255) NOT NULL, storage_key varchar(255) NOT NULL UNIQUE,
        mime varchar(80) NOT NULL, size integer NOT NULL CHECK (size > 0), sha256 char(64),
        status varchar(20) NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED','PROCESSING','VALIDATED','MANUAL_REVIEW','FAILED')),
        review_reason varchar(500), created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
      );
      CREATE UNIQUE INDEX uploads_owner_sha ON uploads(owner_id, sha256) WHERE sha256 IS NOT NULL;
      ALTER TABLE usage_events ADD CONSTRAINT usage_events_start_upload_fk FOREIGN KEY (start_upload_id) REFERENCES uploads(id);
      ALTER TABLE usage_events ADD CONSTRAINT usage_events_end_upload_fk FOREIGN KEY (end_upload_id) REFERENCES uploads(id);

      CREATE TABLE usage_snapshots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), upload_id uuid NOT NULL UNIQUE REFERENCES uploads(id),
        captured_at timestamptz NOT NULL,
        five_hour_remaining_pct numeric(5,2) NOT NULL CHECK (five_hour_remaining_pct BETWEEN 0 AND 100),
        five_hour_used_pct numeric(5,2) NOT NULL CHECK (five_hour_used_pct BETWEEN 0 AND 100),
        five_hour_resets_at timestamptz NOT NULL,
        weekly_remaining_pct numeric(5,2) NOT NULL CHECK (weekly_remaining_pct BETWEEN 0 AND 100),
        weekly_used_pct numeric(5,2) NOT NULL CHECK (weekly_used_pct BETWEEN 0 AND 100),
        weekly_resets_on date NOT NULL, ocr_confidence numeric(5,2) NOT NULL,
        validation jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE extra_credit_purchases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
        credits integer NOT NULL CHECK (credits > 0), paid_eur numeric(12,2) NOT NULL CHECK (paid_eur > 0),
        purchased_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE billing_calibrations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
        model_id uuid NOT NULL REFERENCES ai_models(id),
        observed_usage_pct numeric(5,2) NOT NULL CHECK (observed_usage_pct > 0 AND observed_usage_pct <= 100),
        observed_duration_seconds integer NOT NULL CHECK (observed_duration_seconds > 0),
        estimated_billed_eur numeric(12,4) NOT NULL CHECK (estimated_billed_eur > 0),
        credit_pack_credits integer NOT NULL CHECK (credit_pack_credits > 0),
        credit_pack_paid_eur numeric(12,2) NOT NULL CHECK (credit_pack_paid_eur > 0),
        pilot_reasoning varchar(80) NOT NULL, pilot_execution_mode varchar(80) NOT NULL,
        pilot_duration_seconds integer NOT NULL CHECK (pilot_duration_seconds > 0),
        pilot_billed_eur numeric(12,4) NOT NULL CHECK (pilot_billed_eur > 0),
        note text, recorded_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX billing_calibrations_model_recorded ON billing_calibrations(owner_id, model_id, recorded_at DESC);

      CREATE TABLE audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid REFERENCES users(id),
        action varchar(80) NOT NULL, entity_type varchar(80) NOT NULL, entity_id uuid,
        metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX audit_events_owner_created ON audit_events(owner_id, created_at DESC);

      CREATE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit_events is append-only'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

      CREATE FUNCTION reject_snapshot_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'validated usage snapshots are append-only'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER usage_snapshots_no_update BEFORE UPDATE OR DELETE ON usage_snapshots
      FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();

      CREATE FUNCTION reject_credit_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'extra credit purchases are append-only'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER extra_credits_no_update BEFORE UPDATE OR DELETE ON extra_credit_purchases
      FOR EACH ROW EXECUTE FUNCTION reject_credit_mutation();

      CREATE TRIGGER billing_calibrations_no_update BEFORE UPDATE OR DELETE ON billing_calibrations
      FOR EACH ROW EXECUTE FUNCTION reject_credit_mutation();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS audit_events CASCADE;
      DROP TABLE IF EXISTS extra_credit_purchases CASCADE;
      DROP TABLE IF EXISTS billing_calibrations CASCADE;
      DROP TABLE IF EXISTS usage_snapshots CASCADE;
      DROP TABLE IF EXISTS uploads CASCADE;
      DROP TABLE IF EXISTS usage_events CASCADE;
      DROP TABLE IF EXISTS calculation_rules CASCADE;
      DROP TABLE IF EXISTS ai_models CASCADE;
      DROP TABLE IF EXISTS projects CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP FUNCTION IF EXISTS reject_audit_mutation();
      DROP FUNCTION IF EXISTS reject_snapshot_mutation();
      DROP FUNCTION IF EXISTS reject_credit_mutation();
    `);
  }
}
