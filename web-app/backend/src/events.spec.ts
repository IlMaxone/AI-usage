import { computeEventUsage } from './events';

describe('computeEventUsage', () => {
  const reset = new Date('2026-09-17T12:00:00Z');

  it('attributes only the delta between start and end', () => {
    expect(computeEventUsage(
      { fiveHourUsedPct: 20, fiveHourResetsAt: reset },
      { fiveHourUsedPct: 55, fiveHourResetsAt: reset },
    )).toEqual({ status: 'PAIRED', usedPct: 35 });
  });

  it('uses the historical end-only behavior when start is omitted', () => {
    expect(computeEventUsage(undefined, { fiveHourUsedPct: 55, fiveHourResetsAt: reset }))
      .toEqual({ status: 'END_ONLY', usedPct: 55 });
  });

  it('does not combine different five-hour windows', () => {
    expect(computeEventUsage(
      { fiveHourUsedPct: 20, fiveHourResetsAt: reset },
      { fiveHourUsedPct: 55, fiveHourResetsAt: new Date('2026-09-17T17:00:00Z') },
    ).status).toBe('WINDOW_MISMATCH');
  });
});
