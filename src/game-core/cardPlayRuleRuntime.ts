import type { Ability, Relic } from './battleState';
import { normalizeAbilityTrigger } from './battleTriggers';
import {
  executeEffectProgram,
  type CoreEffectEvent,
  type CoreEffectState,
  type EffectProgram,
} from './effectDsl';

export type CardPlayRuleEvent = Extract<CoreEffectEvent, { type: 'card_play_rule' }>;
export type CardPlayRuleSource = Pick<Ability | Relic, 'id' | 'name' | 'trigger' | 'effectProgram'>;

export interface ResolvedCardPlayRule {
  rule: CardPlayRuleEvent;
  source?: CardPlayRuleSource;
}

export interface ActiveCardPlayRules {
  free: boolean;
  extraReplays: number;
}

function targetType(ownerType: 'player' | 'enemy', target: 'self' | 'opponent'): 'player' | 'enemy' {
  return target === 'self' ? ownerType : ownerType === 'player' ? 'enemy' : 'player';
}

function programRules(
  program: EffectProgram,
  ownerType: 'player' | 'enemy',
  target: 'player' | 'enemy',
  state: CoreEffectState,
  statusStacks?: number,
): CardPlayRuleEvent[] {
  const result = executeEffectProgram(program, state, {
    spentEnergy: 0,
    ...(statusStacks === undefined ? {} : { statusStacks }),
  });
  if (!result.ok) return [];
  return result.events.filter(
    (event): event is CardPlayRuleEvent =>
      event.type === 'card_play_rule' && targetType(ownerType, event.target) === target,
  );
}

export function resolvePassiveCardPlayRules(
  sources: readonly CardPlayRuleSource[] | undefined,
  ownerType: 'player' | 'enemy',
  target: 'player' | 'enemy',
  state: CoreEffectState,
): ResolvedCardPlayRule[] {
  const result: ResolvedCardPlayRule[] = [];
  for (const source of sources || []) {
    if (normalizeAbilityTrigger(source.trigger || '') !== 'passive') continue;
    result.push(...programRules(source.effectProgram, ownerType, target, state).map(rule => ({ rule, source })));
  }
  return result;
}

export function resolveStatusHoldCardPlayRules(
  programs: readonly EffectProgram[] | undefined,
  holderType: 'player' | 'enemy',
  target: 'player' | 'enemy',
  state: CoreEffectState,
  stacks: number,
): CardPlayRuleEvent[] {
  return (programs || []).flatMap(program => programRules(program, holderType, target, state, stacks));
}

/** Resolve the rule set before a play; per-turn limits use the pre-commit play counter. */
export function resolveActiveCardPlayRules(
  rules: readonly CardPlayRuleEvent[],
  cardsPlayedThisTurn: number,
): ActiveCardPlayRules {
  const played = Number.isFinite(cardsPlayedThisTurn) ? Math.max(0, Math.trunc(cardsPlayedThisTurn)) : 0;
  let free = false;
  let extraReplays = 0;
  for (const rule of rules) {
    if (rule.limit !== 'all' && played >= rule.limit) continue;
    if (rule.rule === 'free') free = true;
    else extraReplays += rule.extra;
  }
  return { free, extraReplays: Math.min(20, Math.max(0, Math.trunc(extraReplays))) };
}
