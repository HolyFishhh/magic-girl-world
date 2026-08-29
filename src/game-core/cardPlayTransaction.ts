import { resolvePlayedCardDestination, type CardRuleCard, type PlayedCardDestination } from './cardRules';
import { resolveActiveCardPlayRules, type CardPlayRuleEvent } from './cardPlayRuleRuntime';
import { resolveDynamicCardCostAtPlay, type DynamicCardCostRule } from './dynamicCardCost';
import type { CoreEffectState, EffectExecutionContext } from './effectDsl';
import type { SelectableCard } from './cardSelectorRuntime';
import { resolveCardAttachmentPlayAccess, type CardAttachment } from './cardAttachment';
import {
  applyCardResourcePayment,
  resolveCardResourcePayment,
  type CardResourcePayment,
  type CardCost,
  type CombatResourcePool,
} from './combatResource';

export interface CardPlayCard extends CardRuleCard {
  doubleEffect?: boolean;
  replayCount?: number;
  attachments?: CardAttachment[];
}

export interface CardPlayState<TCard extends CardPlayCard> {
  phase: string;
  hasOpponent: boolean;
  hand: readonly TCard[];
  energy: number;
  /** Custom/current resource amounts; energy is always read from the dedicated compatibility field. */
  resources?: CombatResourcePool;
  cardsPlayedThisTurn: number;
  cardRuleUsesThisTurn?: number;
  attacksPlayedThisTurn?: number;
  skillsPlayedThisTurn?: number;
  stunned?: boolean;
  statusIds?: Iterable<string>;
  cardPlayRules?: readonly CardPlayRuleEvent[];
  playedCardsThisTurn?: readonly SelectableCard[];
  dynamicCostRules?: readonly DynamicCardCostRule[];
  dynamicCostState?: CoreEffectState;
  dynamicCostContext?: EffectExecutionContext;
}

export type CardPlayFailureCode =
  | 'NO_OPPONENT'
  | 'WRONG_PHASE'
  | 'CARD_NOT_FOUND'
  | 'CURSE_UNPLAYABLE'
  | 'STUNNED'
  | 'DOMINATED_ATTACK'
  | 'SILENCED_SKILL'
  | 'RULE_DENIED'
  | 'RULE_LIMIT_REACHED'
  | 'INSUFFICIENT_ENERGY'
  | 'INSUFFICIENT_RESOURCE';

export interface CardPlayFailure {
  ok: false;
  code: CardPlayFailureCode;
  requiredEnergy?: number;
  availableEnergy?: number;
  resource?: string;
  requiredResource?: number;
  availableResource?: number;
  /** Cost preview metadata is retained for read-only UI even when payment cannot commit. */
  effectiveCost?: CardCost;
  payment?: CardResourcePayment;
}

export interface PreparedCardPlay<TCard extends CardPlayCard> {
  ok: true;
  card: TCard;
  payment: CardResourcePayment;
  destination: PlayedCardDestination;
  repeatCount: number;
}

export interface CommittedCardPlay<TCard extends CardPlayCard> extends PreparedCardPlay<TCard> {
  hand: TCard[];
  energy: number;
  resources: Record<string, number>;
  cardsPlayedThisTurn: number;
  cardRuleUsesThisTurn: number;
  attacksPlayedThisTurn: number;
  skillsPlayedThisTurn: number;
}

export type PrepareCardPlayResult<TCard extends CardPlayCard> = PreparedCardPlay<TCard> | CardPlayFailure;
export type CommitCardPlayResult<TCard extends CardPlayCard> = CommittedCardPlay<TCard> | CardPlayFailure;

function statusSet(values?: Iterable<string>): Set<string> {
  return new Set(values || []);
}

