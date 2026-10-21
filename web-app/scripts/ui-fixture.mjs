// Read-only UI fixture. Serves the compiled Angular app against invented data,
// isolated from the real API, account and browser storage origin.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../frontend/dist/ai-usage/browser/', import.meta.url));
const user = { id: 'qa', email: 'qa@example.invalid', displayName: 'Demo QA' };
const project = { id: 'project-qa', name: 'Progetto dimostrativo', color: '#9BE15D', modelId: null, folder: 'projects/demo' };
const models = [
  { id: 'sol-qa', provider: 'OpenAI', name: 'GPT-5.6 Sol', reasoning: 'high', isDefault: true, version: 1, lockedAt: '2026-10-20T08:00:00Z', pricing: { currency: 'EUR', fiveHourWindowCost: 13.54, costPerMinute: 0.1 }, rules: [], latestCalibration: null },
  { id: 'astra-qa', provider: 'OpenAI', name: 'GPT-6 Astra', reasoning: 'high', isDefault: false, version: 1, lockedAt: null, pricing: { currency: 'EUR', fiveHourWindowCost: 13.54, costPerMinute: 0.2 }, rules: [], latestCalibration: null },
];
models.push(
  { ...models[0], id: 'sol-medium-qa', reasoning: 'medium', lockedAt: null, pricing: { ...models[0].pricing, costPerMinute: 0.1540 } },
  { ...models[0], id: 'sol-high-fast-qa', reasoning: 'high fast', lockedAt: null, pricing: { ...models[0].pricing, costPerMinute: 0.3636 } },
  { ...models[0], id: 'sol61-qa', name: 'GPT-6.1 Sol', lockedAt: null, pricing: { ...models[0].pricing, costPerMinute: 0.1212 } },
  ...['xhigh fast', 'light fast', 'medium fast', 'xhigh', 'light'].map((reasoning, index) => ({ ...models[0], id: 'sol-variant-qa-' + index, reasoning, lockedAt: null, pricing: { ...models[0].pricing, costPerMinute: 0.12 + index * .03 } })),
);
const solRates = {
  light: [0.1221, 110 + 52 / 60], 'light fast': [0.3053, 44 + 21 / 60],
  medium: [0.1540, 87 + 54 / 60], 'medium fast': [0.3851, 35 + 10 / 60],
  high: [0.1455, 93 + 3 / 60], 'high fast': [0.3636, 37 + 14 / 60],
  xhigh: [0.1998, 67 + 47 / 60], 'xhigh fast': [0.4994, 27 + 7 / 60],
};
models.forEach((model) => {
  Object.assign(model, { catalogAvailable: true, catalogKey: model.id, catalogSha256: 'invented', catalogSyncedAt: '2026-10-20T08:00:00Z' });
  const rate = model.name === 'GPT-5.6 Sol' ? solRates[model.reasoning] : null;
  if (rate) model.pricing = { ...model.pricing, costPerMinute: rate[0], maxTimeWindowMinutes: rate[1] };
});
const snapshot = { capturedAt: '2026-10-20T08:00:00Z', fiveHourUsedPct: 40, fiveHourRemainingPct: 60, fiveHourResetsAt: '2026-10-20T12:00:00Z', weeklyUsedPct: 30, weeklyRemainingPct: 70, weeklyResetsOn: '2026-10-25' };
const record = { id: 'record-qa', projectId: project.id, modelId: null, mode: 'CONSTANT', status: 'VALIDATED', note: null, createdAt: snapshot.capturedAt, project,
  single: { upload: { id: 'upload-qa', recordId: 'record-qa', role: 'SINGLE', originalName: 'Invented.png', status: 'VALIDATED', reviewReason: null, createdAt: snapshot.capturedAt, modelId: models[0].id, modelTaggedAt: snapshot.capturedAt }, rawSnapshot: snapshot, effectiveSnapshot: snapshot, correction: null }, start: null, end: null, usage: { status: 'MEASURED', usedPct: 40 } };
