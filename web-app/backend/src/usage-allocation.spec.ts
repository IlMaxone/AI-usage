import { allocateWindowUsage, groupByWindow, projectUsageShares } from './usage-allocation';

describe('distribuzione fra progetti', () => {
  it('ripartisce sul totale, senza mostrare la somma di percentuali come quota', () => {
    expect(projectUsageShares([322, 2512, 48])).toEqual([11.17, 87.16, 1.67]);
    expect(projectUsageShares([1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
    expect(projectUsageShares([0, 0])).toEqual([0, 0]);
  });
  it('attribuisce gli incrementi tra progetti prima di normalizzare, separando le finestre', () => {
    const rows = [
      { usedPct: 88, endingUsedPct: 88, mode: 'CONSTANT' as const, capturedAt: '2026-10-20T08:00:00Z', fiveHourResetsAt: '2026-10-20T12:00:00Z' },
      { usedPct: 100, endingUsedPct: 100, mode: 'CONSTANT' as const, capturedAt: '2026-10-20T09:00:00Z', fiveHourResetsAt: '2026-10-20T12:00:00Z' },
      { usedPct: 50, endingUsedPct: 50, mode: 'CONSTANT' as const, capturedAt: '2026-10-20T14:00:00Z', fiveHourResetsAt: '2026-10-20T17:00:00Z' },
    ];
    const groups = groupByWindow(rows);
    expect(groups).toHaveLength(2);
    const totals = groups.flatMap((group) => allocateWindowUsage(group.records).allocations);
    expect(totals).toEqual([88, 12, 50]);
    expect(totals.reduce((sum, value) => sum + value, 0) / 100).toBe(1.5);
    expect(projectUsageShares([totals[0]! + totals[2]!, totals[1]!])).toEqual([92, 8]);
  });
});
