import { type CardZoneOperationPlan, type CardZoneOperationRequest, type CommitCardZoneOperationResult } from './cardZoneOperation';
import type { CardPileZone, CardZoneState } from './cardZoneReducer';
import type { Card, Player } from './battleState';
import { type CardPatch, type CardPatchLedger } from './cardPatch';
import type { CardMoveReason } from './battleEventJournal';
import type { EffectCommand } from './effectCommandRuntime';
import { type AdvancedCardZonePlan, type AdvancedCardZoneCommit } from './advancedCardZoneTransaction';
export type CardEffectCommand = Extract<EffectCommand, {
    type: 'draw_cards' | 'scry_cards' | 'discard_cards' | 'exhaust_cards' | 'recover_cards' | 'reduce_card_cost' | 'modify_card_value' | 'copy_cards' | 'double_card_effect' | 'auto_play_cards' | 'move_cards' | 'remove_cards' | 'transform_cards' | 'apply_card_patch' | 'apply_card_attachment' | 'upgrade_cards' | 'add_card' | 'ensure_card';
}>;
export type CardEffectChoicePurpose = 'discard' | 'exhaust' | 'recover' | 'seek' | 'scry' | 'reduce_cost' | 'modify_value' | 'copy' | 'double_effect' | 'auto_play' | 'move' | 'remove' | 'transform' | 'patch' | 'attachment' | 'upgrade';
export interface CardEffectChoiceRequest {
    purpose: CardEffectChoicePurpose;
    minimum: number;
    maximum: number;
    allowCancel: boolean;
}
export type CardEffectRuntimeEvent = {
    type: 'card_added';
    zone: 'hand' | 'draw' | 'discard';
    card: Card;
} | {
    type: 'card_cost_reduced';
    card: Card;
    previousCost: number;
    nextCost: number;
} | {
    type: 'card_value_modified';
    card: Card;
    stat: Extract<CardEffectCommand, {
        type: 'modify_card_value';
    }>['stat'];
    operator: Extract<CardEffectCommand, {
        type: 'modify_card_value';
    }>['operator'];
    value: number;
} | {
    type: 'card_recovered';
    source: 'draw' | 'discard' | 'exhaust';
    card: Card;
} | {
    type: 'card_scry_discarded';
    card: Card;
} | {
    type: 'card_moved';
    card: Card;
    destination: CardPileZone;
    position: 'top' | 'bottom';
} | {
    type: 'card_removed';
    card: Card;
} | {
    type: 'card_transformed';
    previous: Card;
    card: Card;
} | {
    type: 'card_upgraded';
    previous: Card;
    card: Card;
    levels: number;
    scope: 'combat' | 'run' | 'permanent';
} | {
    type: 'card_attachment_applied';
    card: Card;
    attachmentId: string;
    attachmentKind: 'enchantment' | 'affliction';
};
export interface CardEffectRuntimeContext {
    currentCardId?: string;
    excludedCardIds?: readonly string[];
    doubleEffectFilter?: 'playable' | 'any';
    currentTurn?: number;
    source?: {
        kind: CardPatch['source']['kind'];
        id: string;
        name?: string;
    };
}
export interface CardEffectStatePort {
    getPlayer(): Player;
    nextRandom(): number;
    readCardZoneState(): CardZoneState<Card>;
    readCardPatchLedger(): CardPatchLedger;
    writeCardPatchLedger(ledger: CardPatchLedger): void;
    commitCardZoneOperation(plan: CardZoneOperationPlan, selectedIds?: readonly string[]): CommitCardZoneOperationResult<Card>;
    commitAdvancedCardZoneTransaction(plan: AdvancedCardZonePlan, selectedIds?: readonly string[]): AdvancedCardZoneCommit<Card> | {
        ok: false;
        code: string;
    };
    updateOwnedCards(cardIds: readonly string[], update: (card: Card) => Card, sources?: readonly CardPileZone[]): Card[];
    createRuntimeCardId(sourceId: string): string;
    addCardToHand(card: Card): boolean;
    addCardToDeck(card: Card): void;
    placeGeneratedCard(card: Card, preferredZone: 'hand' | 'draw'): 'hand' | 'draw' | 'discard';
}
export interface CardEffectRuntimePorts {
    drawCards(count: number): Promise<void>;
    chooseCards(candidates: readonly Card[], request: CardEffectChoiceRequest): Promise<readonly string[] | null>;
    onCardDiscarded(card: Card, reason: CardMoveReason, source: CardPileZone): Promise<void>;
    onCardExhausted(card: Card, source: CardPileZone): Promise<void>;
    autoPlayCard(card: Card, source: CardPileZone, free: boolean): Promise<boolean>;
    present?(event: CardEffectRuntimeEvent): void;
}
export declare function isCardEffectCommand(command: unknown): command is CardEffectCommand;
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
    private modifyCardValue;
    private markDoubleEffect;
    private autoPlayCards;
    private executeAdvancedZoneRequest;
    private moveCards;
    private removeCards;
    private transformCards;
    private upgradeCards;
    private applyStructuredPatch;
    private applyStructuredAttachment;
    private addGeneratedCards;
    /**
     * Guarantee concrete combat roots without mutating a persistent template or
     * counting temporary copies. This is intentionally a current-battle
     * operation: later instance patches affect only the cards now present.
     */
    private ensureCardInstances;
}
