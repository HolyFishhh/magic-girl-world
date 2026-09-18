import { roundBattleValue } from './battleMath';
import type { EffectNode, EffectProgram, NumericExpression } from './effectDsl';
import type { SummonUnitDefinition } from './summonUnit';

export interface PersistentGrowthOperation {
  stat: 'max_hp' | 'max_lust' | 'damage' | 'lust';
  /** Absent means the player. Present means this player's summon template. */
  summonTemplateId?: string;
  operator: 'add' | 'subtract' | 'set';
  value: number;
}

export function validPersistentGrowthTarget(stat: unknown, summon: unknown): boolean {
  return summon === undefined ? ['max_hp', 'max_lust'].includes(String(stat))
    : typeof summon === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(summon) && ['max_hp', 'damage', 'lust'].includes(String(stat));
}

export function readSummonGrowth(value: unknown): PersistentGrowthOperation[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(entry => !entry || !entry.summonTemplateId ||
    !validPersistentGrowthTarget(entry.stat, entry.summonTemplateId) ||
    !['add', 'subtract', 'set'].includes(entry.operator) || !Number.isFinite(entry.value))) {
    throw new Error('召唤物永久成长记录无效');
  }
  return structuredClone(value);
}

function growOutput(program: EffectProgram, entry: PersistentGrowthOperation): EffectProgram {
  const adjust = (old: NumericExpression): NumericExpression => entry.operator === 'set' ? Math.max(0, entry.value)
    : typeof old === 'number' ? Math.max(0, roundBattleValue(old + (entry.operator === 'add' ? entry.value : -entry.value)))
    : { op: 'clamp_min', minimum: 0, value: { op: entry.operator, left: old, right: entry.value } };
  const visit = (node: EffectNode): EffectNode => {
    if (node.op === 'if') return { ...node, then: node.then.map(visit), ...(node.else ? { else: node.else.map(visit) } : {}) };
    if (node.op === 'register_trigger' || node.op === 'schedule_effect') return { ...node, effects: node.effects.map(visit) };
    if (node.op === 'choose_one') return { ...node, options: node.options.map(option => ({ ...option, effects: option.effects.map(visit) })) };
    if (entry.stat === 'damage' && node.op === 'damage' || entry.stat === 'lust' && node.op === 'gain_lust') return { ...node, amount: adjust(node.amount) };
    return node;
  };
  return { ...program, steps: program.steps.map(visit) };
}

/** Apply the recorded template changes once when creating a fresh summon. */
export function growSummonDefinition(definition: SummonUnitDefinition, growth: readonly PersistentGrowthOperation[]): SummonUnitDefinition {
  let result = structuredClone(definition);
  for (const entry of growth) {
    if (entry.summonTemplateId !== definition.id) continue;
    if (entry.stat === 'max_hp') {
      if (result.hasHp === false) continue;
      const old = result.maxHp ?? 1;
      result.maxHp = Math.max(1, roundBattleValue(entry.operator === 'add' ? old + entry.value : entry.operator === 'subtract' ? old - entry.value : entry.value));
    } else if (entry.stat === 'damage' || entry.stat === 'lust') {
      if (result.actionProgram) result.actionProgram = growOutput(result.actionProgram, entry);
      result.actions = result.actions?.map(action => action.fixed ? action : { ...action, effectProgram: growOutput(action.effectProgram, entry) });
      result.abilities = result.abilities?.map(ability => ability.fixed ? ability : { ...ability, effectProgram: growOutput(ability.effectProgram, entry) });
    }
  }
  return result;
}
