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
    )).toEqual({ status: 'SEGMENT_MEASURED', usedPct: 25 });
  });

  it('rifiuta il delta tra finestre 5h differenti', () => {
    expect(computeRecordUsage(
      'SEGMENT',
      undefined,
      { fiveHourUsedPct: 18, fiveHourResetsAt: reset },
      { fiveHourUsedPct: 43, fiveHourResetsAt: new Date('2026-09-17T23:00:00.000Z') },
    )).toEqual({ status: 'WINDOW_MISMATCH', usedPct: null });
  });
});
