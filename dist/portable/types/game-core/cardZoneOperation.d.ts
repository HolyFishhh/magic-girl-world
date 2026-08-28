import type { CardSelector, RecoverCardZone } from './effectDsl';
import { type SelectableCard } from './cardSelectorRuntime';
import { type CardPileZone, type CardZoneCard, type CardZoneState } from './cardZoneReducer';
export type CardZoneOperationRequest = {
    type: 'scry_cards';
    amount: number;
} | {
    type: 'discard_cards' | 'exhaust_cards';
    selector: CardSelector;
    amount: number;
} | {
    type: 'recover_cards';
    source: RecoverCardZone;
    pick: 'random' | 'choose' | 'all';
    amount: number;
};
export type CardZoneOperationFailureCode = 'DUPLICATE_CARD_ID' | 'RANDOM_SOURCE_REQUIRED' | 'STALE_PLAN' | 'INVALID_SELECTION';
export interface CardZoneOperationFailure {
    ok: false;
    code: CardZoneOperationFailureCode;
}
export type CardZoneOperationSelection = {
    kind: 'interactive';
    minimum: number;
    maximum: number;
} | {
    kind: 'automatic';
    cardIds: string[];
};
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
export type CommitCardZoneOperationResult<TCard extends CardZoneCard> = CommittedCardZoneOperation<TCard> | CardZoneOperationFailure;
/** Build stable candidates and selection limits before a host opens any UI. */
export declare function planCardZoneOperation<TCard extends SelectableCard>(zones: CardZoneState<TCard>, request: CardZoneOperationRequest, options?: {
    handLimit?: number;
    random?: () => number;
    excludeCardIds?: ReadonlySet<string>;
}): PlanCardZoneOperationResult;
/** Validate a host response against the plan and commit the whole zone move immutably. */
export declare function commitCardZoneOperation<TCard extends CardZoneCard>(zones: CardZoneState<TCard>, plan: CardZoneOperationPlan, selectedCardIds?: readonly string[]): CommitCardZoneOperationResult<TCard>;
