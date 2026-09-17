import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function envFile() {
  try {
    return Object.fromEntries(readFileSync(resolve('.env'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }));
  } catch {
    return {};
  }
}

const localEnv = envFile();
const database = localEnv.POSTGRES_DB || process.env.POSTGRES_DB || 'ai_usage';
const user = localEnv.POSTGRES_USER || process.env.POSTGRES_USER || 'ai_usage';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = resolve('backups');
const backupPath = resolve(backupDir, `ai-usage-${timestamp}.sql`);
mkdirSync(backupDir, { recursive: true });

const result = spawnSync('docker', [
  'compose', 'exec', '-T', 'db', 'pg_dump',
  '--clean', '--if-exists', '--no-owner', '--no-privileges',
  '-U', user, '-d', database,
], { cwd: resolve('.'), encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });

if (result.status !== 0) {
  process.stderr.write(result.stderr?.toString() || 'Backup database non riuscito.\n');
  process.exit(result.status || 1);
}
writeFileSync(backupPath, result.stdout);
process.stdout.write(`Backup creato: ${backupPath}\n`);
