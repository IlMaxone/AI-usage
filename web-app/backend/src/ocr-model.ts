import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { PSM, Worker } from 'tesseract.js';

export interface ModelCandidate { id: string; name: string; reasoning: string }
const normalized = (value: string) => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const reasoningLabels: Record<string, string[]> = {
  high: ['high', 'alto'], xhigh: ['xhigh', 'extra high', 'molto alto'],
  medium: ['medium', 'medio'], low: ['low', 'basso'], minimal: ['minimal', 'minimo'],
  max: ['max', 'massimo'], ultra: ['ultra'], none: ['none', 'nessuno'],
};

// Match only a catalog name followed immediately by its reasoning label.
// Never infer an unknown model or choose a default when OCR is ambiguous.
export function parseModelLabel(text: string, models: ModelCandidate[]): string | null {
  const value = text.normalize('NFKD').toLowerCase().replace(/[–—]/g, '-');
  const pattern = (label: string) => (label.toLowerCase().match(/[a-z0-9]+/g) ?? []).join('[\\s.:-]*');
  const matches = models.filter((model) => {
    const labels = reasoningLabels[normalized(model.reasoning)] ?? [model.reasoning];
    return labels.some((label) => new RegExp(`\\b${pattern(model.name)}[\\s.:-]*${pattern(label)}\\b`).test(value));
  });
  return matches.length === 1 ? matches[0]!.id : null;
}

export async function recognizeModelTag(worker: Worker, filePath: string, models: ModelCandidate[]) {
  const buffer = await fs.readFile(filePath);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error('IMAGE_DIMENSIONS_UNREADABLE');
  // The model selector lives at the bottom of the composer. Exclude the left
  // account panel, conversation body and Windows taskbar from model detection.
  const left = Math.floor(metadata.width * 0.25);
  const top = Math.floor(metadata.height * 0.72);
  const region = { left, top, width: Math.max(1, Math.floor(metadata.width * 0.7)), height: Math.max(1, Math.floor(metadata.height * 0.23)) };
  const crop = sharp(buffer).extract(region);
  const inputs = await Promise.all([
    crop.clone().png().toBuffer(),
    crop.clone().resize({ width: region.width * 2 }).grayscale().normalize().sharpen().png().toBuffer(),
    crop.clone().resize({ width: region.width * 3 }).grayscale().normalize().threshold(145).png().toBuffer(),
  ]);
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const groups = new Map<string, string[]>();
  for (let index = 0; index < inputs.length; index++) {
    const result = await worker.recognize(inputs[index]!);
    const id = parseModelLabel(result.data.text, models);
    if (id) groups.set(id, [...(groups.get(id) ?? []), `model-${index + 1}`]);
  }
  const agreement = [...groups.entries()].find(([, passes]) => passes.length >= 2);
  return agreement ? { modelId: agreement[0], matchingPasses: agreement[1] } : null;
}
