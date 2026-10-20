import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReadableProjectFolders1726500000012 implements MigrationInterface {
  name = 'ReadableProjectFolders1726500000012';
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE projects ADD COLUMN storage_folder varchar(100);
      CREATE UNIQUE INDEX projects_storage_folder ON projects(lower(storage_folder)) WHERE storage_folder IS NOT NULL;`);
  }
  async down(runner: QueryRunner) { await runner.query('DROP INDEX projects_storage_folder; ALTER TABLE projects DROP COLUMN storage_folder'); }
}
