import { allocateWindowUsage, calculateModelCost } from './cost-analysis';

describe('calculateModelCost', () => {
  it('deriva dal costo al 100% il minutaggio di riferimento della finestra', () => {
    expect(calculateModelCost(25, {
      currency: 'EUR',
      fiveHourWindowCost: 40,
      costPerMinute: 0.2,
    })).toEqual({
      attributedUsedPct: 25,
      windowCostAt100: 40,
      usageMinutesAt100: 200,
      estimatedCost: 10,
      estimatedUsageMinutes: 50,
    });
  });

  it('preserva una tariffa al minuto ad alta precisione nei calcoli', () => {
    expect(calculateModelCost(1, {
      currency: 'EUR',
      fiveHourWindowCost: 43.63636363636365,
      costPerMinute: 0.1454545454545455,
    })).toMatchObject({
      usageMinutesAt100: 300,
      estimatedCost: 0.43636363636364,
      estimatedUsageMinutes: 3,
    });
  });

  it('non applica cap oltre il 100% attribuito', () => {
    expect(calculateModelCost(140, {
      currency: 'EUR',
      fiveHourWindowCost: 20,
      costPerMinute: 0.1,
    })).toMatchObject({
      attributedUsedPct: 140,
      estimatedCost: 28,
      estimatedUsageMinutes: 280,
    });
  });
});

describe('allocateWindowUsage', () => {
  it('attribuisce per delta gli snapshot cumulativi senza degradare la prima lettura', () => {
    expect(allocateWindowUsage([
      { usedPct: 88, endingUsedPct: 88, mode: 'CONSTANT', capturedAt: '2026-09-16T08:14:28Z' },
      { usedPct: 100, endingUsedPct: 100, mode: 'CONSTANT', capturedAt: '2026-09-16T10:32:28Z' },
    ])).toEqual({
      rawUsedPct: 188,
      attributedUsedPct: 100,
      allocations: [88, 12],
    });
  });

  it('usa l’ordine temporale anche quando i record arrivano in ordine inverso', () => {
    expect(allocateWindowUsage([
      { usedPct: 100, endingUsedPct: 100, mode: 'CONSTANT', capturedAt: '2026-09-16T10:32:28Z' },
      { usedPct: 88, endingUsedPct: 88, mode: 'CONSTANT', capturedAt: '2026-09-16T08:14:28Z' },
    ])).toMatchObject({ allocations: [12, 88] });
  });

  it('non applica limiti ai segmenti che superano complessivamente il 100%', () => {
    expect(allocateWindowUsage([
      { usedPct: 80, endingUsedPct: 80, mode: 'SEGMENT', capturedAt: '2026-09-16T08:00:00Z' },
      { usedPct: 60, endingUsedPct: 100, mode: 'SEGMENT', capturedAt: '2026-09-16T10:00:00Z' },
    ])).toEqual({
      rawUsedPct: 140,
      attributedUsedPct: 140,
      allocations: [80, 60],
    });
  });
});
