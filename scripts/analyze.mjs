import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import {
  estimateUsage,
  aggregateTotals,
  renderDashboard,
  renderEstimatesCsv,
  renderExchangeRatesCsv,
  renderInternetCsv,
  renderTotalsCsv,
  renderUsageCsv,
  selectExchangeRate,
} from './report-renderers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
let projectName = null;
let dryRun = false;
let offline = false;
let verifyProcessed = false;

for (let index = 0; index < rawArgs.length; index += 1) {
  const argument = rawArgs[index];
  if (argument === '--dry-run') dryRun = true;
  else if (argument === '--offline') offline = true;
  else if (argument === '--verify-processed') verifyProcessed = true;
  else if (argument === '--project') {
    projectName = rawArgs[index + 1];
    index += 1;
  } else if (argument.startsWith('--project=')) {
    projectName = argument.slice('--project='.length);
  } else {
    throw new Error('Argomento non riconosciuto: ' + argument);
  }
}

if (!projectName || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(projectName)) {
  throw new Error('Specificare un progetto valido con --project <nome>.');
}

const projectsDir = path.join(root, 'projects');
const projectDir = path.resolve(projectsDir, projectName);
if (!projectDir.startsWith(projectsDir + path.sep)) {
  throw new Error('Percorso progetto non consentito.');
}
const toProcessDir = path.join(projectDir, 'to-process-img');
const processedDir = path.join(projectDir, 'processed-images');
const historicalDir = path.join(projectDir, 'historical-data');
const internetDir = path.join(projectDir, 'internet-data');
const rawInternetDir = path.join(internetDir, 'raw');
const reportsDir = path.join(projectDir, 'reports');
const csvReportsDir = path.join(reportsDir, 'csv');
const ocrCacheDir = path.join(root, 'ocr-cache');
const usageDataFile = path.join(historicalDir, 'usage-snapshots.jsonl');
const pricingDataFile = path.join(internetDir, 'pricing-snapshots.jsonl');
const exchangeRateDataFile = path.join(internetDir, 'exchange-rate-snapshots.jsonl');
const timeZone = 'Europe/Rome';
const model = 'gpt-5.6-sol';
const reasoning = 'high';
const plan = 'ChatGPT Plus';

const sources = {
  model: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol.md',
  plan: 'https://learn.chatgpt.com/docs/pricing.md',
  exchangeRate: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
};

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function timestampForFile(iso) {
  return iso.replaceAll(':', '-').replaceAll('.', '-');
}

function formatDecimal(value, digits = 2) {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatInteger(value) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(value);
}

async function ensureDirectories() {
  await Promise.all([
    toProcessDir,
    processedDir,
    historicalDir,
    internetDir,
    rawInternetDir,
    reportsDir,
    csvReportsDir,
    ocrCacheDir,
  ].map((directory) => fs.mkdir(directory, { recursive: true })));
}

async function readJsonLines(file) {
  try {
    const content = await fs.readFile(file, 'utf8');
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error('JSON non valido in ' + file + ', riga ' + (index + 1) + ': ' + error.message);
        }
      });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendJsonLine(file, value) {
  await fs.appendFile(file, JSON.stringify(value) + '\n', 'utf8');
}

async function atomicWrite(file, content) {
  const temporary = file + '.tmp-' + process.pid;
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, file);
}

async function downloadSource(url, accept = 'text/markdown,text/plain;q=0.9,*/*;q=0.1') {
  const fetchedAt = new Date().toISOString();
  const response = await fetch(url, {
    headers: {
      accept,
      'user-agent': 'AI-usage-local-analytics/1.0',
    },
  });

  if (!response.ok) {
    throw new Error('Download fallito (' + response.status + ') da ' + url);
  }

  const text = await response.text();
  return {
    fetchedAt,
    url,
    text,
    sha256: sha256(Buffer.from(text, 'utf8')),
  };
}

function parseExchangeRateSnapshot(xml) {
  const rateDate = requireMatch(
    xml,
    /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/i,
    'data del cambio BCE',
  )[1];
  const usdPerEur = Number(requireMatch(
    xml,
    /<Cube\s+currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/i,
    'cambio USD per EUR',
  )[1]);

  if (!Number.isFinite(usdPerEur) || usdPerEur <= 0) {
    throw new Error('Dato Internet non valido: cambio USD per EUR');
  }

  return {
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    rateDate,
    usdPerEur,
    eurPerUsd: 1 / usdPerEur,
    note: 'Tasso di riferimento BCE pubblicato a scopo informativo, non tasso garantito di transazione.',
  };
}

