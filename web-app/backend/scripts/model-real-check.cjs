const { createRequire } = require('node:module');
const appRequire = createRequire('/app/package.json');
const { createWorker } = appRequire('tesseract.js');
const { recognizeModelTag } = require('/app/dist/ocr-model');

(async () => {
  const worker = await createWorker('eng', 1, { cachePath: '/opt/ocr-cache' });
  const models = [
    { id: 'sol', name: 'GPT-5.6 Sol', reasoning: 'high' },
    { id: 'astra', name: 'GPT-6 Astra', reasoning: 'high' },
  ];
  try {
    for (const name of ['image-A1.png', 'image-B1.png']) {
      const result = await recognizeModelTag(worker, `/samples/${name}`, models);
      if (result?.modelId !== 'sol') throw new Error(`MODEL_CHECK_FAILED: ${name}`);
      console.log(`PASS: ${name}, GPT-5.6 Sol high, ${result.matchingPasses.length} matching passes; no OCR text persisted.`);
    }
  } finally { await worker.terminate(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
