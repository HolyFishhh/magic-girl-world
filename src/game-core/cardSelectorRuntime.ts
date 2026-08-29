import type { CardSelector, CardSelectorFilter } from './effectDsl';
import type { CardOrigin } from './cardIdentity';
import type { CardCost } from './combatResource';
import type { CardPileZone, CardZoneCard, CardZoneState } from './cardZoneReducer';

export interface SelectableCard extends CardZoneCard {
  name?: string;
  type?: string;
  rarity?: string;
  cost?: CardCost;
  tags?: readonly string[];
  originalId?: string;
  templateId?: string;
  runInstanceId?: string;
  combatInstanceId?: string;
  origin?: CardOrigin;
  upgraded?: boolean;
  upgradeLevel?: number;
}

function sameCost(left: CardCost | undefined, right: CardCost | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

/** `all` intentionally preserves its legacy meaning and excludes the exhaust pile. */
export function selectorZones(zone: CardSelector['zone']): CardPileZone[] {
  if (zone === 'hand') return ['hand'];
  if (zone === 'draw') return ['drawPile'];
  if (zone === 'discard') return ['discardPile'];
  if (zone === 'exhaust') return ['exhaustPile'];
  if (zone === 'combat') return ['hand', 'drawPile', 'discardPile', 'exhaustPile'];
  return ['hand', 'drawPile', 'discardPile'];
}

export function cardMatchesSelectorFilter(card: SelectableCard, filter?: CardSelectorFilter): boolean {
  if (!filter) return true;
  if (filter.name !== undefined && card.name !== filter.name) return false;
  if (filter.types && !filter.types.includes(card.type as never)) return false;
  if (filter.rarities && !filter.rarities.includes(card.rarity as never)) return false;
  if (filter.cost !== undefined && !sameCost(card.cost, filter.cost)) return false;
  if (filter.minCost !== undefined && (typeof card.cost !== 'number' || card.cost < filter.minCost)) return false;
  if (filter.maxCost !== undefined && (typeof card.cost !== 'number' || card.cost > filter.maxCost)) return false;
  if (filter.tags && !filter.tags.every(tag => card.tags?.includes(tag))) return false;
  if (filter.templateId !== undefined && (card.templateId || card.originalId) !== filter.templateId) return false;
  if (filter.runInstanceId !== undefined && card.runInstanceId !== filter.runInstanceId) return false;
  if (filter.combatInstanceId !== undefined && (card.combatInstanceId || card.id) !== filter.combatInstanceId) return false;
  if (filter.origin !== undefined && card.origin !== filter.origin) return false;
  if (filter.rootOnly === true && card.origin === 'copied') return false;
  const upgraded = card.upgraded === true || (card.upgradeLevel ?? 0) > 0;
  if (filter.upgraded !== undefined && upgraded !== filter.upgraded) return false;
  return true;
}

/**
 * Stable storage order: hand left-to-right, ordered piles bottom-to-top.
 * This preserves legacy ordering. `top`/`bottom` interpret pile ends explicitly.
 */
export function orderedCardsForSelector<TCard extends SelectableCard>(
  zones: CardZoneState<TCard>,
  selector: CardSelector,
  options: { excludeCardIds?: ReadonlySet<string>; destination?: CardPileZone } = {},
): TCard[] {
  const cards: TCard[] = [];
  for (const zone of selectorZones(selector.zone)) {
    if (zone === options.destination) continue;
    for (const card of zones[zone]) {
      if (options.excludeCardIds?.has(card.id)) continue;
      if (!cardMatchesSelectorFilter(card, selector.filter)) continue;
      cards.push(card);
    }
  }
  return cards;
}

/** Resolve automatic positional picks without host/UI-specific assumptions. */
export function pickOrderedCardIds<TCard extends SelectableCard>(
  cards: readonly TCard[],
  selector: CardSelector,
  amount: number,
): string[] | null {
  const maximum = Math.min(cards.length, Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0);
  if (selector.pick === 'choose' || selector.pick === 'random') return null;
  if (selector.pick === 'all') return cards.slice(0, maximum).map(card => card.id);
  if (selector.pick === 'right') return cards.slice(-maximum).map(card => card.id);
  if (selector.pick === 'top') return cards.slice(-maximum).reverse().map(card => card.id);
  // left and bottom both consume the beginning of their validated stable order.
  return cards.slice(0, maximum).map(card => card.id);
}
