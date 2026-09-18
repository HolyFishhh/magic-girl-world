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

/** Only the card's own execution tree counts; summon/template programs have another owner. */
export function hasCardValueTarget(program: EffectProgram | undefined, stat: CardValueStat): boolean {
  const visit = (node: EffectNode): boolean => {
    if (node.op === 'if') return node.then.some(visit) || (node.else || []).some(visit);
    if (node.op === 'register_trigger') return node.effects.some(visit);
    return (stat === 'damage' && node.op === 'damage') || (stat === 'block' && node.op === 'gain_block')
      || (stat === 'lust' && node.op === 'gain_lust') || (stat === 'stacks' && node.op === 'apply_status');
  };
  return !!program?.steps.some(visit);
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

/** True only for compiler-marked authored damage groups; legacy nodes remain one hit each. */
export function hasCardHitTarget(program: EffectProgram | undefined): boolean {
  const visit = (node: EffectNode): boolean => node.op === 'if'
    ? node.then.some(visit) || (node.else || []).some(visit)
    : node.op === 'register_trigger' ? node.effects.some(visit)
      : node.op === 'damage' && typeof node.hitGroup === 'string';
  return !!program?.steps.some(visit);
}

function addHits(entries: EffectNode[], amount: number): EffectNode[] {
  const result: EffectNode[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const node = entries[index];
    if (node.op === 'if') {
      result.push({ ...node, then: addHits(node.then, amount), ...(node.else ? { else: addHits(node.else, amount) } : {}) });
      continue;
    }
    if (node.op === 'register_trigger') {
      result.push({ ...node, effects: addHits(node.effects, amount) });
      continue;
    }
    result.push(node);
    if (node.op !== 'damage' || !node.hitGroup) continue;
    const group = node.hitGroup;
    while (index + 1 < entries.length) {
      const next = entries[index + 1];
      if (next.op !== 'damage' || next.hitGroup !== group) break;
      index += 1;
      result.push(next);
    }
    const current = result.filter(entry => entry.op === 'damage' && entry.hitGroup === group).length;
    const extra = Math.max(0, Math.min(20 - current, amount));
    for (let copy = 0; copy < extra; copy += 1) result.push(structuredClone(node));
  }
  return result;
}

/** Add bounded strikes to each authored card-root damage group, never to summon/template programs. */
export function transformCardHitGroups(program: EffectProgram, add: number): EffectProgram {
  if (!Number.isInteger(add) || add < 1) throw new Error('hits growth must be a positive integer');
  return { ...program, steps: addHits(program.steps, add) };
}

/** Change only this card's offensive effects; summoned units and created cards keep their own targets. */
export function transformCardAttacksToArea(program: EffectProgram): EffectProgram {
  const visit = (node: EffectNode): EffectNode => {
    if (node.op === 'if') return { ...node, then: node.then.map(visit), ...(node.else ? { else: node.else.map(visit) } : {}) };
    if (node.op === 'register_trigger') return { ...node, effects: node.effects.map(visit) };
    if ((node.op === 'damage' || node.op === 'gain_lust') && node.target === 'opponent') {
      return { ...node, targetSelector: { mode: 'all' } };
    }
    return node;
  };
  return { ...program, steps: program.steps.map(visit) };
}