function requireMatch(text, regex, description) {
  const match = text.match(regex);
  if (!match) throw new Error('Dato Internet non riconosciuto: ' + description);
  return match;
}

function parseInternetSnapshot(modelPage, planPage) {
  const input = Number(requireMatch(
    modelPage,
    /\|\s*Input\s*\|\s*\$([0-9.]+)\s*\|\s*1M tokens\s*\|/i,
    'prezzo input',
  )[1]);
  const cachedInput = Number(requireMatch(
    modelPage,
    /\|\s*Cached input\s*\|\s*\$([0-9.]+)\s*\|\s*1M tokens\s*\|/i,
    'prezzo cached input',
  )[1]);
  const output = Number(requireMatch(
    modelPage,
    /\|\s*Output\s*\|\s*\$([0-9.]+)\s*\|\s*1M tokens\s*\|/i,
    'prezzo output',
  )[1]);

  const plainPlan = planPage.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const messages = requireMatch(
    plainPlan,
    /GPT-5\.6 Sol\s+(\d+)\s*-\s*(\d+)/i,
    'messaggi Plus per 5 ore',
  );
  const credits = requireMatch(
    plainPlan,
    /GPT-5\.6 Sol\s+(\d+(?:\.\d+)?) credits\s+(\d+(?:\.\d+)?) credits\s+(\d+(?:\.\d+)?) credits/i,
    'crediti per milione di token',
  );
  const average = requireMatch(
    plainPlan,
    /GPT-5\.6 usage averages\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?) credits per message/i,
    'crediti medi per messaggio',
  );

  return {
    apiPricesUsdPerMillionTokens: { input, cachedInput, output },
    chatGptPlus: {
      fiveHourLocalMessages: {
        min: Number(messages[1]),
        max: Number(messages[2]),
      },
      averageCreditsPerMessage: {
        min: Number(average[1]),
        max: Number(average[2]),
      },
      weeklyCapacity: null,
      weeklyCapacityNote: 'La fonte indica limiti settimanali possibili ma non pubblica una capacita numerica.',
    },
    creditsPerMillionTokens: {
      input: Number(credits[1]),
      cachedInput: Number(credits[2]),
      output: Number(credits[3]),
    },
  };
}

async function acquireInternetSnapshot() {
  if (offline) {
    const [pricingSnapshots, exchangeRateSnapshots] = await Promise.all([
      readJsonLines(pricingDataFile),
      readJsonLines(exchangeRateDataFile),
    ]);
    if (pricingSnapshots.length === 0) {
      throw new Error('Modalita offline: nessuno snapshot prezzi disponibile.');
    }
    if (exchangeRateSnapshots.length === 0) {
      throw new Error('Modalita offline: nessuno snapshot del cambio disponibile.');
    }
    return {
      pricingSnapshot: pricingSnapshots.at(-1),
      exchangeRateSnapshot: exchangeRateSnapshots.at(-1),
      rawFiles: [],
    };
  }

  console.log('Scarico prezzi, limiti e cambio BCE dalle fonti ufficiali...');
  const [modelDownload, planDownload, exchangeDownload] = await Promise.all([
    downloadSource(sources.model),
    downloadSource(sources.plan),
    downloadSource(sources.exchangeRate, 'application/xml,text/xml;q=0.9,*/*;q=0.1'),
  ]);
  const fetchedAt = new Date().toISOString();
  const parsed = parseInternetSnapshot(modelDownload.text, planDownload.text);
  const parsedExchangeRate = parseExchangeRateSnapshot(exchangeDownload.text);
  const snapshotId = 'pricing-' + fetchedAt;
  const exchangeRateSnapshotId = 'exchange-rate-' + fetchedAt;
  const modelRawName = timestampForFile(modelDownload.fetchedAt) + '-model.md';
  const planRawName = timestampForFile(planDownload.fetchedAt) + '-plan.md';
  const exchangeRawName = timestampForFile(exchangeDownload.fetchedAt) + '-ecb-eurofxref.xml';

  const pricingSnapshot = {
    schemaVersion: 1,
    id: snapshotId,
    fetchedAt,
    model,
    reasoning,
    ...parsed,
    sources: [
      {
        kind: 'api-model-pricing',
        url: modelDownload.url,
        fetchedAt: modelDownload.fetchedAt,
        sha256: modelDownload.sha256,
        rawFile: 'raw/' + modelRawName,
      },
      {
        kind: 'chatgpt-plan-limits',
        url: planDownload.url,
        fetchedAt: planDownload.fetchedAt,
        sha256: planDownload.sha256,
        rawFile: 'raw/' + planRawName,
      },
    ],
  };
  const exchangeRateSnapshot = {
    schemaVersion: 1,
    id: exchangeRateSnapshotId,
    fetchedAt: exchangeDownload.fetchedAt,
    ...parsedExchangeRate,
    source: {
      kind: 'ecb-euro-reference-rate',
      url: exchangeDownload.url,
      fetchedAt: exchangeDownload.fetchedAt,
      sha256: exchangeDownload.sha256,
      rawFile: 'raw/' + exchangeRawName,
    },
  };

  return {
    pricingSnapshot,
    exchangeRateSnapshot,
    rawFiles: [
      { name: modelRawName, content: modelDownload.text },
      { name: planRawName, content: planDownload.text },
      { name: exchangeRawName, content: exchangeDownload.text },
    ],
  };
}

