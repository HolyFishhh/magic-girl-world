import { type CardPatch, type CardPatchScope, type CardPatchSource, type PatchableCard } from './cardPatch';
import { type CardAttachment } from './cardAttachment';
export type CardUpgradeChange = Pick<Extract<CardPatch, {
    kind: 'numeric';
}>, 'kind' | 'stat' | 'operator' | 'value'> | Pick<Extract<CardPatch, {
    kind: 'cost';
}>, 'kind' | 'operator' | 'value'> | Pick<Extract<CardPatch, {
    kind: 'keyword';
}>, 'kind' | 'keyword' | 'enabled'> | Pick<Extract<CardPatch, {
    kind: 'replay';
}>, 'kind' | 'extra'> | Pick<Extract<CardPatch, {
    kind: 'x_value';
}>, 'kind' | 'operator' | 'value'> | Pick<Extract<CardPatch, {
    kind: 'dynamic_cost';
}>, 'kind' | 'timing' | 'operator' | 'value' | 'minimum' | 'maximum'>;
export interface CardUpgradeRequest {
    source: CardPatchSource;
    scope: Extract<CardPatchScope, 'combat' | 'run' | 'permanent'>;
    createdTurn: number;
    changes: readonly CardUpgradeChange[];
    levels?: number;
    /** Omit to allow repeatable upgrades; set to one for ordinary single upgrades. */
    maxLevel?: number;
    priority?: number;
    packageId?: string;
}
export interface CardUpgradeRecord {
    id: string;
    source: CardPatchSource;
    scope: CardUpgradeRequest['scope'];
    fromLevel: number;
    toLevel: number;
    patchIds: string[];
}
export interface ProgressionCard extends PatchableCard {
    quantity?: number;
    parentCombatInstanceId?: string;
    upgraded?: boolean;
    upgradeLevel?: number;
    upgradeHistory?: CardUpgradeRecord[];
}
export interface PersistentCardCarrier extends Record<string, any> {
    id?: string;
    originalId?: string;
    templateId?: string;
    runInstanceId?: string;
    runInstanceIds?: string[];
    combatInstanceId?: string;
    parentRunInstanceId?: string;
    parentCombatInstanceId?: string;
    origin?: string;
    quantity?: number;
}
export type PersistentRunCard<TCard extends PersistentCardCarrier = PersistentCardCarrier> = TCard & {
    id: string;
    runInstanceId: string;
    templateId: string;
    quantity: 1;
};
export type PersistentDeckMutation<TCard extends PersistentCardCarrier = PersistentCardCarrier> = {
    kind: 'remove';
    runInstanceId: string;
} | {
    kind: 'duplicate';
    runInstanceId: string;
} | {
    kind: 'transform';
    runInstanceId: string;
    replacement: Omit<TCard, 'runInstanceId' | 'combatInstanceId' | 'quantity'>;
};
export interface PersistentDeckMutationResult<TCard extends PersistentCardCarrier> {
    cards: Array<PersistentRunCard<TCard>>;
    sourceRunInstanceId: string;
    createdRunInstanceId?: string;
    removedRunInstanceId?: string;
}
/**
 * Upgrade legacy `id + quantity` run decks into one record per owned card. Explicit identities
 * are preserved and duplicate explicit identities reject the whole migration. Generated IDs are
 * deterministic, so restoring and migrating the same save produces the same instance layout.
 */
export declare function migratePersistentRunDeck<TCard extends PersistentCardCarrier>(cardsValue: readonly TCard[]): Array<PersistentRunCard<TCard>>;
/** Apply one persistent remove/copy/transform without mutating the source deck. */
export declare function applyPersistentDeckMutation<TCard extends PersistentCardCarrier>(cardsValue: readonly TCard[], mutation: PersistentDeckMutation<TCard>): PersistentDeckMutationResult<TCard>;
/**
 * Apply one logical upgrade as an atomic patch bundle. The source card is never mutated.
 * A bundle increments the level once even when it changes several independent channels.
 */
export declare function applyCardUpgradeBundle<TCard extends ProgressionCard>(card: TCard, request: CardUpgradeRequest): TCard;
export interface PersistentCardWriteBackResult<TCard> {
    cards: TCard[];
    updatedRunInstanceIds: string[];
    ignoredCombatInstanceIds: string[];
}
export declare const PERSISTENT_CARD_PROGRESSION_META_KEY: "mwg_card_progression";
export interface PersistentCardProgressionMetadata {
    version: 1;
    patches: CardPatch[];
    attachments: CardAttachment[];
    upgradeHistory: CardUpgradeRecord[];
    upgraded: boolean;
    upgradeLevel: number;
}
/** Restore only validated run/permanent progression from one canonical MVU card definition. */
export declare function restorePersistentCardProgression<TCard extends ProgressionCard>(card: TCard, definition: unknown): TCard;
/**
 * Store runtime progression beside the original compact MVU definition. Compact `effects` remain
 * the immutable base; validated patches are materialized again when the next combat is loaded.
 */
export declare function serializePersistentCardProgression<TCard extends ProgressionCard & PersistentCardCarrier>(definition: Record<string, any>, card: TCard): Record<string, any>;
/** Remove one real lifecycle scope as a single card-progression operation. */
export declare function cleanupCardProgression<TCard extends ProgressionCard>(card: TCard, event: 'combat_end' | 'run_end'): TCard;
/**
 * Persist run/permanent changes from concrete combat instances without leaking combat-only
 * identities or patches. Temporary copies that share a run identity are deliberately ignored.
 */
export declare function writeBackPersistentCardProgression<TCard extends ProgressionCard>(runCards: readonly TCard[], combatCards: readonly TCard[]): PersistentCardWriteBackResult<TCard>;
