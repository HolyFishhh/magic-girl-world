/** Portable numeric rules shared by battle runtimes and adapters. */
export type BattleNumericOperator = '+' | '-' | '*' | '/' | '=' | 'set';

export interface BattleAttributeLimits {
  maxHp?: number;
  maxLust?: number;
}

export interface BlockAbsorptionResult {
  damage: number;
  blockUsed: number;
  remainingBlock: number;
}

/** Parse a complete numeric literal without accepting parseFloat-style trailing content. */
export function parseBattleNumericLiteral(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

export function applyNumericOperator(current: number, operator: string, operand: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(operand)) return current;
  switch (operator as BattleNumericOperator) {
    case '+':
      return current + operand;
    case '-':
      return current - operand;
    case '*':
      return current * operand;
    case '/':
      return operand === 0 ? current : current / operand;
    case '=':
    case 'set':
      return operand;
    default:
      return current;
  }
}

export function clampBattleAttribute(attribute: string, value: number, limits: BattleAttributeLimits = {}): number {
  const finiteValue = Number.isFinite(value) ? value : 0;
  if (attribute === 'hp') return Math.max(0, Math.min(finiteValue, limits.maxHp ?? finiteValue));
  if (attribute === 'lust') return Math.max(0, Math.min(finiteValue, limits.maxLust ?? finiteValue));
  if (attribute === 'max_hp' || attribute === 'max_lust' || attribute === 'max_energy') {
    return Math.max(1, finiteValue);
  }
  return Math.max(0, finiteValue);
}

export function roundBattleValue(value: number): number {
  return Math.round(value * 10) / 10;
}

export function absorbDamageWithBlock(incomingDamage: number, currentBlock: number): BlockAbsorptionResult {
  const incoming = Math.max(0, Number.isFinite(incomingDamage) ? incomingDamage : 0);
  const block = Math.max(0, Number.isFinite(currentBlock) ? currentBlock : 0);
  const blockUsed = Math.min(block, incoming);
  return {
    damage: incoming - blockUsed,
    blockUsed,
    remainingBlock: block - blockUsed,
  };
}

/** Evaluate numeric arithmetic without executing JavaScript or rounding the result. */
export function evaluateFiniteBattleMathExpression(expression: string): number {
  const input = expression.replace(/\s+/g, '');
  if (!input) throw new Error('Empty math expression');

  let cursor = 0;
  const peek = (): string => input[cursor] || '';
  const consume = (): string => input[cursor++] || '';

  const parseNumber = (): number => {
    const start = cursor;
    let dotCount = 0;
    while (/\d|\./.test(peek())) {
      if (peek() === '.') dotCount += 1;
      consume();
    }
    const token = input.slice(start, cursor);
    if (!token || token === '.' || dotCount > 1) throw new Error(`Invalid number at position ${start}`);
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error(`Invalid number: ${token}`);
    return value;
  };

  const parseFactor = (): number => {
    if (peek() === '+') {
      consume();
      return parseFactor();
    }
    if (peek() === '-') {
      consume();
      return -parseFactor();
    }
    if (peek() === '(') {
      consume();
      const value = parseExpression();
      if (consume() !== ')') throw new Error(`Missing closing parenthesis at position ${cursor}`);
      return value;
    }
    return parseNumber();
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const operator = consume();
      const operand = parseFactor();
      if (operator === '/' && operand === 0) throw new Error('Division by zero');
      value = operator === '*' ? value * operand : value / operand;
    }
    return value;
  };

  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const operand = parseTerm();
      value = operator === '+' ? value + operand : value - operand;
    }
    return value;
  }

  const result = parseExpression();
  if (cursor !== input.length) throw new Error(`Unexpected token at position ${cursor}`);
  if (!Number.isFinite(result)) throw new Error(`Expression result is not finite: ${result}`);
  return result;
}

/** Evaluate an effect amount and apply the battle rule that amounts are integers. */
export function evaluateBattleMathExpression(expression: string): number {
  return Math.floor(evaluateFiniteBattleMathExpression(expression));
}

type ConditionValue = number | boolean;

