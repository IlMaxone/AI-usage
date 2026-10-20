import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', (code) => resolve(code));
  });
}
if (process.platform !== 'win32') throw new Error('Questo avvio richiede Windows.');
if (await run(['info', '--format', '{{.ServerVersion}}']) !== 0) {
  if (await run(['desktop', 'start']) !== 0) throw new Error('Avvio Docker Desktop non riuscito.');
}
if (await run(['compose', 'up', '--build', '-d', '--wait', '--wait-timeout', '180', '--force-recreate', 'api', 'worker', 'frontend']) !== 0) throw new Error('Avvio Compose non riuscito.');
let pickerReady = false;
try { pickerReady = (await (await fetch('http://127.0.0.1:4410/health')).json()).service === 'ai-usage-desktop-picker'; } catch {}
if (!pickerReady) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./desktop-picker.mjs', import.meta.url))], {
    cwd: root, detached: true, windowsHide: true, stdio: 'ignore',
  });
  child.unref();
  for (let attempt = 0; attempt < 20 && !pickerReady; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try { pickerReady = (await (await fetch('http://127.0.0.1:4410/health')).json()).service === 'ai-usage-desktop-picker'; } catch {}
  }
}
if (!pickerReady) throw new Error('Selettore Windows non disponibile. Esegui npm run desktop:picker per la diagnosi.');
console.log('Applicazione e selettore Windows avviati.');