async function persistInternetSnapshot(acquisition) {
  if (dryRun || offline) return;

  await Promise.all(acquisition.rawFiles.map((file) =>
    fs.writeFile(path.join(rawInternetDir, file.name), file.content, 'utf8')));
  await Promise.all([
    appendJsonLine(pricingDataFile, acquisition.pricingSnapshot),
    appendJsonLine(exchangeRateDataFile, acquisition.exchangeRateSnapshot),
  ]);
}

function normalizeOcr(text) {
  return text
    .replace(/[|]/g, 'I')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ');
}

const months = new Map([
  ['gen', 1], ['feb', 2], ['mar', 3], ['apr', 4],
  ['mag', 5], ['giu', 6], ['lug', 7], ['ago', 8],
  ['set', 9], ['sep', 9], ['ott', 10], ['nov', 11], ['dic', 12],
]);

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateOnly(year, month, day) {
  return String(year) + '-' + pad(month) + '-' + pad(day);
}

function localDateTime(year, month, day, time) {
  return dateOnly(year, month, day) + 'T' + time;
}

function localCalendarDateTime(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

function parseCaptureTimestamp(text, fileStat) {
  const normalized = normalizeOcr(text);
  const timeMatch = normalized.match(/(\d{1,2})[:.;](\d{2})[:.;](\d{2})/);
  const fallback = localCalendarDateTime(fileStat.mtime);
  const hour = timeMatch ? Number(timeMatch[1]) : fallback.hour;
  const minute = timeMatch ? Number(timeMatch[2]) : fallback.minute;
  const second = timeMatch ? Number(timeMatch[3]) : fallback.second;
  const dateMatch = normalized.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  const day = dateMatch ? Number(dateMatch[1]) : fallback.day;
  const month = dateMatch ? Number(dateMatch[2]) : fallback.month;
  const year = dateMatch ? Number(dateMatch[3]) : fallback.year;

  if (hour > 23 || minute > 59 || second > 59 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('data o ora della schermata fuori intervallo');
  }

  const time = pad(hour) + ':' + pad(minute) + ':' + pad(second);
  return {
    year,
    month,
    day,
    time,
    local: localDateTime(year, month, day, time),
    dateSource: dateMatch ? 'ocr' : 'file-mtime',
    timeSource: timeMatch ? 'ocr' : 'file-mtime',
    fileModifiedAt: fileStat.mtime.toISOString(),
  };
}

function parseClockToken(token) {
  const explicit = token.match(/(\d{1,2})[:.;](\d{2})/);
  if (explicit) return { hour: Number(explicit[1]), minute: Number(explicit[2]) };

  const digits = token.replace(/\D/g, '');
  if (digits.length === 4) return { hour: Number(digits.slice(0, 2)), minute: Number(digits.slice(2)) };
  if (digits.length === 5 && digits[2] === '1') {
    return { hour: Number(digits.slice(0, 2)), minute: Number(digits.slice(3)) };
  }
  throw new Error('orario reset delle 5 ore non riconosciuto');
}

function parseUsage(text, capture) {
  const normalized = normalizeOcr(text);
  const fiveHour = normalized.match(
    /5\s*h[\s\S]{0,80}?(\d{1,3})\s*%[\s\S]{0,40}?([0-9:.;]{4,5})/i,
  );
  const weekly = normalized.match(
    /Settimanale[\s\S]{0,100}?(\d{1,3})\s*%[\s\S]{0,50}?(\d{1,2})\s*(gen|feb|mar|apr|mag|giu|lug|ago|set|sep|ott|nov|dic)/i,
  );

  if (!fiveHour) throw new Error('percentuale o reset delle 5 ore non riconosciuti');
  if (!weekly) throw new Error('percentuale o reset settimanale non riconosciuti');

  const fiveHourRemainingPct = Number(fiveHour[1]);
  const weeklyRemainingPct = Number(weekly[1]);
  const { hour: resetHour, minute: resetMinute } = parseClockToken(fiveHour[2]);

  for (const [name, value] of [
    ['5 ore', fiveHourRemainingPct],
    ['settimanale', weeklyRemainingPct],
  ]) {
    if (value < 0 || value > 100) throw new Error('percentuale ' + name + ' fuori intervallo');
  }
  if (resetHour > 23 || resetMinute > 59) throw new Error('orario reset 5 ore fuori intervallo');

  const captureMinutes = Number(capture.time.slice(0, 2)) * 60 + Number(capture.time.slice(3, 5));
  const resetMinutes = resetHour * 60 + resetMinute;
  const resetDate = new Date(Date.UTC(capture.year, capture.month - 1, capture.day));
  if (resetMinutes <= captureMinutes) resetDate.setUTCDate(resetDate.getUTCDate() + 1);

  const weeklyMonth = months.get(weekly[3].toLowerCase());
  const weeklyDay = Number(weekly[2]);
  let weeklyYear = capture.year;
  let weeklyResetDate = new Date(Date.UTC(weeklyYear, weeklyMonth - 1, weeklyDay));
  const captureDate = new Date(Date.UTC(capture.year, capture.month - 1, capture.day));
  if (weeklyResetDate < captureDate) {
    weeklyYear += 1;
    weeklyResetDate = new Date(Date.UTC(weeklyYear, weeklyMonth - 1, weeklyDay));
  }

  return {
    fiveHour: {
      remainingPct: fiveHourRemainingPct,
      usedPct: 100 - fiveHourRemainingPct,
      resetsAtLocal: localDateTime(
        resetDate.getUTCFullYear(),
        resetDate.getUTCMonth() + 1,
        resetDate.getUTCDate(),
        pad(resetHour) + ':' + pad(resetMinute) + ':00',
      ),
    },
    weekly: {
      remainingPct: weeklyRemainingPct,
      usedPct: 100 - weeklyRemainingPct,
      resetsOnLocal: dateOnly(weeklyYear, weeklyMonth, weeklyDay),
    },
  };
}

function readPngDimensions(buffer) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(pngSignature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;

  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (startOfFrameMarkers.has(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) return null;

  const format = buffer.toString('ascii', 12, 16);
  if (format === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (format === 'VP8 ' && buffer.toString('hex', 23, 26) === '9d012a') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (format === 'VP8L' && buffer[20] === 0x2f) {
    return {
      width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8),
      height: 1 + (buffer[22] >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10),
    };
  }
  return null;
}

function usagePanelRectangle(imageBuffer) {
  const dimensions = readPngDimensions(imageBuffer) ??
    readJpegDimensions(imageBuffer) ??
    readWebpDimensions(imageBuffer);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) return null;

  return {
    left: 0,
    top: 0,
    width: Math.min(dimensions.width, Math.max(360, Math.min(600, Math.round(dimensions.width * 0.22)))),
    height: Math.min(dimensions.height, Math.max(300, Math.round(dimensions.height * 0.9))),
  };
}

function usageSignature(usage) {
  return [
    usage.fiveHour.remainingPct,
    usage.fiveHour.resetsAtLocal.slice(-8, -3),
    usage.weekly.remainingPct,
    usage.weekly.resetsOnLocal.slice(5),
  ].join('|');
}

async function recognizeUsageCandidates(worker, imagePath, imageBuffer, rectangle, capture, fullResult) {
  const candidates = [];
  const addCandidate = (name, result) => {
    try {
      candidates.push({
        name,
        usage: parseUsage(result.data.text, capture),
        confidence: Number(result.data.confidence.toFixed(2)),
      });
    } catch {
      // Il candidato non e strutturato abbastanza per essere confrontato.
    }
  };

  if (rectangle) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const panelResult = await worker.recognize(imagePath, { rectangle });
    addCandidate('left-panel-original', panelResult);

    const preparedPanel = await sharp(imageBuffer)
      .extract(rectangle)
      .resize({ width: rectangle.width * 3, kernel: sharp.kernel.lanczos3 })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
    const preparedResult = await worker.recognize(preparedPanel);
    addCandidate('left-panel-preprocessed', preparedResult);
  }

  addCandidate('full-image-fallback', fullResult);
  return candidates;
}

