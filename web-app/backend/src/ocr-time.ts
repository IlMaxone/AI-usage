export function parseScreenshotCapturedAt(text: string): Date {
  const normalized = text.normalize('NFKD').replace(/\s+/g, ' ').trim();
  const clock = normalized.match(/\b([01]?\d|2[0-3])[:.;]([0-5]\d)(?:[:.;]([0-5]\d))?\b/);
  const date = normalized.match(/\b(0?[1-9]|[12]\d|3[01])[\/.-](0?[1-9]|1[0-2])[\/.-](\d{4})\b/);
  if (!clock || !date) throw new Error('SCREENSHOT_TIMESTAMP_UNREADABLE');
  const capturedAt = new Date(
    Number(date[3]),
    Number(date[2]) - 1,
    Number(date[1]),
    Number(clock[1]),
    Number(clock[2]),
    Number(clock[3] ?? 0),
    0,
  );
  if (Number.isNaN(capturedAt.getTime())) throw new Error('SCREENSHOT_TIMESTAMP_OUT_OF_RANGE');
  return capturedAt;
}
