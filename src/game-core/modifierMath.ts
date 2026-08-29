import { applyNumericOperator, roundBattleValue } from './battleMath';
import {
  executeEffectProgram,
  type CoreEffectState,
  type EffectExecutionContext,
  type EffectModifierOperator,
  type EffectProgram,
  type EffectTarget,
  type ModifierStat,
} from './effectDsl';

/** Portable modifier parsing and aggregation rules. */

export type ModifierOperator = '+' | '-' | '*' | '/' | '=';

export interface ModifierOperation {
  operator: ModifierOperator;
  value: number;
}

export interface ModifierBreakdown {
  add: number;
  mul: number;
}

export const MODIFIER_ATTRIBUTE_BY_STAT: Record<ModifierStat, string> = {
  damage: 'damage_modifier',
  damage_taken: 'damage_taken_modifier',
  lust: 'lust_damage_modifier',
  lust_taken: 'lust_damage_taken_modifier',
  heal: 'heal_modifier',
  block: 'block_modifier',
  summon_capacity: 'summon_capacity_modifier',
};

export const MODIFIER_SYMBOL_BY_OPERATOR: Record<EffectModifierOperator, ModifierOperator> = {
  add: '+',
  subtract: '-',
  multiply: '*',
  divide: '/',
  set: '=',
};

export interface ResolvedProgramModifier {
  target: EffectTarget;
  stat: ModifierStat;
  operation: ModifierOperation;
}

/** Resolve validated modifier programs through the existing core evaluator. */
export function resolveEffectProgramModifiers(
  program: EffectProgram,
  state: CoreEffectState,
  context: EffectExecutionContext = { spentEnergy: 0 },
): ResolvedProgramModifier[] {
  const result = executeEffectProgram(program, state, context);
  if (!result.ok) return [];
  return result.events
    .filter(event => event.type === 'modify')
    .map(event => ({
      target: event.target,
      stat: event.stat,
      operation: { operator: MODIFIER_SYMBOL_BY_OPERATOR[event.operator], value: event.value },
    }));
}

export function applyModifierOperation(currentValue: number, operation: ModifierOperation): number {
  return applyNumericOperator(currentValue, operation.operator, operation.value);
}

export function addModifierOperation(breakdown: ModifierBreakdown, operation: ModifierOperation): ModifierBreakdown {
  switch (operation.operator) {
    case '+':
      breakdown.add += operation.value;
      break;
    case '-':
      breakdown.add -= operation.value;
      break;
    case '*':
      breakdown.mul *= operation.value;
      break;
    case '/':
      if (operation.value !== 0) breakdown.mul /= operation.value;
      break;
    case '=':
      break;
  }
  return breakdown;
}

export function roundModifierBreakdown(breakdown: ModifierBreakdown): ModifierBreakdown {
  return { add: roundBattleValue(breakdown.add), mul: roundBattleValue(breakdown.mul) };
}
