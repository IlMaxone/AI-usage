import { computeRecordUsage } from './records';

const reset = new Date('2026-09-17T18:00:00.000Z');

describe('computeRecordUsage', () => {
  it('usa la percentuale letta per un usage costante', () => {
    expect(computeRecordUsage('CONSTANT', { fiveHourUsedPct: 37, fiveHourResetsAt: reset }))
      .toEqual({ status: 'MEASURED', usedPct: 37 });
  });

  it('calcola il delta di un segmento nella stessa finestra 5h', () => {
    expect(computeRecordUsage(
      'SEGMENT',
      undefined,
      { fiveHourUsedPct: 18, fiveHourResetsAt: reset },
      { fiveHourUsedPct: 43, fiveHourResetsAt: reset },
    )).toMatchObject({ status: 'SEGMENT_MEASURED', usedPct: 25 });
  });

  it('accetta reset 5h disallineati fino a 60 minuti', () => {
    expect(computeRecordUsage(
      'SEGMENT',
      undefined,
      { fiveHourUsedPct: 18, fiveHourResetsAt: reset, weeklyUsedPct: 50, weeklyResetsOn: '2026-09-21' },
      { fiveHourUsedPct: 43, fiveHourResetsAt: new Date('2026-09-17T19:00:00.000Z'), weeklyUsedPct: 8, weeklyResetsOn: '2026-09-28' },
    )).toMatchObject({
      status: 'SEGMENT_MEASURED',
      usedPct: 25,
      alignment: { fiveHourResetOffsetMinutes: 60, weeklyResetSignal: 'ROLLOVER' },
    });
  });

  it('non blocca il segmento per un salto anomalo del reset settimanale', () => {
    expect(computeRecordUsage(
      'SEGMENT',
      undefined,
      { fiveHourUsedPct: 18, fiveHourResetsAt: reset, weeklyUsedPct: 12, weeklyResetsOn: '2026-09-21' },
      { fiveHourUsedPct: 43, fiveHourResetsAt: reset, weeklyUsedPct: 35, weeklyResetsOn: '2026-09-24' },
    )).toMatchObject({ status: 'SEGMENT_MEASURED', alignment: { weeklyResetSignal: 'SHIFTED' } });
  });

  it('rifiuta il delta tra finestre 5h differenti', () => {
    expect(computeRecordUsage(
      'SEGMENT',
      undefined,
      { fiveHourUsedPct: 18, fiveHourResetsAt: reset },
      { fiveHourUsedPct: 43, fiveHourResetsAt: new Date('2026-09-17T23:00:00.000Z') },
    )).toMatchObject({ status: 'WINDOW_MISMATCH', usedPct: null });
  });
});
