import { calculateModelCost } from './cost-analysis';

describe('calculateModelCost', () => {
  it('keeps the window and per-minute estimates independent', () => {
    expect(calculateModelCost(25, {
      currency: 'EUR',
      fiveHourWindowCost: 40,
      costPerMinute: 0.2,
    })).toEqual({
      equivalentUsageMinutes: 75,
      windowBasedCost: 10,
      minuteBasedCost: 15,
      difference: 5,
    });
  });

  it('preserva una tariffa al minuto ad alta precisione nei calcoli', () => {
    expect(calculateModelCost(1, {
      currency: 'EUR',
      fiveHourWindowCost: 0,
      costPerMinute: 0.1454545454545455,
    }).minuteBasedCost).toBe(0.43636363636364);
  });
});
