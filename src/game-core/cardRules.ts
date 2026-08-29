import { resolveCardResourcePayment, type CardCost, type CardResourcePayment } from './combatResource';

export interface CardRuleCard {
  id: string;
  name: string;
  cost?: CardCost;
  type: string;
  effectProgram: unknown;
  originalId?: string;
  templateId?: string;
  runInstanceId?: string;
  combatInstanceId?: string;
  retain?: boolean;
  exhaust?: boolean;
  ethereal?: boolean;
  innate?: boolean;
  /** Added after paying an X-cost card; does not consume extra energy. */
  xValueBonus?: number;
}

export interface CardEnergyPayment {
  requiredEnergy: number;
  spentEnergy: number;
  /** Value used by X formulas; equals spent energy for ordinary X cards. */
  xValue: number;
}

export type PlayedCardDestination = 'discard' | 'exhaust' | 'draw_top' | 'draw_bottom' | 'hand' | 'remove';

export interface TurnEndHandDisposition<TCard extends CardRuleCard> {
  exhaust: TCard[];
  discard: TCard[];
  keep: TCard[];
}

export interface StartingHandResult<TCard extends CardRuleCard> {
  hand: TCard[];
  drawPile: TCard[];
}

/** Put innate cards in the opening hand, then fill the normal draw count from the shuffled deck. */
export function resolveStartingHand<TCard extends CardRuleCard>(
  cards: readonly TCard[],
  drawPerTurn: number,
  shuffle: (cards: readonly TCard[]) => TCard[],
  handLimit = 10,
): StartingHandResult<TCard> {
  const limit = Number.isFinite(handLimit) ? Math.max(0, Math.floor(handLimit)) : 10;
  const normalDraw = Number.isFinite(drawPerTurn) ? Math.max(0, Math.floor(drawPerTurn)) : 0;
  const innate = shuffle(cards.filter(card => card.innate === true));
  const regular = shuffle(cards.filter(card => card.innate !== true));
  const hand = innate.slice(0, limit);
  const overflowInnate = innate.slice(limit);
  const targetSize = Math.min(limit, Math.max(normalDraw, hand.length));

  while (hand.length < targetSize && regular.length > 0) {
    const card = regular.pop();
    if (card) hand.push(card);
  }

  return {
    hand,
    // drawCardsFromZones pops from the end, so innate overflow remains on top.
    drawPile: [...regular, ...overflowInnate],
  };
}

/** Resolve affordability and the immutable payment context for one card play. */
export function resolveCardEnergyPayment(
  card: Pick<CardRuleCard, 'cost' | 'xValueBonus'>,
  availableEnergy: number,
): CardEnergyPayment {
  const payment = resolveCardResourcePayment(
    card.cost,
    { energy: Number.isFinite(availableEnergy) ? Math.max(0, availableEnergy) : 0 },
    undefined,
    card.xValueBonus,
  );
  return { requiredEnergy: payment.requiredEnergy, spentEnergy: payment.spentEnergy, xValue: payment.xValue };
}

export type { CardResourcePayment };

/** Power cards are one-shot ability registrations even if generated content omits exhaust. */
export function resolvePlayedCardDestination(
  card: Pick<CardRuleCard, 'type' | 'exhaust'>,
): PlayedCardDestination {
  return card.type === 'Power' || card.exhaust ? 'exhaust' : 'discard';
}

/** Freeze the curses that were present when turn-end card processing began. */
export function selectTurnEndCurseTriggers<TCard extends CardRuleCard>(hand: readonly TCard[]): TCard[] {
  return hand.filter(card => card.type === 'Curse' && Boolean(card.effectProgram));
}

/** Partition the current hand after curse effects have finished mutating it. */
export function resolveTurnEndHandDisposition<TCard extends CardRuleCard>(
  hand: readonly TCard[],
  retainAll = false,
): TurnEndHandDisposition<TCard> {
  const exhaust: TCard[] = [];
  const discard: TCard[] = [];
  const keep: TCard[] = [];

  for (const card of hand) {
    if (card.ethereal) exhaust.push(card);
    else if (retainAll || card.retain || card.type === 'Curse') keep.push(card);
    else discard.push(card);
  }

  return { exhaust, discard, keep };
}

export function getCardSourceId(card: Pick<CardRuleCard, 'id' | 'name' | 'originalId' | 'templateId'>): string {
  return card.templateId || card.originalId || card.id || card.name;
}

/** Count cards owned across persistent piles plus cards temporarily in a play transaction. */
export function countCardOwnership(
  cards: ReadonlyArray<Pick<CardRuleCard, 'id' | 'name' | 'originalId' | 'templateId'>>,
  inFlightCounts: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = getCardSourceId(card);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of inFlightCounts) {
    if (key && count > 0) counts.set(key, (counts.get(key) || 0) + count);
  }
  return counts;
}
