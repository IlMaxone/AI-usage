// Read-only, offline OCR regression. Only structured usage/model diagnostics;
// no raw OCR text, database writes, archival or movement of input screenshots.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire('/app/package.json');
const { createWorker } = req('tesseract.js');
const { recognizeScreenshot } = require('/app/dist/worker');
const { recognizeModelSelector } = require('/app/dist/ocr-model');
const { parseModelCatalog } = require('/app/dist/model-catalog');
(async () => {
  if (!process.argv[2]) throw new Error('Specify an image directory');
  const directory = path.resolve(process.argv[2]);
  const catalog = parseModelCatalog(await fs.readFile(process.env.MODEL_CATALOG_PATH, 'utf8'))
    .filter((model) => model.available).map((model) => ({ ...model, id: model.key }));
  const worker = await createWorker('eng', 1, { cachePath: '/opt/ocr-cache', langPath: '/opt/ocr-cache', gzip: false });
  const results = [];
  try {
    const only = process.argv[3]?.split(',');
    for (const name of (await fs.readdir(directory)).filter((name) => /\.(png|jpe?g|webp)$/i.test(name) && (!only || only.includes(name))).sort()) {
      const file = path.join(directory, name), trace = [];
      const before = createHash('sha256').update(await fs.readFile(file)).digest('hex');
      const usage = await recognizeScreenshot(worker, file, trace);
      const model = await recognizeModelSelector(worker, file, catalog, trace);
      const after = createHash('sha256').update(await fs.readFile(file)).digest('hex');
      if (before !== after) throw new Error('IMAGE_CHANGED_DURING_VERIFICATION');
      results.push({ file: name, sha256: before, accepted: usage.accepted && model.status === 'MATCHED', usage, model, trace });
      process.stderr.write(`${name}: usage=${usage.accepted} model=${model.status}\n`);
    }
  } finally { await worker.terminate(); }
  console.log(JSON.stringify({ total: results.length, accepted: results.filter((item) => item.accepted).length, readOnly: true, fullOcrTextStored: false, results }, null, 2));
})().catch((error) => { console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'OCR_VERIFICATION_FAILED'); process.exitCode = 1; });