async function recognizeImage(worker, imagePath, imageBuffer, imageName, imageHash) {
  const fileStat = await fs.stat(imagePath);
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  const fullResult = await worker.recognize(imagePath);
  const capture = parseCaptureTimestamp(fullResult.data.text, fileStat);
  const rectangle = usagePanelRectangle(imageBuffer);
  const candidates = await recognizeUsageCandidates(
    worker,
    imagePath,
    imageBuffer,
    rectangle,
    capture,
    fullResult,
  );
  const bySignature = new Map();
  for (const candidate of candidates) {
    const signature = usageSignature(candidate.usage);
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push(candidate);
  }
  const matchingCandidates = [...bySignature.values()]
    .sort((a, b) => b.length - a.length || b[0].confidence - a[0].confidence)[0] ?? [];
  if (matchingCandidates.length < 2) {
    const summary = candidates.length === 0
      ? 'nessun passaggio OCR valido'
      : candidates.map((candidate) => candidate.name + '=' + usageSignature(candidate.usage)).join(', ');
    throw new Error('doppio controllo OCR senza accordo: ' + summary);
  }
  const selected = matchingCandidates
    .slice()
    .sort((a, b) => b.confidence - a.confidence)[0];

  return {
      schemaVersion: 1,
      id: 'usage-' + imageHash,
      imageSha256: imageHash,
      sourceImage: imageName,
      capturedAtLocal: capture.local,
      timeZone,
      processedAt: new Date().toISOString(),
      plan,
      model,
      reasoning,
      ...selected.usage,
      extraction: {
        engine: 'tesseract.js',
        ocrConfidence: selected.confidence,
        captureOcrConfidence: Number(fullResult.data.confidence.toFixed(2)),
        usageOcrConfidence: selected.confidence,
        usageRegion: rectangle ? 'left-panel' : 'full-image',
        usageValidation: {
          requiredMatchingPasses: 2,
          matchingPasses: matchingCandidates.map((candidate) => candidate.name),
          validCandidates: candidates.map((candidate) => ({
            pass: candidate.name,
            signature: usageSignature(candidate.usage),
            confidence: candidate.confidence,
          })),
        },
        captureDateSource: capture.dateSource,
        captureTimeSource: capture.timeSource,
        sourceFileModifiedAt: capture.fileModifiedAt,
        fullOcrTextStored: false,
      },
  };
}

