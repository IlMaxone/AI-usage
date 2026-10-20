// Read-only regression check against local screenshots. Never persists or prints
// OCR text: reports contain only catalog identities, pass counts and file hashes.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const appRequire = createRequire('/app/package.json');
const sharp = appRequire('sharp');
const { createWorker, PSM } = appRequire('tesseract.js');
const { parseModelLabel, recognizeModelSelector } = require(process.env.OCR_MODEL_MODULE ?? '/app/dist/ocr-model');
const { parseModelCatalog } = require(process.env.MODEL_CATALOG_MODULE ?? '/app/dist/model-catalog');

(async () => {
  const directory = path.resolve(process.argv[2] ?? '');
  if (!process.argv[2]) throw new Error('Specify the screenshot directory');
  const csv = await fs.readFile(process.env.MODEL_CATALOG_PATH, 'utf8');
  const models = parseModelCatalog(csv).filter((model) => model.available).map((model) => ({ ...model, id: model.key }));
  const worker = await createWorker('eng', 1, { cachePath: '/opt/ocr-cache', langPath: '/opt/ocr-cache', gzip: false });
  const results = [];
  let passes = [];
  const originalRecognize = worker.recognize.bind(worker);
  worker.recognize = async (...args) => {
    const result = await originalRecognize(...args);
    const text = result.data.text;
    const visible = [...text.matchAll(/\b(?:gpt[\s.:-]*)?(\d+(?:[. ]\d+)?)[\s.:-]+(sol|astra)[\s.:-]+(alto|high|basso|low|medio|medium|light|xhigh|ultra|max)\b/gi)]
      .map((match) => ({ version: match[1].trim(), family: match[2].toLowerCase(), reasoning: match[3].toLowerCase(), gptPrefix: /^gpt/i.test(match[0]) }));
    passes.push({ pass: passes.length + 1, modelId: parseModelLabel(text, models), selector: visible, confidence: result.data.confidence });
    return result;
  };
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const only = process.argv[3]?.split(',');
    const names = (await fs.readdir(directory)).filter((name) => /\.(png|jpe?g|webp)$/i.test(name) && (!only || only.includes(name))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const file of names) {
      const buffer = await fs.readFile(path.join(directory, file));
      const metadata = await sharp(buffer).metadata();
      passes = [];
      const selector = await recognizeModelSelector(worker, path.join(directory, file), models);
      const modelId = selector.status === 'MATCHED' ? selector.modelId : null;
      results.push({ file, sha256: createHash('sha256').update(buffer).digest('hex'), width: metadata.width, height: metadata.height, modelId, selector, passes });
      process.stderr.write(`${file}: ${modelId ?? selector.status}\n`);
    }
  } finally { await worker.terminate(); }
  console.log(JSON.stringify({ total: results.length, accepted: results.filter((item) => item.modelId).length, results }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
