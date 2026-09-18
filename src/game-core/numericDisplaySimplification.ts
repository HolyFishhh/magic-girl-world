import type { NumericExpression } from './effectDsl';

/** Conservative display-only bounds. Unknown/signed variables must keep their clamps. */
function lowerBound(value: NumericExpression): number {
  if (typeof value === 'number') return value;
  if (value.op === 'var') return /^(self|opponent)\.status\.[A-Za-z0-9_]+\.stacks$/.test(value.path) ? 0 : -Infinity;
  if (['count_cards', 'count_statuses', 'discard_count', 'abs'].includes(value.op)) return 0;
  if (value.op === 'clamp_min') return Math.max(value.minimum, lowerBound(value.value));
  if (value.op === 'floor') return Math.floor(lowerBound(value.value));
  if (value.op === 'ceil') return Math.ceil(lowerBound(value.value));
  if (value.op === 'add') return lowerBound(value.left) + lowerBound(value.right);
  if (value.op === 'subtract' && typeof value.right === 'number') return lowerBound(value.left) - value.right;
  if (value.op === 'multiply' && typeof value.right === 'number' && value.right > 0) return lowerBound(value.left) * value.right;
  if (value.op === 'divide' && typeof value.right === 'number' && value.right > 0) return lowerBound(value.left) / value.right;
  if (value.op === 'min') return Math.min(...value.values.map(lowerBound));
  if (value.op === 'max') return Math.max(...value.values.map(lowerBound));
  return -Infinity;
}

/** Never changes the stored/executed expression. Fold safe integer additions and redundant guards only. */
export function simplifyNumericDisplay(value: NumericExpression): NumericExpression {
  if (typeof value === 'number') return value;
  if ('value' in value) {
    const inner = simplifyNumericDisplay(value.value);
    if (value.op === 'clamp_min') {
      if (lowerBound(inner) >= value.minimum) return inner;
      if (typeof inner === 'number') return Math.max(value.minimum, inner);
      if (inner.op === 'clamp_min') return { ...inner, minimum: Math.max(value.minimum, inner.minimum) };
    }
    return { ...value, value: inner };
  }
  if ('values' in value) return { ...value, values: value.values.map(simplifyNumericDisplay) };
  if (!('left' in value)) return value;
  const left = simplifyNumericDisplay(value.left), right = simplifyNumericDisplay(value.right);
  if (value.op !== 'add') return { ...value, left, right };
  const terms: NumericExpression[] = [];
  const collect = (term: NumericExpression): void => {
    if (typeof term !== 'number' && term.op === 'add') { collect(term.left); collect(term.right); }
    else terms.push(term);
  };
  collect(left); collect(right);
  const constants = terms.filter((term): term is number => typeof term === 'number');
  const sum = constants.reduce((a, b) => a + b, 0);
  // Avoid re-associating authored decimal arithmetic merely for prettier text.
  if (!constants.every(Number.isSafeInteger) || !Number.isSafeInteger(sum)) return { ...value, left, right };
  const dynamic = terms.filter(term => typeof term !== 'number');
  const simplified: NumericExpression[] = sum || !dynamic.length ? [sum, ...dynamic] : dynamic;
  return simplified.slice(1).reduce<NumericExpression>((result, term) => ({ op: 'add', left: result, right: term }), simplified[0]);
}