/** Evaluate a variable-free battle condition without executing JavaScript. */
export function evaluateBattleConditionExpression(expression: string): boolean {
  const input = expression.replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/＝/g, '=').replace(/≠/g, '!=').trim();
  if (!input) throw new Error('Empty condition expression');

  const tokens: string[] = [];
  for (let cursor = 0; cursor < input.length;) {
    const char = input[cursor];
    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }
    const operator = ['===', '!==', '>=', '<=', '==', '!=', '&&', '||'].find(candidate =>
      input.startsWith(candidate, cursor),
    );
    if (operator) {
      tokens.push(operator);
      cursor += operator.length;
      continue;
    }
    if ('+-*/()><=!'.includes(char)) {
      tokens.push(char);
      cursor += 1;
      continue;
    }
    if (/\d|\./.test(char)) {
      const start = cursor;
      let dotCount = 0;
      while (cursor < input.length && /\d|\./.test(input[cursor])) {
        if (input[cursor] === '.') dotCount += 1;
        cursor += 1;
      }
      const token = input.slice(start, cursor);
      if (token === '.' || dotCount > 1 || !Number.isFinite(Number(token))) {
        throw new Error(`Invalid number at position ${start}`);
      }
      tokens.push(token);
      continue;
    }
    throw new Error(`Unexpected token at position ${cursor}`);
  }

  let cursor = 0;
  const peek = (): string => tokens[cursor] || '';
  const consume = (): string => tokens[cursor++] || '';
  const toNumber = (value: ConditionValue): number => {
    if (typeof value !== 'number') throw new Error('Boolean value cannot be used in arithmetic');
    return value;
  };
  const toBoolean = (value: ConditionValue): boolean => (typeof value === 'boolean' ? value : value !== 0);

  const parsePrimary = (): ConditionValue => {
    if (peek() === '(') {
      consume();
      const value = parseOr();
      if (consume() !== ')') throw new Error('Missing closing parenthesis');
      return value;
    }
    const token = consume();
    if (!token || !Number.isFinite(Number(token))) throw new Error(`Expected number, received ${token || 'EOF'}`);
    return Number(token);
  };

  const parseUnary = (): ConditionValue => {
    if (peek() === '!') {
      consume();
      return !toBoolean(parseUnary());
    }
    if (peek() === '+') {
      consume();
      return toNumber(parseUnary());
    }
    if (peek() === '-') {
      consume();
      return -toNumber(parseUnary());
    }
    return parsePrimary();
  };

  const parseMultiplicative = (): ConditionValue => {
    let value = parseUnary();
    while (peek() === '*' || peek() === '/') {
      const operator = consume();
      const operand = toNumber(parseUnary());
      const numericValue = toNumber(value);
      if (operator === '/' && operand === 0) throw new Error('Division by zero');
      value = operator === '*' ? numericValue * operand : numericValue / operand;
    }
    return value;
  };

  const parseAdditive = (): ConditionValue => {
    let value = parseMultiplicative();
    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const operand = toNumber(parseMultiplicative());
      const numericValue = toNumber(value);
      value = operator === '+' ? numericValue + operand : numericValue - operand;
    }
    return value;
  };

  const parseRelational = (): ConditionValue => {
    let value = parseAdditive();
    while (['>', '<', '>=', '<='].includes(peek())) {
      const operator = consume();
      const left = toNumber(value);
      const right = toNumber(parseAdditive());
      value =
        operator === '>'
          ? left > right
          : operator === '<'
            ? left < right
            : operator === '>='
              ? left >= right
              : left <= right;
    }
    return value;
  };

  const parseEquality = (): ConditionValue => {
    let value = parseRelational();
    while (['=', '==', '===', '!=', '!=='].includes(peek())) {
      const operator = consume();
      const right = parseRelational();
      value = operator === '!=' || operator === '!==' ? value !== right : value === right;
    }
    return value;
  };

  const parseAnd = (): ConditionValue => {
    let value = parseEquality();
    while (peek() === '&&') {
      consume();
      const right = parseEquality();
      value = toBoolean(value) && toBoolean(right);
    }
    return value;
  };

  function parseOr(): ConditionValue {
    let value = parseAnd();
    while (peek() === '||') {
      consume();
      const right = parseAnd();
      value = toBoolean(value) || toBoolean(right);
    }
    return value;
  }

  const result = parseOr();
  if (cursor !== tokens.length) throw new Error(`Unexpected token: ${peek()}`);
  if (typeof result !== 'boolean') throw new Error('Condition expression must resolve to a boolean');
  return result;
}
