import { MigrationInterface, QueryRunner } from 'typeorm';

export class CsvModelCatalog1726500000010 implements MigrationInterface {
  name = 'CsvModelCatalog1726500000010';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE ai_models ADD COLUMN catalog_key varchar(100), ADD COLUMN catalog_available boolean NOT NULL DEFAULT false,
        ADD COLUMN catalog_sha256 char(64), ADD COLUMN catalog_synced_at timestamptz;
      CREATE UNIQUE INDEX ai_models_owner_catalog_key ON ai_models(owner_id, catalog_key) WHERE catalog_key IS NOT NULL;
      CREATE TABLE model_catalog_sources (sha256 char(64) PRIMARY KEY, file_name text NOT NULL, rows jsonb NOT NULL, loaded_at timestamptz NOT NULL DEFAULT now());
      CREATE TRIGGER model_catalog_sources_no_update BEFORE UPDATE OR DELETE ON model_catalog_sources
        FOR EACH ROW EXECUTE FUNCTION reject_credit_mutation();
      CREATE OR REPLACE FUNCTION enforce_fixed_model_pricing() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL AND (
          NEW.provider IS DISTINCT FROM OLD.provider OR NEW.name IS DISTINCT FROM OLD.name OR
          NEW.reasoning IS DISTINCT FROM OLD.reasoning OR NEW.locked_at IS DISTINCT FROM OLD.locked_at OR
          NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
        ) THEN RAISE EXCEPTION 'a model used by OCR has an immutable identity'; END IF;
        IF NEW.pricing->>'currency' IS DISTINCT FROM 'EUR' OR (NEW.pricing->>'fiveHourWindowCost')::numeric IS DISTINCT FROM 13.54 THEN
          RAISE EXCEPTION 'the five-hour window reference is fixed at EUR 13.54';
        END IF;
        IF current_setting('app.catalog_sync', true) IS DISTINCT FROM 'on' AND (
          TG_OP = 'INSERT' OR NEW.pricing IS DISTINCT FROM OLD.pricing OR
          NEW.catalog_key IS DISTINCT FROM OLD.catalog_key OR NEW.catalog_available IS DISTINCT FROM OLD.catalog_available OR
          NEW.provider IS DISTINCT FROM OLD.provider OR NEW.name IS DISTINCT FROM OLD.name OR NEW.reasoning IS DISTINCT FROM OLD.reasoning
        ) THEN RAISE EXCEPTION 'models and prices are managed only by the startup CSV catalog'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE OR REPLACE FUNCTION enforce_ocr_model_tag() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'UPDATE' AND OLD.model_id IS NOT NULL AND (
          NEW.model_id IS DISTINCT FROM OLD.model_id OR NEW.model_tagged_at IS DISTINCT FROM OLD.model_tagged_at
        ) THEN RAISE EXCEPTION 'the OCR model tag is immutable'; END IF;
        IF NEW.model_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.model_id IS NULL) THEN
          IF current_setting('app.allow_model_tag', true) IS DISTINCT FROM 'on' OR NOT EXISTS (
            SELECT 1 FROM ai_models WHERE id = NEW.model_id AND owner_id = NEW.owner_id AND deleted_at IS NULL AND catalog_available = true
          ) THEN RAISE EXCEPTION 'OCR tags require an available model from the CSV catalog'; END IF;
          NEW.model_tagged_at = now();
          UPDATE ai_models SET locked_at = COALESCE(locked_at, now()) WHERE id = NEW.model_id;
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);
  }
  async down(): Promise<void> {
    throw new Error('CSV catalog rollback requires an explicit data migration; model tags and import history must be preserved.');
  }
}
