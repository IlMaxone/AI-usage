import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const projectsRoot = path.resolve(appRoot, '../projects');
const config = parseEnv(await fs.readFile(path.join(appRoot, '.env'), 'utf8'));
const apiUrl = `http://127.0.0.1:${config.API_PORT || '3000'}/api`;
const origins = new Set((config.CORS_ORIGIN || 'http://localhost:4400').split(','));
let busy = false;

async function selectImages(directory) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-File', path.join(appRoot, 'scripts/select-images.ps1')], {
      windowsHide: true, env: { ...process.env, AI_USAGE_PICKER_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) { reject(new Error('WINDOWS_PICKER_FAILED')); return; }
      try { resolve(JSON.parse(output.replace(/^\uFEFF/, '').trim())); } catch { reject(new Error('WINDOWS_PICKER_INVALID_RESPONSE')); }
    });
  });
}

export async function copySelection(selected, inbox) {
  // Validate the entire selection before copying any file. Temp names are not
  // recognized by the worker, so it never sees a partly copied screenshot.
  const files = [];
  const seen = new Set();
  for (const file of selected) {
    const name = path.basename(file);
    if (!/^[AB]\d+\.(png|jpe?g|webp)$/i.test(name)) throw new Error('Usa nomi A1, B1, A2, B2 con estensione immagine.');
    if (seen.has(name.toLowerCase())) throw new Error('La selezione contiene nomi duplicati.');
    seen.add(name.toLowerCase());
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > Number(config.MAX_UPLOAD_BYTES || 10485760)) {
      throw new Error('File non valido o oltre il limite configurato.');
    }
    files.push({ file, name });
  }
  for (const { file, name } of files) {
    const destination = path.join(inbox, name);
    if (path.resolve(file).toLowerCase() !== path.resolve(destination).toLowerCase()) {
      const temporary = path.join(inbox, `.copy-${randomUUID()}`);
      try { await fs.copyFile(file, temporary); await fs.rename(temporary, destination); }
      finally { await fs.unlink(temporary).catch(() => undefined); }
    }
    const now = new Date(); await fs.utimes(destination, now, now);
  }
  return files.length;
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (origin && !origins.has(origin)) { response.writeHead(403).end('{}'); return; }
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  if (request.method === 'GET' && request.url === '/health') { response.end('{"service":"ai-usage-desktop-picker"}'); return; }
  const route = /^\/projects\/([0-9a-f-]{36})\/select-images$/i.exec(request.url || '');
  if (request.method !== 'POST' || !route) { response.writeHead(404).end('{}'); return; }
  if (!request.headers.authorization?.startsWith('Bearer ')) { response.writeHead(401).end('{}'); return; }
  if (busy) { response.writeHead(409).end('{"message":"Una finestra di selezione è già aperta."}'); return; }
  busy = true;
  try {
    const result = await fetch(`${apiUrl}/projects`, {
      headers: { Authorization: request.headers.authorization }, signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) { response.writeHead(result.status).end('{}'); return; }
    const projects = await result.json();
    const project = projects.find((item) => item.id === route[1]);
    if (!project) { response.writeHead(404).end('{}'); return; }
    const folder = project.folder?.replace(/^projects\//, '');
    if (!folder || !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(folder)) throw new Error('Cartella progetto non valida.');
    const inbox = path.join(projectsRoot, folder, 'to-process');
    await fs.mkdir(inbox, { recursive: true });
    const realRoot = await fs.realpath(projectsRoot);
    const realInbox = await fs.realpath(inbox);
    if (!realInbox.startsWith(realRoot + path.sep)) throw new Error('Cartella progetto non valida.');
    const selected = await selectImages(inbox);
    const copied = await copySelection(selected, inbox);
    response.end(JSON.stringify({ copied, cancelled: selected.length === 0 }));
  } catch (error) {
    response.writeHead(400).end(JSON.stringify({ message: error instanceof Error ? error.message : 'Selezione immagini non riuscita.' }));
  } finally { busy = false; }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32') throw new Error('La finestra nativa richiede Windows.');
  server.listen(4410, '127.0.0.1', () => console.log('Selettore Windows disponibile su 127.0.0.1:4410'));
}
