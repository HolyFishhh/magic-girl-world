import type { Ability, Relic } from './battleState';
import type { CoreEffectState, EffectProgram } from './effectDsl';
import {
  MODIFIER_ATTRIBUTE_BY_STAT,
  resolveEffectProgramModifiers,
  type ModifierOperation,
} from './modifierMath';
import { normalizeAbilityTrigger } from './battleTriggers';

export type BattleEntityType = 'player' | 'enemy';
export type PassiveModifierSource = Pick<Ability | Relic, 'id' | 'name' | 'trigger' | 'effectProgram'>;

export interface ResolvedPassiveModifier {
  operation: ModifierOperation;
  source: PassiveModifierSource;
}

function targetType(ownerType: BattleEntityType, target: 'self' | 'opponent'): BattleEntityType {
  return target === 'self' ? ownerType : ownerType === 'player' ? 'enemy' : 'player';
}

function programOperations(
  programs: readonly EffectProgram[],
  ownerType: BattleEntityType,
  target: BattleEntityType,
  modifierType: string,
  state: CoreEffectState,
  statusStacks?: number,
): ModifierOperation[] {
  const result: ModifierOperation[] = [];
  for (const program of programs) {
    for (const resolved of resolveEffectProgramModifiers(program, state, {
      spentEnergy: 0,
      ...(statusStacks === undefined ? {} : { statusStacks }),
    })) {
      if (MODIFIER_ATTRIBUTE_BY_STAT[resolved.stat] !== modifierType) continue;
      if (targetType(ownerType, resolved.target) === target) result.push(resolved.operation);
    }
  }
  return result;
}

/** Resolve passive ability/relic modifiers from the only supported program format. */
export function resolvePassiveModifierOperations(
  sources: readonly PassiveModifierSource[] | undefined,
  ownerType: BattleEntityType,
  target: BattleEntityType,
  modifierType: string,
  state: CoreEffectState,
): ResolvedPassiveModifier[] {
  const result: ResolvedPassiveModifier[] = [];
  for (const source of sources || []) {
    if (normalizeAbilityTrigger(source.trigger || '') !== 'passive') continue;
    result.push(
      ...programOperations([source.effectProgram], ownerType, target, modifierType, state).map(operation => ({
        operation,
        source,
      })),
    );
  }
  return result;
}

/** Resolve a status hold declaration directly from its typed program. */
export function resolveStatusHoldModifierOperations(
  programs: readonly EffectProgram[] | undefined,
  holderType: BattleEntityType,
  target: BattleEntityType,
  modifierType: string,
  state: CoreEffectState,
  stacks: number,
): ModifierOperation[] {
  return programOperations(programs || [], holderType, target, modifierType, state, stacks);
}
