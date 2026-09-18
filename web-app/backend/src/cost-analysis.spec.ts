import { allocateWindowUsage, calculateModelCost } from './cost-analysis';

describe('calculateModelCost', () => {
  it('deriva dal massimale il minutaggio disponibile nella finestra', () => {
    expect(calculateModelCost(25, {
      currency: 'EUR',
      fiveHourWindowCost: 40,
      costPerMinute: 0.2,
    })).toEqual({
      attributedUsedPct: 25,
      maximumWindowCost: 40,
      maximumUsageMinutes: 200,
      estimatedCost: 10,
      estimatedUsageMinutes: 50,
      remainingWindowCost: 30,
    });
  });

  it('preserva una tariffa al minuto ad alta precisione nei calcoli', () => {
    expect(calculateModelCost(1, {
      currency: 'EUR',
      fiveHourWindowCost: 43.63636363636365,
      costPerMinute: 0.1454545454545455,
    })).toMatchObject({
      maximumUsageMinutes: 300,
      estimatedCost: 0.43636363636364,
      estimatedUsageMinutes: 3,
    });
  });

  it('non supera mai il massimale della finestra', () => {
    expect(calculateModelCost(140, {
      currency: 'EUR',
      fiveHourWindowCost: 20,
      costPerMinute: 0.1,
    })).toMatchObject({
      attributedUsedPct: 100,
      estimatedCost: 20,
      estimatedUsageMinutes: 200,
      remainingWindowCost: 0,
    });
  });
});

describe('allocateWindowUsage', () => {
  it('riduce proporzionalmente più rilevazioni della stessa finestra al massimo del 100%', () => {
    expect(allocateWindowUsage([80, 60])).toEqual({
      rawUsedPct: 140,
      attributedUsedPct: 100,
      cappedByWindow: true,
      allocations: [57.14285714, 42.85714286],
    });
  });
});
