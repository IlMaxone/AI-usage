import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { PSM, Worker } from 'tesseract.js';
import { detectFlashIcon } from './ocr-flash';
import { logOcr, OcrTrace } from './ocr-diagnostics';
import { screenshotContentBounds } from './ocr-geometry';

export interface ModelCandidate { id: string; name: string; reasoning: string }
const normalized = (value: string) => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const reasoningLabels: Record<string, string[]> = {
  high: ['high', 'alto'], xhigh: ['xhigh', 'extra high', 'molto alto'],
  medium: ['medium', 'medio'], low: ['low', 'basso', 'light', 'leggero'], minimal: ['minimal', 'minimo'],
  max: ['max', 'massimo'], ultra: ['ultra'], none: ['none', 'nessuno'],
  xhighflash: ['xhigh flash', 'extra high flash', 'molto alto flash'],
  xhighfast: ['xhigh fast', 'extra high fast', 'molto alto fast'],
};
const reasoningIdentity = (value: string) => normalized(value) === 'light' ? 'low' : normalized(value);

function modelNamePattern(name: string, pattern: (label: string) => string) {
  const gpt = /^gpt[\s.:-]*(\d+)(?:\.(\d+))?[\s:-]+(.+)$/i.exec(name.trim());
  if (!gpt) return pattern(name);
  // UI labels omit GPT on some versions. Only a whole-number version may
  // omit its .0 suffix: 6/6.0 are aliases, while 6.1 remains a different model.
  const major = String(Number(gpt[1]));
  const minor = gpt[2] === undefined ? 0 : Number(gpt[2]);
  const version = minor === 0 ? `${major}(?:[\\s.:]+0)?` : `${major}[\\s.:]+${minor}`;
  return `(?:gpt[\\s.:-]*)?${version}[\\s.:-]*${pattern(gpt[3]!)}`;
}

// Match only a catalog name followed immediately by its reasoning label.
// Never infer an unknown model or choose a default when OCR is ambiguous.
export function parseModelLabel(text: string, models: ModelCandidate[]): string | null {
  const value = text.normalize('NFKD').toLowerCase().replace(/[–—]/g, '-');
  const pattern = (label: string) => (label.toLowerCase().match(/[a-z0-9]+/g) ?? []).join('[\\s.:-]*');
  const matches = models.filter((model) => {
    const labels = reasoningLabels[reasoningIdentity(model.reasoning)] ?? [model.reasoning];
    return labels.some((label) => new RegExp(`(?<![a-z0-9.])${modelNamePattern(model.name, pattern)}[\\s.:-]*${pattern(label)}\\b`).test(value));
  });
  return matches.length === 1 ? matches[0]!.id : null;
}

export type ModelSelectorResult =
  | { status: 'MATCHED'; modelId: string; flash: boolean; matchingPasses: string[] }
  | { status: 'UNAVAILABLE'; modelName: string; reasoning: string; flash: boolean; matchingPasses: string[] }
  | { status: 'UNREADABLE' };

