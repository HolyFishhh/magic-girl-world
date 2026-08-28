import { type CardPatchInheritancePolicy, type PatchableCard } from './cardPatch';
import { type CardSelectionPlan } from './cardSelection';
import { type SelectableCard } from './cardSelectorRuntime';
import type { CardSelector } from './effectDsl';
import type { CardPileZone, CardZoneState } from './cardZoneReducer';
export type CardPilePosition = 'top' | 'bottom';
export type AdvancedCardZoneRequest = {
    type: 'move';
    selector: CardSelector;
    amount: number;
    destination: CardPileZone;
    position: CardPilePosition;
} | {
    type: 'remove';
    selector: CardSelector;
    amount: number;
} | {
    type: 'copy';
    selector: CardSelector;
    amount: number;
    destination: CardPileZone;
    position: CardPilePosition;
    persistent: boolean;
};
export type AdvancedCardZoneFailureCode = 'DUPLICATE_CARD_ID' | 'RANDOM_SOURCE_REQUIRED' | 'INVALID_SELECTION' | 'STALE_PLAN' | 'DUPLICATE_GENERATED_ID';
export interface AdvancedCardZonePlan {
    ok: true;
    request: AdvancedCardZoneRequest;
    candidateIds: string[];
    selection: CardSelectionPlan & {
        ok: true;
    };
    snapshot: Record<CardPileZone, string[]>;
}
export type PlanAdvancedCardZoneResult = AdvancedCardZonePlan | {
    ok: false;
    code: AdvancedCardZoneFailureCode;
};
export interface AdvancedCardZoneCommit<TCard extends SelectableCard> {
    ok: true;
    zones: CardZoneState<TCard>;
    selected: TCard[];
    created: TCard[];
    removed: TCard[];
}
export declare function planAdvancedCardZoneTransaction<TCard extends SelectableCard>(zones: CardZoneState<TCard>, request: AdvancedCardZoneRequest, random?: () => number): PlanAdvancedCardZoneResult;
export declare function commitAdvancedCardZoneTransaction<TCard extends SelectableCard & Partial<PatchableCard>>(zones: CardZoneState<TCard>, plan: AdvancedCardZonePlan, response?: readonly string[] | null): AdvancedCardZoneCommit<TCard> | {
    ok: false;
    code: AdvancedCardZoneFailureCode;
};
/** Replace the definition while retaining one owned/run identity and only explicitly inherited patches. */
export declare function transformCardInstance<TCard extends PatchableCard>(source: TCard, replacement: Omit<TCard, 'id' | 'runInstanceId' | 'combatInstanceId' | 'patches' | 'patchBase'>, policy?: CardPatchInheritancePolicy): TCard;
/** Place already validated generated cards atomically; duplicate IDs reject the whole batch. */
export declare function placeGeneratedCards<TCard extends SelectableCard>(zones: CardZoneState<TCard>, cards: readonly TCard[], destination: CardPileZone, position: CardPilePosition): AdvancedCardZoneCommit<TCard> | {
    ok: false;
    code: 'DUPLICATE_GENERATED_ID';
};
