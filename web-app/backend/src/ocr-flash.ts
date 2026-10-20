import sharp from 'sharp';

export interface SelectorAnchor { x0: number; y0: number; x1: number; y1: number }
const bolt = [
  '0000001100000', '0000011100000', '0000111100000', '0000111100000',
  '0001111111110', '0011111111111', '0111111111110', '1111111111100',
  '1111111111000', '0000111110000', '0000011100000', '0000111100000',
  '0000111000000', '0000110000000',
];

// Compare connected foreground shapes immediately before the model label.
// This never searches conversation text or the Windows taskbar for a lightning.
export function flashShapeScore(data: Uint8Array, width: number, height: number, threshold: number, inverted = false) {
  const foreground = (index: number) => inverted ? data[index]! <= threshold : data[index]! >= threshold;
  const seen = new Uint8Array(width * height); let best = 0;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !foreground(start)) continue;
    const queue = [start]; const points: number[] = []; seen[start] = 1;
    let minX = width, maxX = 0, minY = height, maxY = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]!, x = current % width, y = Math.floor(current / width); points.push(current);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, index = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[index] || !foreground(index)) continue;
        seen[index] = 1; queue.push(index);
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (w < 5 || h < 7 || w / h < .5 || w / h > 1.25 || w >= width - 1 || h >= height - 1) continue;
    const pixels = new Set(points); let intersection = 0, union = 0;
    for (let y = 0; y < 14; y++) for (let x = 0; x < 13; x++) {
      const sourceX = minX + Math.min(w - 1, Math.floor((x + .5) / 13 * w));
      const sourceY = minY + Math.min(h - 1, Math.floor((y + .5) / 14 * h));
      const actual = pixels.has(sourceY * width + sourceX), expected = bolt[y]![x] === '1';
      if (actual || expected) union++; if (actual && expected) intersection++;
    }
    best = Math.max(best, intersection / Math.max(1, union));
  }
  return best;
}

export async function detectFlashIcon(buffer: Buffer, anchor: SelectorAnchor): Promise<'PRESENT' | 'ABSENT' | 'UNCERTAIN'> {
  const metadata = await sharp(buffer).metadata();
  const labelHeight = Math.max(8, anchor.y1 - anchor.y0);
  const left = Math.max(0, Math.floor(anchor.x0 - labelHeight * 2.7));
  const top = Math.max(0, Math.floor(anchor.y0 - labelHeight * .6));
  const right = Math.min(metadata.width!, Math.ceil(anchor.x0 - 1));
  const bottom = Math.min(metadata.height!, Math.ceil(anchor.y1 + labelHeight * .6));
  if (right <= left || bottom <= top) return 'UNCERTAIN';
  const { data, info } = await sharp(buffer).extract({ left, top, width: right - left, height: bottom - top }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const light = [170, 210].map((threshold) => flashShapeScore(data, info.width, info.height, threshold));
  const dark = [70, 110].map((threshold) => flashShapeScore(data, info.width, info.height, threshold, true));
  if (light.every((score) => score >= .72) || dark.every((score) => score >= .72)) return 'PRESENT';
  return Math.max(...light, ...dark) >= .55 ? 'UNCERTAIN' : 'ABSENT';
}
