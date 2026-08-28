import type { CardSelector, CardSelectorFilter } from './effectDsl';
import type { CardOrigin } from './cardIdentity';
import type { CardPileZone, CardZoneCard, CardZoneState } from './cardZoneReducer';
export interface SelectableCard extends CardZoneCard {
    type?: string;
    rarity?: string;
    cost?: number | 'energy';
    tags?: readonly string[];
    originalId?: string;
    templateId?: string;
    runInstanceId?: string;
    combatInstanceId?: string;
    origin?: CardOrigin;
    upgraded?: boolean;
    upgradeLevel?: number;
}
/** `all` intentionally preserves its legacy meaning and excludes the exhaust pile. */
export declare function selectorZones(zone: CardSelector['zone']): CardPileZone[];
export declare function cardMatchesSelectorFilter(card: SelectableCard, filter?: CardSelectorFilter): boolean;
/**
 * Stable storage order: hand left-to-right, ordered piles bottom-to-top.
 * This preserves legacy ordering. `top`/`bottom` interpret pile ends explicitly.
 */
export declare function orderedCardsForSelector<TCard extends SelectableCard>(zones: CardZoneState<TCard>, selector: CardSelector, options?: {
    excludeCardIds?: ReadonlySet<string>;
    destination?: CardPileZone;
}): TCard[];
/** Resolve automatic positional picks without host/UI-specific assumptions. */
export declare function pickOrderedCardIds<TCard extends SelectableCard>(cards: readonly TCard[], selector: CardSelector, amount: number): string[] | null;