async function createOcrWorker() {
  let lastReportedProgress = -10;
  return createWorker('eng', 1, {
    cachePath: ocrCacheDir,
    logger(message) {
      if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
        const progress = Math.round(message.progress * 100);
        if (progress < lastReportedProgress) lastReportedProgress = -10;
        if (progress === 100 || progress >= lastReportedProgress + 10) {
          lastReportedProgress = progress;
          process.stdout.write('\rOCR: ' + progress + '%   ');
        }
      }
    },
  });
}

async function verifyProcessedImages() {
  const existingUsages = await readJsonLines(usageDataFile);
  const usageByHash = new Map(existingUsages.map((usage) => [usage.imageSha256, usage]));
  const entries = await fs.readdir(processedDir, { withFileTypes: true });
  const images = entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const worker = await createOcrWorker();
  let failures = 0;

  try {
    for (const imageName of images) {
      const imagePath = path.join(processedDir, imageName);
      const imageBuffer = await fs.readFile(imagePath);
      const imageHash = sha256(imageBuffer);
      const stored = usageByHash.get(imageHash);
      try {
        const verified = await recognizeImage(worker, imagePath, imageBuffer, imageName, imageHash);
        if (!stored) throw new Error('nessuna rilevazione storica associata');
        if (usageSignature(verified) !== usageSignature(stored)) {
          throw new Error(
            'valori diversi dallo storico: OCR=' + usageSignature(verified) +
            ', storico=' + usageSignature(stored),
          );
        }
        console.log('\nVerificata: ' + imageName + ' — ' + usageSignature(verified));
      } catch (error) {
        failures += 1;
        console.error('\nVerifica fallita: ' + imageName + ' — ' + error.message);
      }
    }
  } finally {
    await worker.terminate();
  }

  console.log('\nVerifica archivio completata. Immagini: ' + images.length + '; errori: ' + failures + '.');
  if (failures > 0) process.exitCode = 2;
}

