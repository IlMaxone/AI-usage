export interface ParsedUsage {
  fiveHourRemainingPct: number; fiveHourUsedPct: number; fiveHourResetsAt: Date;
  weeklyRemainingPct: number; weeklyUsedPct: number; weeklyResetsOn: string;
}
const months = new Map<string, number>([
  ['gen', 0], ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['mag', 4], ['may', 4],
  ['giu', 5], ['jun', 5], ['lug', 6], ['jul', 6], ['ago', 7], ['aug', 7],
  ['set', 8], ['sep', 8], ['ott', 9], ['oct', 9], ['nov', 10], ['dic', 11], ['dec', 11],
]);

export function parseUsage(text: string, capturedAt: Date): ParsedUsage {
  const value = text.normalize('NFKD').replace(/[|]/g, 'I').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  // Older panels wrap "Limite settimanale" across lines, often with the
  // percentage between the two words in OCR order. They expose no reset date.
  if (/\blimite\s+di\s+5\b/i.test(value) && /\bsettimanale\b/i.test(value)
    && !/\b\d{1,2}\s*(?:gen|jan|feb|mar|apr|mag|may|giu|jun|lug|jul|ago|aug|set|sep|ott|oct|nov|dic|dec)\b/i.test(value)) throw new Error('WEEKLY_RESET_NOT_VISIBLE');
  const fiveHour = value.match(/(?:5\s*h\b|Limite\s+di\s+5\s+ore)\s*(\d{1,3})\s*%/i);
  const weekly = value.match(/(?:Settimanale|Weekly)\s*(\d{1,3})\s*%/i);
  if (!fiveHour) throw new Error('FIVE_HOUR_USAGE_UNREADABLE');
  if (!weekly) throw new Error('WEEKLY_USAGE_UNREADABLE');
  const fiveHourRemainingPct = Number(fiveHour[1]), weeklyRemainingPct = Number(weekly[1]);
  if ([fiveHourRemainingPct, weeklyRemainingPct].some((number) => number > 100)) throw new Error('USAGE_VALUE_OUT_OF_RANGE');
  const afterFiveHour = value.slice(fiveHour.index! + fiveHour[0].length).split(/(?:Settimanale|Weekly|Limite\s+settimanale)/i)[0]!;
  const clock = afterFiveHour.match(/(?:rimanente\s*)?(?:Si\s+reimposta\s+alle\s*)?(\d{1,2})[:.;](\d{2})\b/i);
  if (!clock) throw new Error('RESET_TIME_UNREADABLE');
  const hour = Number(clock[1]), minute = Number(clock[2]);
  if (hour > 23 || minute > 59) throw new Error('RESET_TIME_OUT_OF_RANGE');
  const resetAt = new Date(capturedAt); resetAt.setHours(hour, minute, 0, 0);
  const elapsed = capturedAt.getTime() - resetAt.getTime();
  // UI clocks have minute precision. An exhausted panel can remain visible just
  // after expiry. Neither case means the window jumps forward by 24 hours.
  if (elapsed >= 60_000 && !(fiveHourRemainingPct === 0 && elapsed <= 60 * 60_000)) resetAt.setDate(resetAt.getDate() + 1);
  const afterWeekly = value.slice(weekly.index! + weekly[0].length, weekly.index! + weekly[0].length + 65);
  const weeklyReset = afterWeekly.match(/\b(\d{1,2})\s*(gen|jan|feb|mar|apr|mag|may|giu|jun|lug|jul|ago|aug|set|sep|ott|oct|nov|dic|dec)\b/i);
  if (!weeklyReset) throw new Error('WEEKLY_RESET_NOT_VISIBLE');
  const month = months.get(weeklyReset[2]!.toLowerCase())!, day = Number(weeklyReset[1]);
  const date = new Date(capturedAt.getFullYear(), month, day, 12);
  if (date.getMonth() !== month || date.getDate() !== day) throw new Error('WEEKLY_RESET_OUT_OF_RANGE');
  if (date < new Date(capturedAt.getFullYear(), capturedAt.getMonth(), capturedAt.getDate())) date.setFullYear(date.getFullYear() + 1);
  return { fiveHourRemainingPct, fiveHourUsedPct: 100 - fiveHourRemainingPct, fiveHourResetsAt: resetAt,
    weeklyRemainingPct, weeklyUsedPct: 100 - weeklyRemainingPct,
    weeklyResetsOn: [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') };
}
