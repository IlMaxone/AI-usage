import { MigrationInterface, QueryRunner } from 'typeorm';

export class ImmutableModelTags1726500000008 implements MigrationInterface {
  name = 'ImmutableModelTags1726500000008';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE ai_models ADD COLUMN locked_at timestamptz;
      ALTER TABLE uploads ADD COLUMN model_id uuid REFERENCES ai_models(id);
      ALTER TABLE uploads ADD COLUMN model_tagged_at timestamptz;
      CREATE INDEX uploads_model_id_idx ON uploads(model_id);
      UPDATE ai_models SET pricing = pricing || '{"currency":"EUR","fiveHourWindowCost":13.54}'::jsonb;
      UPDATE projects SET model_id = NULL;
      UPDATE usage_records SET model_id = NULL;

      CREATE FUNCTION enforce_fixed_model_pricing() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL AND (
          NEW.provider IS DISTINCT FROM OLD.provider OR NEW.name IS DISTINCT FROM OLD.name OR
          NEW.reasoning IS DISTINCT FROM OLD.reasoning OR NEW.pricing IS DISTINCT FROM OLD.pricing OR
          NEW.locked_at IS DISTINCT FROM OLD.locked_at OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR
          NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
        ) THEN RAISE EXCEPTION 'a model used by OCR is immutable'; END IF;
        IF NEW.pricing->>'currency' IS DISTINCT FROM 'EUR' OR
           (NEW.pricing->>'fiveHourWindowCost')::numeric IS DISTINCT FROM 13.54 THEN
          RAISE EXCEPTION 'the five-hour window reference is fixed at EUR 13.54';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER ai_models_fixed_pricing BEFORE INSERT OR UPDATE ON ai_models
        FOR EACH ROW EXECUTE FUNCTION enforce_fixed_model_pricing();

      CREATE FUNCTION enforce_ocr_model_tag() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'UPDATE' AND OLD.model_id IS NOT NULL AND (
          NEW.model_id IS DISTINCT FROM OLD.model_id OR NEW.model_tagged_at IS DISTINCT FROM OLD.model_tagged_at
        ) THEN RAISE EXCEPTION 'the OCR model tag is immutable'; END IF;
        IF NEW.model_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.model_id IS NULL) THEN
          IF current_setting('app.allow_model_tag', true) IS DISTINCT FROM 'on' OR NOT EXISTS (
            SELECT 1 FROM ai_models WHERE id = NEW.model_id AND owner_id = NEW.owner_id AND deleted_at IS NULL
          ) THEN RAISE EXCEPTION 'the model must be tagged by OCR for its owner'; END IF;
          NEW.model_tagged_at = now();
          UPDATE ai_models SET locked_at = COALESCE(locked_at, now()) WHERE id = NEW.model_id;
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER uploads_immutable_model BEFORE INSERT OR UPDATE ON uploads
        FOR EACH ROW EXECUTE FUNCTION enforce_ocr_model_tag();
      CREATE FUNCTION reject_project_model_assignment() RETURNS trigger AS $$
      BEGIN
        IF NEW.model_id IS NOT NULL THEN RAISE EXCEPTION 'models are assigned only by screenshot OCR'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER projects_no_model_override BEFORE INSERT OR UPDATE ON projects
        FOR EACH ROW EXECUTE FUNCTION reject_project_model_assignment();
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP TRIGGER projects_no_model_override ON projects;
      DROP FUNCTION reject_project_model_assignment();
      DROP TRIGGER uploads_immutable_model ON uploads;
      DROP FUNCTION enforce_ocr_model_tag();
      DROP TRIGGER ai_models_fixed_pricing ON ai_models;
      DROP FUNCTION enforce_fixed_model_pricing();
      ALTER TABLE uploads DROP COLUMN model_id, DROP COLUMN model_tagged_at;
      ALTER TABLE ai_models DROP COLUMN locked_at;
    `);
  }
}
