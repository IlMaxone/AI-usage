import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectName = 'ai-usage-web';
const databaseVolume = `${projectName}_postgres-data`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: resolve('.'), stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.argv.includes('--backup')) {
  run(process.execPath, [resolve('scripts/db-backup.mjs')]);
}

const volumes = spawnSync('docker', [
  'volume', 'ls', '--format', '{{.Name}}',
  '--filter', `label=com.docker.compose.project=${projectName}`,
], { cwd: resolve('.'), encoding: 'utf8' });
if (volumes.status !== 0) process.exit(volumes.status || 1);

const available = volumes.stdout.split(/\r?\n/).filter(Boolean);
if (!available.includes(databaseVolume)) {
  process.stderr.write(`Volume atteso non trovato: ${databaseVolume}\n`);
  process.exit(1);
}

process.stdout.write(`Reset del solo volume database: ${databaseVolume}\n`);
run('docker', ['compose', 'down']);
run('docker', ['volume', 'rm', databaseVolume]);
run('docker', ['compose', 'up', '-d']);
process.stdout.write('Database ricreato e stack riavviato. La cartella storage/uploads non è stata modificata.\n');