record.mode = 'SEGMENT';
record.start = { ...record.single, upload: { ...record.single.upload, id: 'start-qa', role: 'START', originalName: 'A1.png' } };
record.end = { ...record.single, upload: { ...record.single.upload, id: 'end-qa', role: 'END', originalName: 'B1.png' } };
record.single = null;
record.usage.status = 'SEGMENT_MEASURED';
const gallery = [record.start, record.end].map((reading) => ({ ...reading.upload, project, mime: 'image/svg+xml', size: 500, capturedAt: snapshot.capturedAt, recordDeleted: false }));
let writes = 0;
let retryRequests = 0;
let resetRequests = 0;
let notificationCount = Math.min(150, Math.max(0, Number(process.env.UI_FIXTURE_NOTIFICATION_COUNT ?? 1)));
const api = (url) => {
  if (url.pathname === '/qa/stats') return { writes, retryRequests, resetRequests };
  if (url.pathname === '/api/projects') return [project];
  if (url.pathname === '/api/notifications/ocr-failures/debug') {
    const images = notificationCount ? ['B2.png', 'A2.png'] : [];
    const entries = images.map((name, index) => ({ immagine: name, progetto: project.name, progetto_id: project.id,
      notifica_id: 'failure-qa-0', stato: index ? 'PAIR_BLOCKED' : 'MANUAL_REVIEW', coppia: '2', immagini_associate: ['A2.png', 'B2.png'],
      motivo: 'I passaggi OCR non concordano su data e ora visibili nello screenshot.', cartella: project.folder + '/unprocessed',
      file_disponibile: true, sha256: index ? null : 'a'.repeat(64), dettaglio_disponibile: true,
      tentativi: [{ id: 'invented-attempt-' + index, data: '2026-10-21T09:00:00Z', ruolo: index ? 'START' : 'END', stato: index ? 'PAIR_BLOCKED' : 'MANUAL_REVIEW', sha256: index ? null : 'a'.repeat(64),
        log: index ? [{ at: '2026-10-21T09:00:01Z', stage: 'pair', level: 'error', code: 'PAIR_BLOCKED', details: { cause: 'OTHER_IMAGE_FAILED' } }] : [
          { at: '2026-10-21T09:00:00Z', stage: 'image', level: 'info', code: 'IMAGE_DECODED', details: { width: 1920, height: 1080 } },
          ...['normalized', 'soft', 'threshold'].map((pass) => ({ at: '2026-10-21T09:00:01Z', stage: 'timestamp', level: 'warning', code: 'SCREENSHOT_TIMESTAMP_UNREADABLE', details: { pass: 'timestamp-' + pass } })),
          { at: '2026-10-21T09:00:02Z', stage: 'timestamp', level: 'error', code: 'TIMESTAMP_NO_AGREEMENT', details: { requiredMatchingPasses: 2, validPasses: [] } },
        ] }], log_storico: [] }));
    return { immagini_infette: entries.map(({ immagine, progetto, progetto_id, notifica_id, stato }) => ({ immagine, progetto, progetto_id, notifica_id, stato })), logs_errori: entries,
      metadata: { formato: 'ai-usage-error-logs', versione: 1, esportato_il: '2026-10-21T10:00:00Z', numero_immagini: entries.length, testo_ocr_completo_incluso: false } };
  }
  if (url.pathname === '/api/notifications/ocr-failures') return Array.from({ length: notificationCount }, (_, index) => ({ id: 'failure-qa-' + index, originalName: `B${index + 2}.png`, files: [`A${index + 2}.png`, `B${index + 2}.png`], pairNumber: String(index + 2), reason: 'I passaggi OCR non concordano su data e ora visibili nello screenshot.', createdAt: '2026-10-20T09:00:00Z', project: { id: project.id, name: project.name, folder: project.folder + '/unprocessed' }, fileAvailable: true }));
  if (url.pathname === '/api/projects/project-qa/inbox') return { folder: project.folder, files: [] };
  if (url.pathname === '/api/models') return models;
  if (url.pathname === '/api/models/window-pricing') return { currency: 'EUR', fiveHourWindowCost: 13.54 };
  if (url.pathname === '/api/records') return [record];
  if (url.pathname === '/api/dashboard') return { metrics: { records: 1, measuredRecords: 1, segments: 1, usedPctSum: 40, equivalentWindows: 0.4, windowCount: 1, extraCreditsSpent: 0, extraPaidEur: 0 }, projects: [{ ...project, recordCount: 1, usedPctSum: 40, usageSharePct: 100 }], recentRecords: [{ ...record, capturedAt: snapshot.capturedAt, observedUsage: snapshot }] };
  if (url.pathname === '/api/records/uploads/gallery') return gallery;
  if (url.pathname === '/api/cost-analysis') {
    const exploratory = url.searchParams.get('explore') === 'true';
    const target = exploratory ? models.find((model) => model.id === url.searchParams.get('modelId')) : null;
    const equivalentMinutes = 5.416 / models[0].pricing.costPerMinute;
    const cost = target ? equivalentMinutes * target.pricing.costPerMinute : 5.416;
    return { exploratory, reference: { currency: 'EUR', fiveHourWindowCost: 13.54 }, model: target,
      summary: { records: 1, windows: 1, unpricedRecords: 0, attributedUsedPct: 40, actualEstimatedCost: 5.416, estimatedCost: cost, costDifference: cost - 5.416, estimatedUsageMinutes: equivalentMinutes, windowCostAt100: 13.54, usageMinutesAt100: null },
      items: [{ recordId: record.id, project, mode: record.mode, capturedAt: snapshot.capturedAt, fiveHourResetsAt: snapshot.fiveHourResetsAt, usedPct: 40, attributedUsedPct: 40, elapsedMinutes: null, windowCostAt100: 13.54, usageMinutesAt100: 13.54 / models[0].pricing.costPerMinute, estimatedCost: cost, actualEstimatedCost: 5.416, costDifference: cost - 5.416, estimatedUsageMinutes: equivalentMinutes, sourceModel: models[0], model: target ?? models[0], tagStatus: 'TAGGED' }] };
  }
  return undefined;
};
const server = http.createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/notifications/ocr-failures/reset') {
    request.resume(); resetRequests++;
    const notifications = notificationCount; notificationCount = 0;
    response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ notifications, images: notifications ? 2 : 0, records: 0, preservedReadings: 1 })); return;
  }
  if (request.method === 'POST' && request.url === '/api/notifications/ocr-failures/retry') {
    request.resume(); retryRequests++;
    response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ queued: 1, skipped: 0, busy: false, issues: [] })); return;
  }
  if (request.method !== 'GET') { writes++; response.writeHead(405).end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1:4411');
  if (/^\/api\/records\/uploads\/(start|end)-qa\/content$/.test(url.pathname)) {
    response.setHeader('Content-Type', 'image/svg+xml');
    const start = url.pathname.includes('start-qa');
    response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="${start ? '#dce7ca' : '#f3d5a3'}"/><text x="70" y="150" font-size="50" font-family="sans-serif">${start ? 'A1 · INIZIO' : 'B1 · FINE'}</text><text x="70" y="240" font-size="28" font-family="sans-serif">Screenshot dimostrativo inventato</text></svg>`); return;
  }
  const value = api(url);
  if (value !== undefined) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); return; }
  const file = path.resolve(root, url.pathname === '/' ? 'index.html' : '.' + url.pathname);
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    let data = await fs.readFile(file);
    if (file.endsWith('.html')) {
      response.setHeader('Content-Type', 'text/html');
      const seed = `<script>sessionStorage.setItem('ai-usage-user',${JSON.stringify(JSON.stringify(user))});sessionStorage.setItem('ai-usage-token','invented-ui-fixture-token');</script>`;
      data = data.toString().replace('<head>', '<head>' + seed);
    } else if (file.endsWith('.js')) {
      response.setHeader('Content-Type', 'application/javascript');
      data = data.toString().replaceAll('http://localhost:3000/api', 'http://127.0.0.1:4411/api');
    } else if (file.endsWith('.css')) response.setHeader('Content-Type', 'text/css');
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
server.listen(4411, '127.0.0.1', () => console.log('Read-only UI fixture: http://127.0.0.1:4411'));