export async function recognizeModelSelector(worker: Worker, filePath: string, models: ModelCandidate[], trace?: OcrTrace): Promise<ModelSelectorResult> {
  logOcr(trace, 'model', 'info', 'MODEL_CATALOG_LOADED', { catalogCount: models.length, catalog: models.map((model) => ({ modelId: model.id, name: model.name, reasoning: model.reasoning })) });
  const buffer = await fs.readFile(filePath);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error('IMAGE_DIMENSIONS_UNREADABLE');
  const content = await screenshotContentBounds(buffer);
  // The model selector lives at the bottom of the composer. Exclude the left
  // account panel, conversation body and Windows taskbar from model detection.
  const left = Math.floor(metadata.width * 0.25);
  const top = content.top + Math.floor(content.height * 0.72);
  const compact = metadata.width <= 900 && metadata.height <= 180;
  const region = compact ? { left: 0, top: 0, width: metadata.width, height: metadata.height }
    : { left, top, width: Math.max(1, Math.floor(metadata.width * 0.7)), height: Math.max(1, Math.floor(content.height * 0.23)) };
  const bases: ModelCandidate[] = [];
  const variants = new Map<string, ModelCandidate[]>();
  const addBase = (name: string, reasoning: string, model?: ModelCandidate) => {
    const id = normalized(name) + ':' + reasoningIdentity(reasoning);
    if (!variants.has(id)) { bases.push({ id, name, reasoning }); variants.set(id, []); }
    if (model) variants.get(id)!.push(model);
  };
  // "flash" is a legacy CSV alias; the UI calls the lightning mode Fast.
  for (const model of models) addBase(model.name, model.reasoning.replace(/[\s-]+(?:fast|flash)$/i, ''), model);
  // Recognize an unavailable reasoning explicitly; never borrow another rate.
  for (const name of new Set(models.map((model) => model.name))) {
    for (const reasoning of Object.keys(reasoningLabels).filter((label) => !/(?:fast|flash)$/.test(label))) addBase(name, reasoning);
  }
  // Short desktop captures can confuse sparse text segmentation with the
  // composer controls. A second region isolates the selector's text baseline.
  // Each region independently needs two agreeing transforms; a weak read from
  // one region is never combined with one from another to manufacture agreement.
  const focusTop = Math.max(content.top, content.top + content.height - 125);
  const focused = { left: Math.floor(metadata.width * .57), top: focusTop, width: Math.max(1, Math.floor(metadata.width * .16)), height: Math.min(65, content.top + content.height - focusTop) };
  const regions: Array<[string, typeof region, PSM]> = [['model', region, compact ? PSM.SINGLE_LINE : PSM.SPARSE_TEXT], ['model-focus', focused, PSM.SINGLE_LINE]];
  for (const [name, bounds, mode] of regions) {
    logOcr(trace, 'model', 'info', 'MODEL_REGION_STARTED', { region: bounds });
    const crop = sharp(buffer).extract(bounds);
    const inputs = name === 'model' ? await Promise.all([
      crop.clone().png().toBuffer(),
      crop.clone().resize({ width: bounds.width * 2 }).grayscale().normalize().sharpen().png().toBuffer(),
      crop.clone().resize({ width: bounds.width * 3 }).grayscale().normalize().threshold(145).png().toBuffer(),
    ]) : await Promise.all([
      crop.clone().resize({ width: bounds.width * 2 }).grayscale().normalize().sharpen().png().toBuffer(),
      crop.clone().resize({ width: bounds.width * 3 }).grayscale().normalize().sharpen().png().toBuffer(),
      crop.clone().resize({ width: bounds.width * 3 }).grayscale().normalize().threshold(145).png().toBuffer(),
    ]);
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    const groups = new Map<string, { base: ModelCandidate; flash: boolean; passes: string[] }>();
    for (let index = 0; index < inputs.length; index++) {
      const pass = `${name}-${index + 1}`;
      const result = await worker.recognize(inputs[index]!, {}, { blocks: true });
      const id = parseModelLabel(result.data.text, bases);
      const base = bases.find((item) => item.id === id);
      if (!base) { logOcr(trace, 'model', 'warning', 'MODEL_LABEL_UNREADABLE', { pass, confidence: result.data.confidence }); continue; }
      const lines = result.data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)) ?? [];
      const line = lines.find((candidate) => parseModelLabel(candidate.text, bases) === id);
      if (!line) { logOcr(trace, 'model', 'warning', 'MODEL_LINE_UNREADABLE', { pass }); continue; }
      const version = /\d+(?:\.\d+)?/.exec(base.name)?.[0];
      const word = line.words.find((item) => /^gpt\b/i.test(item.text))
        ?? line.words.find((item) => version && item.text.replace(/[^0-9.]/g, '') === version)
        ?? line.words.find((item) => normalized(item.text) === normalized(base.name.split(/[\s-]/)[0]!));
      if (!word || word.bbox.x0 < 2) { logOcr(trace, 'model', 'warning', 'MODEL_ANCHOR_MISSING', { pass }); continue; }
      const scale = name === 'model' ? [1, 2, 3][index]! : [2, 3, 3][index]!;
      const anchor = { x0: bounds.left + word.bbox.x0 / scale, x1: bounds.left + word.bbox.x1 / scale,
        y0: bounds.top + word.bbox.y0 / scale, y1: bounds.top + word.bbox.y1 / scale };
      if (!regions.some(([regionName]) => regionName === 'model-line')) {
        const h = Math.max(8, anchor.y1 - anchor.y0), x = Math.max(left, Math.floor(anchor.x0 - h * 3));
        const y = Math.max(content.top, Math.floor(anchor.y0 - h * .6));
        const endWord = [...line.words].reverse().find((item) => /^(?:alto|high|medio|medium|basso|low|light|xhigh|ultra|max|minimal|none)$/i.test(item.text.replace(/[^a-z]/gi, '')));
        const right = endWord ? bounds.left + endWord.bbox.x1 / scale + h : anchor.x0 + h * 19;
        regions.push(['model-line', { left: x, top: y, width: Math.min(metadata.width - x, Math.max(1, Math.ceil(right - x))),
          height: Math.min(content.top + content.height - y, Math.ceil(h * 2.2)) }, PSM.SINGLE_LINE]);
      }
      const flashEvidence = await detectFlashIcon(buffer, anchor);
      if (flashEvidence === 'UNCERTAIN') { logOcr(trace, 'model', 'warning', 'FAST_ICON_UNCERTAIN', { pass }); continue; }
      const flash = flashEvidence === 'PRESENT';
      logOcr(trace, 'model', 'info', 'MODEL_PASS_ACCEPTED', { pass, modelName: base.name, reasoning: base.reasoning, fast: flash, confidence: result.data.confidence });
      const key = id + ':' + flash;
      const group = groups.get(key) ?? { base, flash, passes: [] };
      group.passes.push(`${name}-${index + 1}`); groups.set(key, group);
    }
    const agreement = [...groups.values()].find((group) => group.passes.length >= 2);
    if (agreement) {
      const matching = variants.get(agreement.base.id)!.filter((model) => /[\s-]+(?:fast|flash)$/i.test(model.reasoning) === agreement.flash);
      if (matching.length === 1) {
        logOcr(trace, 'model', 'info', 'MODEL_TAG_CONFIRMED', { modelId: matching[0]!.id, matchingPasses: agreement.passes });
        return { status: 'MATCHED', modelId: matching[0]!.id, flash: agreement.flash, matchingPasses: agreement.passes };
      }
      if (!matching.length) {
        logOcr(trace, 'model', 'error', 'MODEL_VARIANT_UNAVAILABLE', { modelName: agreement.base.name, reasoning: agreement.base.reasoning, fast: agreement.flash, matchingPasses: agreement.passes });
        return { status: 'UNAVAILABLE', modelName: agreement.base.name, reasoning: agreement.base.reasoning, flash: agreement.flash, matchingPasses: agreement.passes };
      }
    }
    logOcr(trace, 'model', 'warning', 'MODEL_REGION_NO_AGREEMENT', { requiredMatchingPasses: 2 });
  }
  logOcr(trace, 'model', 'error', 'MODEL_NO_AGREEMENT', { requiredMatchingPasses: 2 });
  return { status: 'UNREADABLE' };
}

export async function recognizeModelTag(worker: Worker, filePath: string, models: ModelCandidate[]) {
  const result = await recognizeModelSelector(worker, filePath, models);
  return result.status === 'MATCHED' ? { modelId: result.modelId, matchingPasses: result.matchingPasses } : null;
}

export function modelSelectorFailure(result: ModelSelectorResult) {
  return result.status === 'UNAVAILABLE'
    ? `Modello ${result.modelName}, reasoning ${result.reasoning}${result.flash ? ', modalità Fast' : ''}, riconosciuto ma variante assente nel catalogo CSV.`
    : 'Selettore modello/reasoning o modalità Fast non confermato da due letture concordi.';
}
