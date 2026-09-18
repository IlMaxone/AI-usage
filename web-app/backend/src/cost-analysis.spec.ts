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
});
