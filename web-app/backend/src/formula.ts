import { BadRequestException, Injectable } from '@nestjs/common';
import { FormulaExpression } from './entities';

const OPERATIONS = new Set(['add', 'subtract', 'multiply', 'divide', 'min', 'max']);

@Injectable()
export class FormulaService {
  validate(expression: FormulaExpression, depth = 0): void {
    if (depth > 12) throw new BadRequestException('Formula troppo profonda');
    if (typeof expression === 'number') {
      if (!Number.isFinite(expression)) throw new BadRequestException('Numero non valido nella formula');
      return;
    }
    if (!expression || typeof expression !== 'object') throw new BadRequestException('Formula non valida');
    if ('variable' in expression) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(expression.variable)) {
        throw new BadRequestException('Nome variabile non valido');
      }
      return;
    }
    if (!OPERATIONS.has(expression.operation) || !Array.isArray(expression.args)) {
      throw new BadRequestException('Operazione formula non supportata');
    }
    if (expression.args.length < 1 || expression.args.length > 20) {
      throw new BadRequestException('Numero argomenti non valido');
    }
    if (['subtract', 'divide'].includes(expression.operation) && expression.args.length !== 2) {
      throw new BadRequestException(`${expression.operation} richiede due argomenti`);
    }
    expression.args.forEach((item) => this.validate(item, depth + 1));
  }

  evaluate(expression: FormulaExpression, variables: Record<string, number>, depth = 0): number {
    this.validate(expression, depth);
    if (typeof expression === 'number') return expression;
    if ('variable' in expression) {
      const value = variables[expression.variable];
      if (!Number.isFinite(value)) throw new BadRequestException(`Variabile mancante: ${expression.variable}`);
      return value!;
    }
    const values = expression.args.map((item) => this.evaluate(item, variables, depth + 1));
    let result: number;
    switch (expression.operation) {
      case 'add': result = values.reduce((sum, value) => sum + value, 0); break;
      case 'subtract': result = values[0]! - values[1]!; break;
      case 'multiply': result = values.reduce((product, value) => product * value, 1); break;
      case 'divide':
        if (values[1] === 0) throw new BadRequestException('Divisione per zero');
        result = values[0]! / values[1]!;
        break;
      case 'min': result = Math.min(...values); break;
      case 'max': result = Math.max(...values); break;
    }
    if (!Number.isFinite(result)) throw new BadRequestException('Risultato formula non finito');
    return result;
  }
}
