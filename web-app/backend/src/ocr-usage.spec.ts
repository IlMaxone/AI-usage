import { parseUsage } from './ocr-usage';

describe('valori e reset del pannello usage', () => {
  it('mantiene la finestra nello stesso minuto, anche esaurita da pochi secondi', () => {
    const captured = new Date(2026, 9, 8, 17, 46, 26);
    const value = parseUsage('5 h 0% 17:46 Settimanale 84% 15 ott', captured);
    expect(value.fiveHourResetsAt).toEqual(new Date(2026, 9, 8, 17, 46));
    expect(value.fiveHourUsedPct).toBe(100);
    expect(parseUsage('5h 20% 17:46 Settimanale 84% 15 ott', captured).fiveHourResetsAt).toEqual(value.fiveHourResetsAt);
  });
  it('conserva un pannello esaurito da meno di un’ora, ma tratta il reset notturno come futuro', () => {
    expect(parseUsage('5h 0% 17:46 Settimanale 84% 15 ott', new Date(2026, 9, 8, 18, 2)).fiveHourResetsAt).toEqual(new Date(2026, 9, 8, 17, 46));
    expect(parseUsage('5h 40% 02:15 Settimanale 84% 15 ott', new Date(2026, 9, 8, 23, 30)).fiveHourResetsAt).toEqual(new Date(2026, 9, 9, 2, 15));
  });
  it('distingue i vecchi pannelli senza reset settimanale, senza inventare una data', () => {
    const old = 'Limite di 5 ore 71% rimanente Si reimposta alle 17:55 Limite settimanale 96% rimanente';
    expect(() => parseUsage(old, new Date(2026, 8, 28, 17, 21))).toThrow('WEEKLY_RESET_NOT_VISIBLE');
    expect(() => parseUsage('Limite di 5 100% rimanente ore Si reimposta alle 14:53 Limite 96% rimanente settimanale', new Date(2026, 8, 30, 9, 53))).toThrow('WEEKLY_RESET_NOT_VISIBLE');
  });
  it('rifiuta date e percentuali impossibili e non prende la percentuale settimanale per quella 5h', () => {
    const date = new Date(2026, 9, 8, 10);
    expect(() => parseUsage('5h illeggibile Settimanale 60% 15:00 25 ott', date)).toThrow('FIVE_HOUR_USAGE_UNREADABLE');
    expect(() => parseUsage('5h 110% 15:00 Settimanale 60% 25 ott', date)).toThrow('USAGE_VALUE_OUT_OF_RANGE');
    expect(() => parseUsage('5h 80% 15:00 Settimanale 60% 31 feb', date)).toThrow('WEEKLY_RESET_OUT_OF_RANGE');
  });
});
