import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrivateProjectFolders1726500000014 implements MigrationInterface {
  name = 'PrivateProjectFolders1726500000014';
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE users ADD COLUMN storage_owner_id uuid;
      UPDATE users SET storage_owner_id=id;
      ALTER TABLE users ALTER COLUMN storage_owner_id SET NOT NULL;
      ALTER TABLE users ALTER COLUMN storage_owner_id SET DEFAULT gen_random_uuid();
      CREATE UNIQUE INDEX users_storage_owner_id ON users(storage_owner_id);
      ALTER TABLE projects ALTER COLUMN storage_folder TYPE varchar(200);
      ALTER TABLE projects ADD COLUMN normalized_name varchar(60);`);
    const rows = await runner.query('SELECT id,owner_id,name FROM projects ORDER BY deleted_at NULLS FIRST,created_at') as Array<{ id: string; owner_id: string; name: string }>;
    const used = new Set<string>();
    for (const row of rows) {
      const name = row.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'progetto';
      const key = row.owner_id + ':' + name;
      // Very old retired duplicates remain historical, without blocking migration.
      if (!used.has(key)) { await runner.query('UPDATE projects SET normalized_name=$2 WHERE id=$1', [row.id, name]); used.add(key); }
    }
    await runner.query('CREATE UNIQUE INDEX projects_owner_normalized_name ON projects(owner_id,normalized_name) WHERE normalized_name IS NOT NULL');
  }
  async down(runner: QueryRunner) {
    await runner.query(`DROP INDEX projects_owner_normalized_name;
      ALTER TABLE projects DROP COLUMN normalized_name;
      DROP INDEX users_storage_owner_id;
      ALTER TABLE users DROP COLUMN storage_owner_id;`);
    // Keep the larger path column: existing UUID paths must not be truncated.
  }
}