function renderUsageHistory(usages) {
  const rows = usages
    .slice()
    .sort((a, b) => a.capturedAtLocal.localeCompare(b.capturedAtLocal))
    .map((item) => [
      '|', item.capturedAtLocal,
      '|', item.fiveHour.remainingPct + '%',
      '|', item.fiveHour.usedPct + '%',
      '|', item.fiveHour.resetsAtLocal,
      '|', item.weekly.remainingPct + '%',
      '|', item.weekly.usedPct + '%',
      '|', item.weekly.resetsOnLocal,
      '|', item.sourceImage,
      '|', item.imageSha256.slice(0, 12),
      '|', formatDecimal(item.extraction.ocrConfidence, 2) + '% |',
    ].join(' '))
    .join('\n');

  return [
    '# Storico delle rilevazioni',
    '',
    'Generato il: ' + new Date().toISOString(),
    '',
    'Questa tabella contiene soltanto dati estratti dalle immagini locali. Non',
    'contiene prezzi o altri dati scaricati da Internet.',
    '',
    '| Rilevazione locale | Residuo 5h | Usato 5h | Reset 5h | Residuo settimanale | Usato settimanale | Reset settimanale | Immagine | SHA-256 | Confidenza OCR |',
    '| --- | ---: | ---: | --- | ---: | ---: | --- | --- | --- | ---: |',
    rows || '| Nessuna rilevazione | — | — | — | — | — | — | — | — | — |',
    '',
  ].join('\n');
}

function renderInternetData(pricingSnapshots, exchangeRateSnapshots) {
  const rows = pricingSnapshots.map((item) => [
    '|', item.fetchedAt,
    '|', item.model,
    '| $' + formatDecimal(item.apiPricesUsdPerMillionTokens.input),
    '| $' + formatDecimal(item.apiPricesUsdPerMillionTokens.cachedInput),
    '| $' + formatDecimal(item.apiPricesUsdPerMillionTokens.output),
    '|', item.chatGptPlus.fiveHourLocalMessages.min + '-' + item.chatGptPlus.fiveHourLocalMessages.max,
    '|', item.chatGptPlus.averageCreditsPerMessage.min + '-' + item.chatGptPlus.averageCreditsPerMessage.max,
    '|', item.creditsPerMillionTokens.input + '/' + item.creditsPerMillionTokens.cachedInput + '/' + item.creditsPerMillionTokens.output,
    '|', item.id, '|',
  ].join(' ')).join('\n');
  const exchangeRows = exchangeRateSnapshots.map((item) => [
    '|', item.rateDate,
    '|', item.fetchedAt,
    '|', formatDecimal(item.usdPerEur, 4),
    '|', formatDecimal(item.eurPerUsd, 4),
    '|', item.source.url,
    '|', item.id, '|',
  ].join(' ')).join('\n');

  return [
    '# Dati scaricati da Internet',
    '',
    'Generato il: ' + new Date().toISOString(),
    '',
    'Ogni riga e uno snapshot indipendente. Prezzi espressi in USD per un milione di',
    'token; i tassi crediti sono nell ordine input/cache/output.',
    '',
    '| Scaricato il | Modello | Input | Cache | Output | Messaggi Plus / 5h | Crediti medi / messaggio | Crediti per 1M token | ID |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    rows || '| Nessuno snapshot | — | — | — | — | — | — | — | — |',
    '',
    '## Cambi BCE',
    '',
    'Il tasso indica quante unita USD valgono 1 EUR; il reciproco e usato per',
    'convertire i costi stimati da USD a EUR.',
    '',
    '| Data tasso | Scaricato il | USD per EUR | EUR per USD | Fonte | ID |',
    '| --- | --- | ---: | ---: | --- | --- |',
    exchangeRows || '| Nessuno snapshot | — | — | — | — | — |',
    '',
    'I tassi BCE sono pubblicati a scopo informativo e non rappresentano',
    'necessariamente il cambio applicato a una transazione.',
    '',
    'Le fonti complete, con URL, timestamp, hash e percorso della copia grezza, sono',
    'conservate nei registri JSONL della cartella internet-data/.',
    '',
  ].join('\n');
}

