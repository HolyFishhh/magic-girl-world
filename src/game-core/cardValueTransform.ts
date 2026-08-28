import { roundBattleValue } from './battleMath';
import type {
  CardValueOperator,
  CardValueStat,
  EffectNode,
  EffectProgram,
  NumericExpression,
} from './effectDsl';

export interface CardValueTransform {
  stat: CardValueStat;
  operator: CardValueOperator;
  value: number;
}

function transformedNumber(
  current: NumericExpression,
  operator: CardValueOperator,
  value: number,
): NumericExpression {
  if (typeof current === 'number') {
    const next =
      operator === 'add'
        ? current + value
        : operator === 'subtract'
          ? current - value
          : operator === 'multiply'
            ? current * value
            : current / value;
    return roundBattleValue(Math.max(0, next));
  }
  const adjusted: NumericExpression = { op: operator, left: current, right: value };
  return { op: 'clamp_min', value: adjusted, minimum: 0 };
}

function transformNode(node: EffectNode, transform: CardValueTransform): EffectNode {
  if (node.op === 'if') {
    return {
      ...node,
      then: node.then.map(entry => transformNode(entry, transform)),
      ...(node.else ? { else: node.else.map(entry => transformNode(entry, transform)) } : {}),
    };
  }
  if (node.op === 'register_trigger') {
    return { ...node, effects: node.effects.map(entry => transformNode(entry, transform)) };
  }
  if (transform.stat === 'damage' && node.op === 'damage') {
    return { ...node, amount: transformedNumber(node.amount, transform.operator, transform.value) };
  }
  if (transform.stat === 'block' && node.op === 'gain_block') {
    return { ...node, amount: transformedNumber(node.amount, transform.operator, transform.value) };
  }
  if (transform.stat === 'lust' && node.op === 'gain_lust') {
    return { ...node, amount: transformedNumber(node.amount, transform.operator, transform.value) };
  }
  if (transform.stat === 'stacks' && node.op === 'apply_status') {
    return { ...node, stacks: transformedNumber(node.stacks, transform.operator, transform.value) };
  }
  return node;
}

/**
 * Change one family of authored card values without changing hit count, effect order,
 * conditions, targets, or generated-card templates.
 */
export function transformCardEffectProgram(
  program: EffectProgram,
  transform: CardValueTransform,
): EffectProgram {
  if (!Number.isFinite(transform.value)) throw new Error('card value transform must be finite');
  if (transform.operator === 'divide' && transform.value === 0) {
    throw new Error('card value transform cannot divide by zero');
  }
  return {
    ...program,
    steps: program.steps.map(node => transformNode(node, transform)),
  };
}
