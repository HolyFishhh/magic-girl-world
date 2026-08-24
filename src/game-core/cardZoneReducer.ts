export interface CardZoneCard {
  id: string;
}

export type CardPileZone = 'hand' | 'drawPile' | 'discardPile' | 'exhaustPile';

export interface CardZoneState<TCard extends CardZoneCard> {
  hand: TCard[];
  drawPile: TCard[];
  discardPile: TCard[];
  exhaustPile: TCard[];
}

export interface RemoveCardResult<TCard extends CardZoneCard> {
  zones: CardZoneState<TCard>;
  card: TCard | null;
}

export interface DrawCardsResult<TCard extends CardZoneCard> {
  zones: CardZoneState<TCard>;
  drawn: TCard[];
  recycledDiscard: boolean;
}

export type CardDrawLifecycleEvent<TCard extends CardZoneCard> =
  | { type: 'shuffle'; recycledCards: number }
  | { type: 'draw'; card: TCard }
  | { type: 'stopped'; reason: 'hand_limit' | 'empty' };

export interface CardDrawLifecycleResult<TCard extends CardZoneCard> {
  zones: CardZoneState<TCard>;
  event: CardDrawLifecycleEvent<TCard>;
}

export interface MoveCardsResult<TCard extends CardZoneCard> {
  zones: CardZoneState<TCard>;
  moved: TCard[];
}

export interface UpdateCardsResult<TCard extends CardZoneCard> {
  zones: CardZoneState<TCard>;
  updated: TCard[];
}

export interface ScryCardsResult<TCard extends CardZoneCard> {
  zones: CardZoneState<TCard>;
  inspected: TCard[];
  discarded: TCard[];
}

function cloneZones<TCard extends CardZoneCard>(zones: CardZoneState<TCard>): CardZoneState<TCard> {
  return {
    hand: [...zones.hand],
    drawPile: [...zones.drawPile],
    discardPile: [...zones.discardPile],
    exhaustPile: [...zones.exhaustPile],
  };
}

/** Fisher-Yates with an explicit random source so hosts and tests control nondeterminism. */
export function shuffleCards<T>(cards: readonly T[], random: () => number): T[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const sample = random();
    const normalized = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON) : 0;
    const swapIndex = Math.floor(normalized * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function removeCardFromZone<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  zone: CardPileZone,
  cardId: string,
): RemoveCardResult<TCard> {
  const index = zones[zone].findIndex(card => card.id === cardId);
  if (index < 0) return { zones, card: null };

  const next = cloneZones(zones);
  const [card] = next[zone].splice(index, 1);
  return { zones: next, card };
}

export function appendCardToZone<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  zone: CardPileZone,
  card: TCard,
): CardZoneState<TCard> {
  const next = cloneZones(zones);
  next[zone].push({ ...card });
  return next;
}

export function insertCardIntoZone<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  zone: CardPileZone,
  card: TCard,
  index: number,
): CardZoneState<TCard> {
  const next = cloneZones(zones);
  const safeIndex = Math.min(next[zone].length, Math.max(0, Math.floor(index)));
  next[zone].splice(safeIndex, 0, { ...card });
  return next;
}

export function moveCardsBetweenZones<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  cardIds: readonly string[],
  sources: readonly CardPileZone[],
  destination: CardPileZone,
  destinationLimit = Number.POSITIVE_INFINITY,
): MoveCardsResult<TCard> {
  const next = cloneZones(zones);
  const moved: TCard[] = [];

  for (const cardId of cardIds) {
    if (next[destination].length >= destinationLimit) break;
    for (const source of sources) {
      if (source === destination) continue;
      const index = next[source].findIndex(card => card.id === cardId);
      if (index < 0) continue;
      const [card] = next[source].splice(index, 1);
      const stored = { ...card };
      next[destination].push(stored);
      moved.push(stored);
      break;
    }
  }

  return { zones: next, moved };
}

