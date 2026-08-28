import type { Ability, Relic } from './battleState';
import { type CoreEffectEvent, type CoreEffectState, type EffectProgram } from './effectDsl';
export type CardPlayRuleEvent = Extract<CoreEffectEvent, {
    type: 'card_play_rule';
}>;
export type CardPlayRuleSource = Pick<Ability | Relic, 'id' | 'name' | 'trigger' | 'effectProgram'>;
export interface ResolvedCardPlayRule {
    rule: CardPlayRuleEvent;
    source?: CardPlayRuleSource;
}
export interface ActiveCardPlayRules {
    free: boolean;
    extraReplays: number;
}
export declare function resolvePassiveCardPlayRules(sources: readonly CardPlayRuleSource[] | undefined, ownerType: 'player' | 'enemy', target: 'player' | 'enemy', state: CoreEffectState): ResolvedCardPlayRule[];
export declare function resolveStatusHoldCardPlayRules(programs: readonly EffectProgram[] | undefined, holderType: 'player' | 'enemy', target: 'player' | 'enemy', state: CoreEffectState, stacks: number): CardPlayRuleEvent[];
/** Resolve the rule set before a play; per-turn limits use the pre-commit play counter. */
export declare function resolveActiveCardPlayRules(rules: readonly CardPlayRuleEvent[], cardsPlayedThisTurn: number): ActiveCardPlayRules;
