import type { Ability, Relic } from './battleState';
import type { CoreEffectState, EffectProgram } from './effectDsl';
import { type ModifierOperation } from './modifierMath';
export type BattleEntityType = 'player' | 'enemy';
export type PassiveModifierSource = Pick<Ability | Relic, 'id' | 'name' | 'trigger' | 'effectProgram'>;
export interface ResolvedPassiveModifier {
    operation: ModifierOperation;
    source: PassiveModifierSource;
}
/** Resolve passive ability/relic modifiers from the only supported program format. */
export declare function resolvePassiveModifierOperations(sources: readonly PassiveModifierSource[] | undefined, ownerType: BattleEntityType, target: BattleEntityType, modifierType: string, state: CoreEffectState): ResolvedPassiveModifier[];
/** Resolve a status hold declaration directly from its typed program. */
export declare function resolveStatusHoldModifierOperations(programs: readonly EffectProgram[] | undefined, holderType: BattleEntityType, target: BattleEntityType, modifierType: string, state: CoreEffectState, stacks: number): ModifierOperation[];
