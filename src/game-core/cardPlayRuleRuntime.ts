import type { Ability, Relic } from './battleState';
import { normalizeAbilityTrigger } from './battleTriggers';
import {
  executeEffectProgram,
  type CoreEffectEvent,
  type CoreEffectState,
  type EffectProgram,
} from './effectDsl';
import { cardMatchesSelectorFilter, type SelectableCard } from './cardSelectorRuntime';
import type { PlayedCardDestination } from './cardRules';
import type { CardResourceWaiver } from './combatResource';

export type CardPlayRuleEvent = Extract<CoreEffectEvent, { type: 'card_play_rule' }>;
export type CardPlayRuleSource = Pick<Ability | Relic, 'id' | 'name' | 'trigger' | 'effectProgram'>;

export interface ResolvedCardPlayRule {
  rule: CardPlayRuleEvent;
  source?: CardPlayRuleSource;
}

export interface ActiveCardPlayRules {
  free: boolean;
  freeResources?: CardResourceWaiver;
  extraReplays: number;
  retainHand: boolean;
  retainBlock: boolean;
  drawLimit?: number;
  blockGainLimit?: number;
  energyGainLimit?: number;
  denied: boolean;
  explicitlyAllowed: boolean;
  playLimitReached: boolean;
  destination?: PlayedCardDestination;
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
  card?: SelectableCard,
  playedCardsThisTurn: readonly SelectableCard[] = [],
): ActiveCardPlayRules {
  const played = Number.isFinite(cardsPlayedThisTurn) ? Math.max(0, Math.trunc(cardsPlayedThisTurn)) : 0;
  let free = false;
  let freeResources: CardResourceWaiver;
  let waiveAllResources = false;
  let extraReplays = 0;
  let retainHand = false;
  let retainBlock = false;
  let drawLimit: number | undefined;
  let blockGainLimit: number | undefined;
  let energyGainLimit: number | undefined;
  let denied = false;
  let explicitlyAllowed = false;
  let playLimitReached = false;
  let destination: PlayedCardDestination | undefined;
  let destinationPriority = Number.NEGATIVE_INFINITY;
  const numericLimit = (rule: CardPlayRuleEvent): number | undefined =>
    rule.limit === undefined || rule.limit === 'all' ? undefined : Math.max(0, Math.trunc(rule.limit));
  const tighten = (current: number | undefined, next: number | undefined): number | undefined =>
    next === undefined ? current : current === undefined ? next : Math.min(current, next);
  const matches = (rule: CardPlayRuleEvent, candidate: SelectableCard | undefined): boolean =>
    Boolean(candidate) && (!rule.selector || cardMatchesSelectorFilter(candidate as SelectableCard, rule.selector.filter));
  for (const rule of rules) {
    if (rule.rule === 'retain_hand') { retainHand = true; continue; }
    if (rule.rule === 'retain_block') { retainBlock = true; continue; }
    if (rule.rule === 'limit_draw') { drawLimit = tighten(drawLimit, numericLimit(rule)); continue; }
    if (rule.rule === 'limit_block_gain') { blockGainLimit = tighten(blockGainLimit, numericLimit(rule)); continue; }
    if (rule.rule === 'limit_energy_gain') { energyGainLimit = tighten(energyGainLimit, numericLimit(rule)); continue; }
    if (rule.rule === 'deny_card_play' && matches(rule, card)) { denied = true; continue; }
    if (rule.rule === 'allow_card_play' && matches(rule, card)) { explicitlyAllowed = true; continue; }
    if (rule.rule === 'limit_card_play' && matches(rule, card)) {
      const cap = numericLimit(rule);
      const matchingPlays = playedCardsThisTurn.filter(entry => matches(rule, entry)).length;
      if (cap !== undefined && matchingPlays >= cap) playLimitReached = true;
      continue;
    }
    if (rule.rule === 'card_destination' && matches(rule, card) && rule.destination && rule.priority >= destinationPriority) {
      destination = rule.destination;
      destinationPriority = rule.priority;
      continue;
    }
    if (rule.rule !== 'free' && rule.rule !== 'replay') continue;
    if (rule.selector && !matches(rule, card)) continue;
    if (rule.limit !== 'all' && (rule.limit === undefined || played >= rule.limit)) continue;
    if (rule.rule === 'free') {
      free = true;
      if (rule.freeResources === 'all' || rule.freeResources === undefined) waiveAllResources = true;
      else if (!waiveAllResources) {
        freeResources = [...new Set([...(freeResources || []), ...rule.freeResources])];
      }
    }
    else extraReplays += rule.extra;
  }
  return {
    free,
    ...(free && !waiveAllResources && freeResources ? { freeResources } : {}),
    extraReplays: Math.min(20, Math.max(0, Math.trunc(extraReplays))),
    retainHand,
    retainBlock,
    ...(drawLimit !== undefined ? { drawLimit } : {}),
    ...(blockGainLimit !== undefined ? { blockGainLimit } : {}),
    ...(energyGainLimit !== undefined ? { energyGainLimit } : {}),
    denied,
    explicitlyAllowed,
    playLimitReached,
    ...(destination ? { destination } : {}),
  };
}