function renderEstimates(usages, pricingSnapshots, exchangeRateSnapshots) {
  const pricingById = new Map(pricingSnapshots.map((item) => [item.id, item]));
  const rows = usages
    .slice()
    .sort((a, b) => a.capturedAtLocal.localeCompare(b.capturedAtLocal))
    .map((item) => {
      const pricing = pricingById.get(item.pricingSnapshotId) ?? pricingSnapshots.at(-1);
      const exchangeRate = selectExchangeRate(item, exchangeRateSnapshots);
      if (!pricing || !exchangeRate) {
        return '| ' + item.capturedAtLocal + ' | ' + item.fiveHour.usedPct + '% | N/D | N/D | N/D | N/D | N/D | N/D | N/D | N/D |';
      }
      const estimate = estimateUsage(item, pricing);
      const range = (value) => formatInteger(value.min) + '-' + formatInteger(value.max);
      return [
        '|', item.capturedAtLocal,
        '|', item.fiveHour.usedPct + '%',
        '|', formatDecimal(estimate.usedCredits.min) + '-' + formatDecimal(estimate.usedCredits.max),
        '|', range(estimate.tokenEquivalent.input),
        '|', range(estimate.tokenEquivalent.cachedInput),
        '|', range(estimate.tokenEquivalent.output),
        '| $' + formatDecimal(estimate.apiCostUsd.min) + '-$' + formatDecimal(estimate.apiCostUsd.max),
        '| EUR ' + formatDecimal(estimate.apiCostUsd.min * exchangeRate.eurPerUsd) +
          '-EUR ' + formatDecimal(estimate.apiCostUsd.max * exchangeRate.eurPerUsd),
        '|', formatDecimal(exchangeRate.eurPerUsd, 4) + ' (' + exchangeRate.rateDate + ')',
        '|', pricing.fetchedAt, '|',
      ].join(' ');
    })
    .join('\n');
  const totals = aggregateTotals(usages, pricingSnapshots, exchangeRateSnapshots);
  const totalRange = (value, formatter = formatDecimal) =>
    formatter(value.min) + '-' + formatter(value.max);

  return [
    '# Stime derivate',
    '',
    'Generato il: ' + new Date().toISOString(),
    '',
    'Le stime non sono misure di token realmente consumati. La capacita della finestra',
    'di 5 ore e stimata moltiplicando l intervallo ufficiale di messaggi per',
    'l intervallo ufficiale di crediti medi per messaggio. I token sono mostrati come',
    'tre equivalenti separati perche input, cache e output consumano crediti a tassi',
    'diversi; non devono essere sommati.',
    '',
    '| Rilevazione | Usato 5h | Crediti stimati | Token equivalenti input | Token equivalenti cache | Token equivalenti output | Costo USD | Costo EUR | EUR per USD | Prezzi scaricati il |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    rows || '| Nessuna rilevazione | — | — | — | — | — | — | — | — | — |',
    '',
    '## Totale senza doppio conteggio',
    '',
    'Sono considerate ' + totals.includedWindows + ' finestre di 5 ore distinte su ' +
      totals.sourceSnapshots + ' rilevazioni. Nella stessa finestra viene usata',
    'soltanto la percentuale massima osservata.',
    '',
    '- Crediti stimati: ' + totalRange(totals.credits),
    '- Token equivalenti input: ' + totalRange(totals.tokenEquivalent.input, formatInteger),
    '- Token equivalenti cache: ' + totalRange(totals.tokenEquivalent.cachedInput, formatInteger),
    '- Token equivalenti output: ' + totalRange(totals.tokenEquivalent.output, formatInteger),
    '- Costo API equivalente: USD ' + totalRange(totals.apiCostUsd) +
      '; EUR ' + totalRange(totals.apiCostEur),
    '',
    'La percentuale settimanale resta nello storico grezzo. Non viene convertita in',
    'token o costo perche la fonte ufficiale non pubblica una capacita settimanale',
    'numerica.',
    '',
  ].join('\n');
}

