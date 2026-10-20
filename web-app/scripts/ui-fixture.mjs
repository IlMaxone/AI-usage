// Read-only UI fixture. Serves the compiled Angular app against invented data,
// isolated from the real API, account and browser storage origin.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../frontend/dist/ai-usage/browser/', import.meta.url));
const user = { id: 'qa', email: 'qa@example.invalid', displayName: 'Demo QA' };
const project = { id: 'project-qa', name: 'Progetto dimostrativo', color: '#9BE15D', modelId: null };
const models = [
  { id: 'sol-qa', provider: 'OpenAI', name: 'GPT-5.6 Sol', reasoning: 'high', isDefault: true, version: 1, lockedAt: '2026-10-20T08:00:00Z', pricing: { currency: 'EUR', fiveHourWindowCost: 13.54, costPerMinute: 0.1 }, rules: [], latestCalibration: null },
  { id: 'astra-qa', provider: 'OpenAI', name: 'GPT-6 Astra', reasoning: 'high', isDefault: false, version: 1, lockedAt: null, pricing: { currency: 'EUR', fiveHourWindowCost: 13.54, costPerMinute: 0.2 }, rules: [], latestCalibration: null },
];
models.forEach((model, index) => Object.assign(model, { catalogAvailable: true, catalogKey: index ? 'gpt-6-astra-high' : 'gpt-5-6-sol-high', catalogSha256: 'invented', catalogSyncedAt: '2026-10-20T08:00:00Z' }));
const snapshot = { capturedAt: '2026-10-20T08:00:00Z', fiveHourUsedPct: 40, fiveHourRemainingPct: 60, fiveHourResetsAt: '2026-10-20T12:00:00Z', weeklyUsedPct: 30, weeklyRemainingPct: 70, weeklyResetsOn: '2026-10-25' };
const record = { id: 'record-qa', projectId: project.id, modelId: null, mode: 'CONSTANT', status: 'VALIDATED', note: null, createdAt: snapshot.capturedAt, project,
  single: { upload: { id: 'upload-qa', recordId: 'record-qa', role: 'SINGLE', originalName: 'Invented.png', status: 'VALIDATED', reviewReason: null, createdAt: snapshot.capturedAt, modelId: models[0].id, modelTaggedAt: snapshot.capturedAt }, rawSnapshot: snapshot, effectiveSnapshot: snapshot, correction: null }, start: null, end: null, usage: { status: 'MEASURED', usedPct: 40 } };
let writes = 0;
const api = (url) => {
  if (url.pathname === '/qa/stats') return { writes };
  if (url.pathname === '/api/projects') return [project];
  if (url.pathname === '/api/models') return models;
  if (url.pathname === '/api/models/window-pricing') return { currency: 'EUR', fiveHourWindowCost: 13.54 };
  if (url.pathname === '/api/records') return [record];
  if (url.pathname === '/api/dashboard') return { metrics: { records: 1, measuredRecords: 1, segments: 0, usedPctSum: 40, extraCreditsSpent: 0, extraPaidEur: 0 }, projects: [{ ...project, recordCount: 1, usedPctSum: 40 }], recentRecords: [{ ...record, capturedAt: snapshot.capturedAt, observedUsage: snapshot }] };
  if (url.pathname === '/api/cost-analysis') {
    const exploratory = url.searchParams.get('explore') === 'true';
    const target = exploratory ? models.find((model) => model.id === url.searchParams.get('modelId')) : null;
    const cost = target ? 54.16 * target.pricing.costPerMinute : 5.416;
    return { exploratory, reference: { currency: 'EUR', fiveHourWindowCost: 13.54 }, model: target,
      summary: { records: 1, windows: 1, unpricedRecords: 0, attributedUsedPct: 40, actualEstimatedCost: 5.416, estimatedCost: cost, costDifference: cost - 5.416, estimatedUsageMinutes: 54.16, windowCostAt100: 13.54, usageMinutesAt100: null },
      items: [{ recordId: record.id, project, mode: record.mode, capturedAt: snapshot.capturedAt, fiveHourResetsAt: snapshot.fiveHourResetsAt, usedPct: 40, attributedUsedPct: 40, elapsedMinutes: null, windowCostAt100: 13.54, usageMinutesAt100: 135.4, estimatedCost: cost, actualEstimatedCost: 5.416, costDifference: cost - 5.416, estimatedUsageMinutes: 54.16, sourceModel: models[0], model: target ?? models[0], tagStatus: 'TAGGED' }] };
  }
  return undefined;
};
const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET') { writes++; response.writeHead(405).end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1:4411');
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
