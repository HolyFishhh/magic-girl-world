export interface CardRuleCard {
    id: string;
    name: string;
    cost?: number | 'energy';
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
export declare function resolveStartingHand<TCard extends CardRuleCard>(cards: readonly TCard[], drawPerTurn: number, shuffle: (cards: readonly TCard[]) => TCard[], handLimit?: number): StartingHandResult<TCard>;
/** Resolve affordability and the immutable payment context for one card play. */
export declare function resolveCardEnergyPayment(card: Pick<CardRuleCard, 'cost' | 'xValueBonus'>, availableEnergy: number): CardEnergyPayment;
/** Power cards are one-shot ability registrations even if generated content omits exhaust. */
export declare function resolvePlayedCardDestination(card: Pick<CardRuleCard, 'type' | 'exhaust'>): PlayedCardDestination;
/** Freeze the curses that were present when turn-end card processing began. */
export declare function selectTurnEndCurseTriggers<TCard extends CardRuleCard>(hand: readonly TCard[]): TCard[];
/** Partition the current hand after curse effects have finished mutating it. */
export declare function resolveTurnEndHandDisposition<TCard extends CardRuleCard>(hand: readonly TCard[]): TurnEndHandDisposition<TCard>;
export declare function getCardSourceId(card: Pick<CardRuleCard, 'id' | 'name' | 'originalId' | 'templateId'>): string;
/** Count cards owned across persistent piles plus cards temporarily in a play transaction. */
export declare function countCardOwnership(cards: ReadonlyArray<Pick<CardRuleCard, 'id' | 'name' | 'originalId' | 'templateId'>>, inFlightCounts?: ReadonlyMap<string, number>): Map<string, number>;