async function renderReports() {
  const [usages, pricingSnapshots, exchangeRateSnapshots] = await Promise.all([
    readJsonLines(usageDataFile),
    readJsonLines(pricingDataFile),
    readJsonLines(exchangeRateDataFile),
  ]);

  await Promise.all([
    atomicWrite(path.join(reportsDir, 'usage-history.md'), renderUsageHistory(usages)),
    atomicWrite(path.join(reportsDir, 'internet-data.md'), renderInternetData(pricingSnapshots, exchangeRateSnapshots)),
    atomicWrite(path.join(reportsDir, 'estimates.md'), renderEstimates(usages, pricingSnapshots, exchangeRateSnapshots)),
    atomicWrite(
      path.join(reportsDir, 'dashboard.html'),
      renderDashboard(usages, pricingSnapshots, exchangeRateSnapshots, timeZone, { projectName }),
    ),
    atomicWrite(path.join(csvReportsDir, 'usage-history.csv'), renderUsageCsv(usages)),
    atomicWrite(path.join(csvReportsDir, 'internet-data.csv'), renderInternetCsv(pricingSnapshots)),
    atomicWrite(path.join(csvReportsDir, 'exchange-rates.csv'), renderExchangeRatesCsv(exchangeRateSnapshots)),
    atomicWrite(path.join(csvReportsDir, 'estimates.csv'), renderEstimatesCsv(usages, pricingSnapshots, exchangeRateSnapshots)),
    atomicWrite(path.join(csvReportsDir, 'totals.csv'), renderTotalsCsv(usages, pricingSnapshots, exchangeRateSnapshots)),
  ]);
}

async function archiveImage(imagePath, imageName, imageHash) {
  let destination = path.join(processedDir, imageName);
  try {
    await fs.access(destination);
    const parsed = path.parse(imageName);
    destination = path.join(processedDir, parsed.name + '-' + imageHash.slice(0, 12) + parsed.ext);
  } catch {
    // Il nome e libero.
  }
  await fs.rename(imagePath, destination);
}

async function main() {
  await ensureDirectories();
  if (verifyProcessed) {
    await verifyProcessedImages();
    return;
  }
  const existingUsages = await readJsonLines(usageDataFile);
  const knownHashes = new Set(existingUsages.map((item) => item.imageSha256));
  const entries = await fs.readdir(toProcessDir, { withFileTypes: true });
  const images = entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (images.length === 0) {
    console.log('Nessuna nuova immagine da elaborare.');
    if (!dryRun) await renderReports();
    return;
  }

  const worker = await createOcrWorker();

  const successful = [];
  const failed = [];
  const newUsages = [];
  try {
    for (const imageName of images) {
      const imagePath = path.join(toProcessDir, imageName);
      const imageBuffer = await fs.readFile(imagePath);
      const imageHash = sha256(imageBuffer);

      if (knownHashes.has(imageHash)) {
        console.log('\nGia registrata: ' + imageName);
        successful.push({ imagePath, imageName, imageHash, duplicate: true });
        continue;
      }

      try {
        console.log('\nElaboro: ' + imageName);
        const usage = await recognizeImage(
          worker,
          imagePath,
          imageBuffer,
          imageName,
          imageHash,
        );
        console.log(
          '\nRilevata ' + usage.capturedAtLocal +
          ': 5h usato ' + usage.fiveHour.usedPct +
          '%, settimanale usato ' + usage.weekly.usedPct + '%.',
        );
        knownHashes.add(imageHash);
        newUsages.push(usage);
        successful.push({ imagePath, imageName, imageHash, duplicate: false });
      } catch (error) {
        failed.push({ imageName, error: error.message });
        console.error('\nDa controllare manualmente: ' + imageName + ' — ' + error.message);
      }
    }
  } finally {
    await worker.terminate();
  }

  if (newUsages.length > 0) {
    const acquisition = await acquireInternetSnapshot();
    const finalizedUsages = newUsages.map((usage) => ({
      ...usage,
      pricingSnapshotId: acquisition.pricingSnapshot.id,
    }));

    if (!dryRun) {
      await persistInternetSnapshot(acquisition);
      for (const usage of finalizedUsages) await appendJsonLine(usageDataFile, usage);
    }
  }

  if (!dryRun) {
    if (successful.length > 0) await renderReports();
    for (const image of successful) {
      await archiveImage(image.imagePath, image.imageName, image.imageHash);
    }
  }

  console.log(
    '\nCompletato. Elaborate: ' + successful.length +
    '; da controllare: ' + failed.length +
    '; dry-run: ' + dryRun + '.',
  );
  if (failed.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error('Errore: ' + error.message);
  process.exitCode = 1;
});
