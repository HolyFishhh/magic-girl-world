import type { CardSelectorFilter, CardValueOperator, CardValueStat, EffectProgram, NumericExpression } from './effectDsl';
import { type SelectableCard } from './cardSelectorRuntime';
export type CardPatchScope = 'resolution' | 'turn' | 'until_played' | 'combat' | 'run' | 'permanent';
export type CardKeyword = 'retain' | 'exhaust' | 'ethereal' | 'innate';
export type CardCostOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set' | 'min' | 'max';
export type CardPatchSourceKind = 'card' | 'relic' | 'status' | 'ability' | 'system' | 'enchantment' | 'affliction';
export interface CardPatchSource {
    kind: CardPatchSourceKind;
    id: string;
    name?: string;
}
export type CardPatchTarget = {
    match: 'instance';
    combatInstanceId: string;
} | {
    match: 'run_instance';
    runInstanceId: string;
} | {
    match: 'template';
    templateId: string;
    includeFutureCopies?: boolean;
} | {
    match: 'filter';
    filter: CardSelectorFilter;
    includeFutureCopies?: boolean;
};
interface CardPatchBase {
    id: string;
    source: CardPatchSource;
    scope: CardPatchScope;
    createdTurn: number;
    priority: number;
    target?: CardPatchTarget;
    removeOn?: 'resolution_end' | 'turn_end' | 'played' | 'combat_end' | 'run_end' | 'manual';
}
export type CardPatch = (CardPatchBase & {
    kind: 'numeric';
    stat: CardValueStat;
    operator: CardValueOperator;
    value: number;
}) | (CardPatchBase & {
    kind: 'cost';
    operator: CardCostOperator;
    value: number;
}) | (CardPatchBase & {
    kind: 'keyword';
    keyword: CardKeyword;
    enabled: boolean;
}) | (CardPatchBase & {
    kind: 'replay';
    extra: number;
}) | (CardPatchBase & {
    kind: 'x_value';
    operator: Extract<CardCostOperator, 'add' | 'subtract' | 'multiply' | 'divide' | 'set' | 'min' | 'max'>;
    value: number;
}) | (CardPatchBase & {
    kind: 'dynamic_cost';
    timing: 'on_draw' | 'while_in_hand' | 'on_play';
    operator: CardCostOperator;
    value: NumericExpression;
    minimum?: number;
    maximum?: number;
});
export interface CardPatchBaseSnapshot {
    effectProgram: EffectProgram;
    cost?: number | 'energy';
    retain?: boolean;
    exhaust?: boolean;
    ethereal?: boolean;
    innate?: boolean;
    replayCount?: number;
    xValueBonus?: number;
}
export interface PatchableCard extends SelectableCard {
    effectProgram: EffectProgram;
    retain?: boolean;
    exhaust?: boolean;
    ethereal?: boolean;
    innate?: boolean;
    replayCount?: number;
    xValueBonus?: number;
    doubleEffect?: boolean;
    patchBase?: CardPatchBaseSnapshot;
    patches?: CardPatch[];
}
export interface CardPatchLedger {
    patches: CardPatch[];
    nextSequence: number;
}
export interface CardPatchDraft {
    source: CardPatchSource;
    scope: CardPatchScope;
    createdTurn: number;
    priority?: number;
    target?: CardPatchTarget;
    removeOn?: CardPatchBase['removeOn'];
}
export declare function createCardPatchLedger(patches?: readonly CardPatch[]): CardPatchLedger;
export declare function createCardPatch<TPatch extends Omit<CardPatch, keyof CardPatchBase | 'kind'> & {
    kind: CardPatch['kind'];
}>(ledger: CardPatchLedger, draft: CardPatchDraft & TPatch): {
    ledger: CardPatchLedger;
    patch: CardPatch;
};
export declare function validateCardPatch(patch: CardPatch): void;
export declare function cardPatchApplies(card: PatchableCard, patch: CardPatch): boolean;
/** Rebuild all derived fields from the immutable base, so removal never accumulates rounding drift. */
export declare function materializeCardPatches<TCard extends PatchableCard>(card: TCard, external?: readonly CardPatch[]): TCard;
export declare function appendCardPatch<TCard extends PatchableCard>(card: TCard, patch: CardPatch): TCard;
export type CardPatchCleanupReason = NonNullable<CardPatchBase['removeOn']>;
export declare function clearCardPatches<TCard extends PatchableCard>(card: TCard, reason: CardPatchCleanupReason): TCard;
export interface CardPatchInheritancePolicy {
    scopes: readonly CardPatchScope[];
    includeEnchantment: boolean;
    includeAffliction: boolean;
}
export declare const TEMPORARY_COPY_PATCH_POLICY: CardPatchInheritancePolicy;
export declare const PERSISTENT_COPY_PATCH_POLICY: CardPatchInheritancePolicy;
export declare const TRANSFORM_PATCH_POLICY: CardPatchInheritancePolicy;
export declare function inheritedCardPatches(source: PatchableCard, policy: CardPatchInheritancePolicy): CardPatch[];
export declare function removeLedgerPatches(ledger: CardPatchLedger, reason: CardPatchCleanupReason): CardPatchLedger;
export {};
