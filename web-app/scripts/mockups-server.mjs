import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve('mockups');
const port = Number(process.env.MOCKUPS_PORT || 4450);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8' };

createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = resolve(root, requested);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) throw new Error('invalid path');
    if (!statSync(filePath).isFile()) throw new Error('not a file');
    response.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Mockup non trovato');
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Mockup disponibili su http://localhost:${port}\n`);
});