function normalizedCounter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function inspectCardPlay<TCard extends CardPlayCard>(
  cardId: string,
  state: CardPlayState<TCard>,
): PreparedCardPlay<TCard> | CardPlayFailure {
  if (!state.hasOpponent) return { ok: false, code: 'NO_OPPONENT' };
  if (state.phase !== 'player_turn') return { ok: false, code: 'WRONG_PHASE' };
  const card = state.hand.find(entry => entry.id === cardId);
  if (!card) return { ok: false, code: 'CARD_NOT_FOUND' };
  if (state.stunned) return { ok: false, code: 'STUNNED' };
  const activeRules = resolveActiveCardPlayRules(
    state.cardPlayRules || [],
    state.cardRuleUsesThisTurn ?? state.cardsPlayedThisTurn,
    card,
    state.playedCardsThisTurn || [],
  );
  const attachmentAccess = resolveCardAttachmentPlayAccess(card);
  if (activeRules.denied || (attachmentAccess.denied && !attachmentAccess.explicitlyAllowed)) {
    return { ok: false, code: 'RULE_DENIED' };
  }
  if (activeRules.playLimitReached) return { ok: false, code: 'RULE_LIMIT_REACHED' };
  const explicitlyAllowed = activeRules.explicitlyAllowed || attachmentAccess.explicitlyAllowed;
  if (card.type === 'Curse' && !explicitlyAllowed) return { ok: false, code: 'CURSE_UNPLAYABLE' };
  const statuses = statusSet(state.statusIds);
  if (!explicitlyAllowed && card.type === 'Attack' && statuses.has('dominated')) return { ok: false, code: 'DOMINATED_ATTACK' };
  if (!explicitlyAllowed && card.type === 'Skill' && statuses.has('silenced')) return { ok: false, code: 'SILENCED_SKILL' };
  const effectiveCost = state.dynamicCostState
    ? resolveDynamicCardCostAtPlay(card as CardPlayCard & any, state.dynamicCostRules || [], {
        state: state.dynamicCostState,
        effect: state.dynamicCostContext || { spentEnergy: 0 },
      })
    : card.cost;
  const effectiveCard = effectiveCost === card.cost ? card : ({ ...card, cost: effectiveCost } as TCard);
  const pool = { ...(state.resources || {}), energy: state.energy };
  const payment = resolveCardResourcePayment(
    effectiveCard.cost,
    pool,
    activeRules.free ? activeRules.freeResources || 'all' : undefined,
    effectiveCard.xValueBonus,
  );
  if (!payment.affordable) {
    const shortage = payment.shortage!;
    if (shortage.resource !== 'energy') {
      return {
        ok: false,
        code: 'INSUFFICIENT_RESOURCE',
        resource: shortage.resource,
        requiredResource: shortage.required,
        availableResource: shortage.available,
        effectiveCost: effectiveCard.cost,
        payment,
      };
    }
    return {
      ok: false,
      code: 'INSUFFICIENT_ENERGY',
      requiredEnergy: shortage.required,
      availableEnergy: state.energy,
      effectiveCost: effectiveCard.cost,
      payment,
    };
  }
  return {
    ok: true,
    card: effectiveCard,
    payment,
    destination: activeRules.destination || resolvePlayedCardDestination(effectiveCard),
    repeatCount: 1 + Math.min(20, normalizedCounter(effectiveCard.replayCount ?? (effectiveCard.doubleEffect ? 1 : 0))) + activeRules.extraReplays,
  };
}

/** Validate a play before any selection UI or state mutation begins. */
export function prepareCardPlay<TCard extends CardPlayCard>(
  cardId: string,
  state: CardPlayState<TCard>,
): PrepareCardPlayResult<TCard> {
  return inspectCardPlay(cardId, state);
}

/** Commit from the latest state so animation or host work cannot overwrite newer values. */
export function commitCardPlay<TCard extends CardPlayCard>(
  prepared: PreparedCardPlay<TCard>,
  latest: CardPlayState<TCard>,
): CommitCardPlayResult<TCard> {
  const cardId = prepared.card.id;
  const inspected = inspectCardPlay(cardId, latest);
  if (!inspected.ok) return inspected;
  const remainingResources = applyCardResourcePayment(
    { ...(latest.resources || {}), energy: latest.energy },
    inspected.payment,
  );
  return {
    ...inspected,
    hand: latest.hand.filter(card => card.id !== cardId),
    energy: remainingResources.energy || 0,
    resources: Object.fromEntries(Object.entries(remainingResources).filter(([id]) => id !== 'energy')),
    cardsPlayedThisTurn: normalizedCounter(latest.cardsPlayedThisTurn) + 1,
    cardRuleUsesThisTurn: normalizedCounter(latest.cardRuleUsesThisTurn ?? latest.cardsPlayedThisTurn) + 1,
    attacksPlayedThisTurn: normalizedCounter(latest.attacksPlayedThisTurn) + (inspected.card.type === 'Attack' ? 1 : 0),
    skillsPlayedThisTurn: normalizedCounter(latest.skillsPlayedThisTurn) + (inspected.card.type === 'Skill' ? 1 : 0),
  };
}
