import { resolveCardEnergyPayment, resolvePlayedCardDestination, type CardEnergyPayment, type CardRuleCard, type PlayedCardDestination } from './cardRules';

export interface CardPlayCard extends CardRuleCard {
  doubleEffect?: boolean;
}

export interface CardPlayState<TCard extends CardPlayCard> {
  phase: string;
  hasOpponent: boolean;
  hand: readonly TCard[];
  energy: number;
  cardsPlayedThisTurn: number;
  attacksPlayedThisTurn?: number;
  skillsPlayedThisTurn?: number;
  stunned?: boolean;
  statusIds?: Iterable<string>;
}

export type CardPlayFailureCode =
  | 'NO_OPPONENT'
  | 'WRONG_PHASE'
  | 'CARD_NOT_FOUND'
  | 'CURSE_UNPLAYABLE'
  | 'STUNNED'
  | 'DOMINATED_ATTACK'
  | 'SILENCED_SKILL'
  | 'INSUFFICIENT_ENERGY';

export interface CardPlayFailure {
  ok: false;
  code: CardPlayFailureCode;
  requiredEnergy?: number;
  availableEnergy?: number;
}

export interface PreparedCardPlay<TCard extends CardPlayCard> {
  ok: true;
  card: TCard;
  payment: CardEnergyPayment;
  destination: PlayedCardDestination;
  repeatCount: 1 | 2;
}

export interface CommittedCardPlay<TCard extends CardPlayCard> extends PreparedCardPlay<TCard> {
  hand: TCard[];
  energy: number;
  cardsPlayedThisTurn: number;
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
  if (card.type === 'Curse') return { ok: false, code: 'CURSE_UNPLAYABLE' };
  if (state.stunned) return { ok: false, code: 'STUNNED' };
  const statuses = statusSet(state.statusIds);
  if (card.type === 'Attack' && statuses.has('dominated')) return { ok: false, code: 'DOMINATED_ATTACK' };
  if (card.type === 'Skill' && statuses.has('silenced')) return { ok: false, code: 'SILENCED_SKILL' };

  const payment = resolveCardEnergyPayment(card, state.energy);
  if (state.energy < payment.requiredEnergy) {
    return {
      ok: false,
      code: 'INSUFFICIENT_ENERGY',
      requiredEnergy: payment.requiredEnergy,
      availableEnergy: state.energy,
    };
  }
  return {
    ok: true,
    card,
    payment,
    destination: resolvePlayedCardDestination(card),
    repeatCount: card.doubleEffect ? 2 : 1,
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
  return {
    ...inspected,
    hand: latest.hand.filter(card => card.id !== cardId),
    energy: latest.energy - inspected.payment.spentEnergy,
    cardsPlayedThisTurn: normalizedCounter(latest.cardsPlayedThisTurn) + 1,
    attacksPlayedThisTurn: normalizedCounter(latest.attacksPlayedThisTurn) + (inspected.card.type === 'Attack' ? 1 : 0),
    skillsPlayedThisTurn: normalizedCounter(latest.skillsPlayedThisTurn) + (inspected.card.type === 'Skill' ? 1 : 0),
  };
}