/** Inspect the next cards to be drawn and move only selected inspected cards to discard. */
export function scryCardsFromDraw<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  amount: number,
  selectedCardIds: readonly string[],
): ScryCardsResult<TCard> {
  const count = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  const inspected = zones.drawPile.slice(-count).reverse();
  const allowedIds = new Set(inspected.map(card => card.id));
  const selected = new Set(selectedCardIds.filter(id => allowedIds.has(id)));
  const orderedIds = inspected.filter(card => selected.has(card.id)).map(card => card.id);
  const moved = moveCardsBetweenZones(zones, orderedIds, ['drawPile'], 'discardPile');
  return { zones: moved.zones, inspected: inspected.map(card => ({ ...card })), discarded: moved.moved };
}

export function updateCardsInZones<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  cardIds: readonly string[],
  sources: readonly CardPileZone[],
  update: (card: TCard) => TCard,
): UpdateCardsResult<TCard> {
  const next = cloneZones(zones);
  const remaining = new Set(cardIds);
  const updated: TCard[] = [];

  for (const source of sources) {
    next[source] = next[source].map(card => {
      if (!remaining.has(card.id)) return card;
      remaining.delete(card.id);
      const replacement = { ...update({ ...card }) };
      updated.push(replacement);
      return replacement;
    });
  }

  return { zones: next, updated };
}

export function recycleDiscardIntoDraw<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  shuffle: (cards: readonly TCard[]) => TCard[],
): { zones: CardZoneState<TCard>; recycled: boolean } {
  if (zones.discardPile.length === 0) return { zones, recycled: false };
  const next = cloneZones(zones);
  next.drawPile.push(...shuffle(next.discardPile));
  next.discardPile = [];
  return { zones: next, recycled: true };
}

export function drawCardsFromZones<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  amount: number,
  shuffle: (cards: readonly TCard[]) => TCard[],
  handLimit = 10,
): DrawCardsResult<TCard> {
  let next = cloneZones(zones);
  const drawn: TCard[] = [];
  let recycledDiscard = false;
  const drawCount = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  const limit = Number.isFinite(handLimit) ? Math.max(0, Math.floor(handLimit)) : 10;

  for (let index = 0; index < drawCount; index++) {
    if (next.hand.length >= limit) break;
    if (next.drawPile.length === 0) {
      const recycled = recycleDiscardIntoDraw(next, shuffle);
      next = recycled.zones;
      recycledDiscard ||= recycled.recycled;
    }
    if (next.drawPile.length === 0) break;

    const card = next.drawPile.pop();
    if (!card) break;
    next.hand.push(card);
    drawn.push(card);
  }

  return { zones: next, drawn, recycledDiscard };
}

/**
 * Advance exactly one observable draw-lifecycle step. Returning shuffle as a
 * separate step lets hosts resolve its triggers before the recycled card is drawn.
 */
export function advanceCardDrawLifecycle<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  shuffle: (cards: readonly TCard[]) => TCard[],
  handLimit = 10,
): CardDrawLifecycleResult<TCard> {
  const limit = Number.isFinite(handLimit) ? Math.max(0, Math.floor(handLimit)) : 10;
  if (zones.hand.length >= limit) return { zones, event: { type: 'stopped', reason: 'hand_limit' } };

  if (zones.drawPile.length === 0) {
    if (zones.discardPile.length === 0) return { zones, event: { type: 'stopped', reason: 'empty' } };
    const recycledCards = zones.discardPile.length;
    const recycled = recycleDiscardIntoDraw(zones, shuffle);
    return { zones: recycled.zones, event: { type: 'shuffle', recycledCards } };
  }

  const result = drawCardsFromZones(zones, 1, shuffle, limit);
  const card = result.drawn[0];
  return card
    ? { zones: result.zones, event: { type: 'draw', card } }
    : { zones, event: { type: 'stopped', reason: 'empty' } };
}
