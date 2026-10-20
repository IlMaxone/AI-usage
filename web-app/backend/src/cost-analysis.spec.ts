import { allocateWindowUsage, calculateExploredCost, calculateModelCost } from './cost-analysis';

describe('calculateModelCost', () => {
  it('usa il limite esplicito del CSV anche con tariffe arrotondate e oltre il 100%', () => {
    const pricing = { currency: 'EUR' as const, fiveHourWindowCost: 13.54, costPerMinute: 0.1455, maxTimeWindowMinutes: 93.05 };
    expect(calculateModelCost(50, pricing)).toMatchObject({ usageMinutesAt100: 93.05, estimatedUsageMinutes: 46.525, estimatedCost: 6.77 });
    expect(calculateModelCost(140, pricing)).toMatchObject({ estimatedUsageMinutes: 130.27, estimatedCost: 18.956 });
    expect(calculateExploredCost(50, pricing, { ...pricing, costPerMinute: 0.3373, maxTimeWindowMinutes: 40 + 8 / 60 })).toMatchObject({
      estimatedUsageMinutes: 46.525, actualEstimatedCost: 6.77, estimatedCost: 15.6928825,
    });
  });
  it('deriva dal costo al 100% il minutaggio di riferimento della finestra', () => {
    expect(calculateModelCost(25, {
      currency: 'EUR',
      fiveHourWindowCost: 40,
      costPerMinute: 0.2,
    })).toEqual({
      attributedUsedPct: 25,
      windowCostAt100: 13.54,
      usageMinutesAt100: 67.7,
      estimatedCost: 3.385,
      estimatedUsageMinutes: 16.925,
    });
  });

  it('preserva una tariffa al minuto ad alta precisione nei calcoli', () => {
    expect(calculateModelCost(1, {
      currency: 'EUR',
      fiveHourWindowCost: 43.63636363636365,
      costPerMinute: 0.1454545454545455,
    })).toMatchObject({
      usageMinutesAt100: 93.0875,
      estimatedCost: 0.1354,
      estimatedUsageMinutes: 0.930875,
    });
  });

  it('non applica cap oltre il 100% attribuito', () => {
    expect(calculateModelCost(140, {
      currency: 'EUR',
      fiveHourWindowCost: 20,
      costPerMinute: 0.1,
    })).toMatchObject({
      attributedUsedPct: 140,
      estimatedCost: 18.956,
      estimatedUsageMinutes: 189.56,
    });
  });
});

describe('confronto esplorativo', () => {
  it('mantiene il lavoro equivalente originale e confronta le tariffe', () => {
    const source = { currency: 'EUR' as const, fiveHourWindowCost: 13.54, costPerMinute: 0.1 };
    const target = { ...source, costPerMinute: 0.2 };
    expect(calculateExploredCost(50, source, target)).toMatchObject({
      actualEstimatedCost: 6.77, estimatedCost: 13.54, estimatedUsageMinutes: 67.7, costDifference: 6.77,
    });
    expect(calculateExploredCost(50, source)).toMatchObject({ estimatedCost: 6.77, costDifference: 0 });
  });
  it('non inventa un confronto quando la tariffa originale è assente', () => {
    const source = { currency: 'EUR' as const, fiveHourWindowCost: 13.54, costPerMinute: 0 };
    expect(calculateExploredCost(50, source, { ...source, costPerMinute: 0.1 }).estimatedCost).toBeNull();
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
