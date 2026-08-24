import type { CardSelector, RecoverCardZone } from './effectDsl';
import {
  moveCardsBetweenZones,
  shuffleCards,
  type CardPileZone,
  type CardZoneCard,
  type CardZoneState,
} from './cardZoneReducer';

export type CardZoneOperationRequest =
  | { type: 'scry_cards'; amount: number }
  | { type: 'discard_cards' | 'exhaust_cards'; selector: CardSelector; amount: number }
  | { type: 'recover_cards'; source: RecoverCardZone; pick: 'random' | 'choose' | 'all'; amount: number };

export type CardZoneOperationFailureCode =
  | 'DUPLICATE_CARD_ID'
  | 'RANDOM_SOURCE_REQUIRED'
  | 'STALE_PLAN'
  | 'INVALID_SELECTION';

export interface CardZoneOperationFailure {
  ok: false;
  code: CardZoneOperationFailureCode;
}

export type CardZoneOperationSelection =
  | { kind: 'interactive'; minimum: number; maximum: number }
  | { kind: 'automatic'; cardIds: string[] };

export interface CardZoneOperationPlan {
  ok: true;
  request: CardZoneOperationRequest;
  sources: CardPileZone[];
  destination: CardPileZone;
  candidateCardIds: string[];
  selection: CardZoneOperationSelection;
  snapshot: Record<CardPileZone, string[]>;
  destinationLimit: number;
}

export interface CommittedCardZoneOperation<TCard extends CardZoneCard> {
  ok: true;
  request: CardZoneOperationRequest;
  zones: CardZoneState<TCard>;
  moved: TCard[];
  selectedCardIds: string[];
}

export type PlanCardZoneOperationResult = CardZoneOperationPlan | CardZoneOperationFailure;
export type CommitCardZoneOperationResult<TCard extends CardZoneCard> =
  | CommittedCardZoneOperation<TCard>
  | CardZoneOperationFailure;

const ALL_ZONES: readonly CardPileZone[] = ['hand', 'drawPile', 'discardPile', 'exhaustPile'];

function isFailure(value: CardZoneOperationSelection | CardZoneOperationFailure): value is CardZoneOperationFailure {
  return 'ok' in value && value.ok === false;
}

function zoneSnapshot<TCard extends CardZoneCard>(zones: CardZoneState<TCard>): Record<CardPileZone, string[]> {
  return {
    hand: zones.hand.map(card => card.id),
    drawPile: zones.drawPile.map(card => card.id),
    discardPile: zones.discardPile.map(card => card.id),
    exhaustPile: zones.exhaustPile.map(card => card.id),
  };
}

function hasDuplicateCardIds(snapshot: Record<CardPileZone, string[]>): boolean {
  const ids = ALL_ZONES.flatMap(zone => snapshot[zone]);
  return new Set(ids).size !== ids.length;
}

function snapshotsMatch(
  current: Record<CardPileZone, string[]>,
  planned: Record<CardPileZone, string[]>,
): boolean {
  return ALL_ZONES.every(
    zone => current[zone].length === planned[zone].length && current[zone].every((id, index) => id === planned[zone][index]),
  );
}

function normalizedCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function selectorSources(zone: CardSelector['zone']): CardPileZone[] {
  if (zone === 'hand') return ['hand'];
  if (zone === 'draw') return ['drawPile'];
  if (zone === 'discard') return ['discardPile'];
  return ['hand', 'drawPile', 'discardPile'];
}

function recoverSource(source: RecoverCardZone): CardPileZone {
  if (source === 'draw') return 'drawPile';
  if (source === 'discard') return 'discardPile';
  return 'exhaustPile';
}

function cardsFromSources<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  sources: readonly CardPileZone[],
  destination: CardPileZone,
): TCard[] {
  return sources.filter(source => source !== destination).flatMap(source => zones[source]);
}

function buildSelection(
  candidateCardIds: readonly string[],
  pick: CardSelector['pick'],
  amount: number,
  random?: () => number,
): CardZoneOperationSelection | CardZoneOperationFailure {
  const maximum = Math.min(candidateCardIds.length, normalizedCount(amount));
  if (maximum === 0) return { kind: 'automatic', cardIds: [] };
  if (pick === 'choose') return { kind: 'interactive', minimum: maximum, maximum };
  if (pick === 'all') return { kind: 'automatic', cardIds: candidateCardIds.slice(0, maximum) };
  if (pick === 'random') {
    if (!random) return { ok: false, code: 'RANDOM_SOURCE_REQUIRED' };
    return { kind: 'automatic', cardIds: shuffleCards(candidateCardIds, random).slice(0, maximum) };
  }
  if (pick === 'right') return { kind: 'automatic', cardIds: candidateCardIds.slice(-maximum) };
  return { kind: 'automatic', cardIds: candidateCardIds.slice(0, maximum) };
}

