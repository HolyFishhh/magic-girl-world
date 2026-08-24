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
export type CardDrawLifecycleEvent<TCard extends CardZoneCard> = {
    type: 'shuffle';
    recycledCards: number;
} | {
    type: 'draw';
    card: TCard;
} | {
    type: 'stopped';
    reason: 'hand_limit' | 'empty';
};
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
/** Fisher-Yates with an explicit random source so hosts and tests control nondeterminism. */
export declare function shuffleCards<T>(cards: readonly T[], random: () => number): T[];
export declare function removeCardFromZone<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, zone: CardPileZone, cardId: string): RemoveCardResult<TCard>;
export declare function appendCardToZone<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, zone: CardPileZone, card: TCard): CardZoneState<TCard>;
export declare function insertCardIntoZone<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, zone: CardPileZone, card: TCard, index: number): CardZoneState<TCard>;
export declare function moveCardsBetweenZones<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, cardIds: readonly string[], sources: readonly CardPileZone[], destination: CardPileZone, destinationLimit?: number): MoveCardsResult<TCard>;
/** Inspect the next cards to be drawn and move only selected inspected cards to discard. */
export declare function scryCardsFromDraw<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, amount: number, selectedCardIds: readonly string[]): ScryCardsResult<TCard>;
export declare function updateCardsInZones<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, cardIds: readonly string[], sources: readonly CardPileZone[], update: (card: TCard) => TCard): UpdateCardsResult<TCard>;
export declare function recycleDiscardIntoDraw<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, shuffle: (cards: readonly TCard[]) => TCard[]): {
    zones: CardZoneState<TCard>;
    recycled: boolean;
};
export declare function drawCardsFromZones<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, amount: number, shuffle: (cards: readonly TCard[]) => TCard[], handLimit?: number): DrawCardsResult<TCard>;
/**
 * Advance exactly one observable draw-lifecycle step. Returning shuffle as a
 * separate step lets hosts resolve its triggers before the recycled card is drawn.
 */
export declare function advanceCardDrawLifecycle<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, shuffle: (cards: readonly TCard[]) => TCard[], handLimit?: number): CardDrawLifecycleResult<TCard>;
