import { parseScreenshotCapturedAt } from './ocr-time';

describe('parseScreenshotCapturedAt', () => {
  it('legge data e ora Windows dall’angolo dello screenshot', () => {
    const value = parseScreenshotCapturedAt('17:39:37  17/09/2026');
    expect([
      value.getFullYear(), value.getMonth() + 1, value.getDate(),
      value.getHours(), value.getMinutes(), value.getSeconds(),
    ]).toEqual([2026, 9, 17, 17, 39, 37]);
  });

  it('accetta i separatori che Tesseract confonde più spesso', () => {
    const value = parseScreenshotCapturedAt('15.58.04 17-09-2026');
    expect([value.getHours(), value.getMinutes(), value.getSeconds()]).toEqual([15, 58, 4]);
  });

  it('rifiuta testo senza un timestamp completo', () => {
    expect(() => parseScreenshotCapturedAt('17:39 senza data')).toThrow('SCREENSHOT_TIMESTAMP_UNREADABLE');
  });
});
