import { BadRequestException } from '@nestjs/common';
import { FormulaService } from './formula';

describe('FormulaService', () => {
  const service = new FormulaService();

  it('evaluates the default calibrated credits formula', () => {
    const result = service.evaluate({
      operation: 'multiply',
      args: [{ operation: 'divide', args: [{ variable: 'usedPct' }, 100] }, { variable: 'fullWindowCredits' }],
    }, { usedPct: 25, fullWindowCredits: 400 });
    expect(result).toBe(100);
  });

  it('rejects division by zero', () => {
    expect(() => service.evaluate({ operation: 'divide', args: [1, 0] }, {}))
      .toThrow(BadRequestException);
  });
});