/** Build stable candidates and selection limits before a host opens any UI. */
export function planCardZoneOperation<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  request: CardZoneOperationRequest,
  options: { handLimit?: number; random?: () => number; excludeCardIds?: ReadonlySet<string> } = {},
): PlanCardZoneOperationResult {
  const snapshot = zoneSnapshot(zones);
  if (hasDuplicateCardIds(snapshot)) return { ok: false, code: 'DUPLICATE_CARD_ID' };

  let sources: CardPileZone[];
  let destination: CardPileZone;
  let candidateCardIds: string[];
  let selection: CardZoneOperationSelection | CardZoneOperationFailure;
  let destinationLimit = Number.POSITIVE_INFINITY;

  if (request.type === 'scry_cards') {
    sources = ['drawPile'];
    destination = 'discardPile';
    const inspected = zones.drawPile.slice(-normalizedCount(request.amount)).reverse();
    candidateCardIds = inspected.map(card => card.id);
    selection =
      candidateCardIds.length === 0
        ? { kind: 'automatic', cardIds: [] }
        : { kind: 'interactive', minimum: 0, maximum: candidateCardIds.length };
  } else if (request.type === 'recover_cards') {
    sources = [recoverSource(request.source)];
    destination = 'hand';
    const handLimit = Number.isFinite(options.handLimit)
      ? Math.max(0, Math.floor(options.handLimit as number))
      : 10;
    destinationLimit = handLimit;
    const availableSlots = Math.max(0, handLimit - zones.hand.length);
    candidateCardIds = cardsFromSources(zones, sources, destination)
      .map(card => card.id)
      .filter(id => !options.excludeCardIds?.has(id));
    const requested = request.pick === 'all' ? availableSlots : Math.min(normalizedCount(request.amount), availableSlots);
    selection = buildSelection(candidateCardIds, request.pick, requested, options.random);
  } else {
    destination = request.type === 'discard_cards' ? 'discardPile' : 'exhaustPile';
    sources = selectorSources(request.selector.zone);
    candidateCardIds = cardsFromSources(zones, sources, destination)
      .map(card => card.id)
      .filter(id => !options.excludeCardIds?.has(id));
    const requested = request.selector.pick === 'all' ? candidateCardIds.length : (request.selector.count ?? request.amount);
    selection = buildSelection(candidateCardIds, request.selector.pick, requested, options.random);
  }

  if (isFailure(selection)) return selection;
  return {
    ok: true,
    request,
    sources,
    destination,
    candidateCardIds,
    selection,
    snapshot,
    destinationLimit,
  };
}

/** Validate a host response against the plan and commit the whole zone move immutably. */
export function commitCardZoneOperation<TCard extends CardZoneCard>(
  zones: CardZoneState<TCard>,
  plan: CardZoneOperationPlan,
  selectedCardIds?: readonly string[],
): CommitCardZoneOperationResult<TCard> {
  if (!snapshotsMatch(zoneSnapshot(zones), plan.snapshot)) return { ok: false, code: 'STALE_PLAN' };
  const effectiveSelectedCardIds =
    selectedCardIds ?? (plan.selection.kind === 'automatic' ? plan.selection.cardIds : []);
  if (new Set(effectiveSelectedCardIds).size !== effectiveSelectedCardIds.length)
    return { ok: false, code: 'INVALID_SELECTION' };

  const candidateSet = new Set(plan.candidateCardIds);
  if (effectiveSelectedCardIds.some(id => !candidateSet.has(id))) return { ok: false, code: 'INVALID_SELECTION' };
  if (plan.selection.kind === 'automatic') {
    const automaticCardIds = plan.selection.cardIds;
    if (
      effectiveSelectedCardIds.length !== automaticCardIds.length ||
      effectiveSelectedCardIds.some((id, index) => id !== automaticCardIds[index])
    ) {
      return { ok: false, code: 'INVALID_SELECTION' };
    }
  } else if (
    effectiveSelectedCardIds.length < plan.selection.minimum ||
    effectiveSelectedCardIds.length > plan.selection.maximum
  ) {
    return { ok: false, code: 'INVALID_SELECTION' };
  }

  const selected = new Set(effectiveSelectedCardIds);
  const orderedIds = plan.candidateCardIds.filter(id => selected.has(id));
  const committed = moveCardsBetweenZones(
    zones,
    orderedIds,
    plan.sources,
    plan.destination,
    plan.destinationLimit,
  );
  if (committed.moved.length !== orderedIds.length) return { ok: false, code: 'STALE_PLAN' };

  return {
    ok: true,
    request: plan.request,
    zones: committed.zones,
    moved: committed.moved,
    selectedCardIds: orderedIds,
  };
}
