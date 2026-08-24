import { type CardZoneOperationPlan, type CardZoneOperationRequest, type CommitCardZoneOperationResult } from './cardZoneOperation';
import type { CardPileZone, CardZoneState } from './cardZoneReducer';
import type { Card, Player } from './battleState';
import type { EffectCommand } from './effectCommandRuntime';
export type CardEffectCommand = Extract<EffectCommand, {
    type: 'draw_cards' | 'scry_cards' | 'discard_cards' | 'exhaust_cards' | 'recover_cards' | 'reduce_card_cost' | 'copy_cards' | 'double_card_effect' | 'add_card';
}>;
export type CardEffectChoicePurpose = 'discard' | 'exhaust' | 'recover' | 'seek' | 'scry' | 'reduce_cost' | 'copy' | 'double_effect';
export interface CardEffectChoiceRequest {
    purpose: CardEffectChoicePurpose;
    minimum: number;
    maximum: number;
    allowCancel: boolean;
}
export type CardEffectRuntimeEvent = {
    type: 'card_added';
    zone: 'hand' | 'draw';
    card: Card;
} | {
    type: 'card_cost_reduced';
    card: Card;
    previousCost: number;
    nextCost: number;
} | {
    type: 'card_recovered';
    source: 'draw' | 'discard' | 'exhaust';
    card: Card;
} | {
    type: 'card_scry_discarded';
    card: Card;
};
export interface CardEffectRuntimeContext {
    currentCardId?: string;
    excludedCardIds?: readonly string[];
    doubleEffectFilter?: 'playable' | 'any';
}
export interface CardEffectStatePort {
    getPlayer(): Player;
    nextRandom(): number;
    readCardZoneState(): CardZoneState<Card>;
    commitCardZoneOperation(plan: CardZoneOperationPlan, selectedIds?: readonly string[]): CommitCardZoneOperationResult<Card>;
    updateOwnedCards(cardIds: readonly string[], update: (card: Card) => Card, sources?: readonly CardPileZone[]): Card[];
    createRuntimeCardId(sourceId: string): string;
    addCardToHand(card: Card): boolean;
    addCardToDeck(card: Card): void;
}
export interface CardEffectRuntimePorts {
    drawCards(count: number): Promise<void>;
    chooseCards(candidates: readonly Card[], request: CardEffectChoiceRequest): Promise<readonly string[] | null>;
    onCardDiscarded(card: Card): Promise<void>;
    onCardExhausted(card: Card): Promise<void>;
    present?(event: CardEffectRuntimeEvent): void;
}
export declare function isCardEffectCommand(command: EffectCommand): command is CardEffectCommand;
/** Host-independent execution of every modern card-side-effect command. */
export declare class CardEffectRuntime {
    private readonly state;
    private readonly ports;
    constructor(state: CardEffectStatePort, ports: CardEffectRuntimePorts);
    execute(command: CardEffectCommand, context?: CardEffectRuntimeContext): Promise<readonly Card[]>;
    executeZoneOperation(request: CardZoneOperationRequest, context?: CardEffectRuntimeContext): Promise<readonly Card[]>;
    private candidates;
    private selectCards;
    private reduceCardCost;
    private copyCards;
    private markDoubleEffect;
    private addGeneratedCards;
}
