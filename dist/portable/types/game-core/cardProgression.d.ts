import { type CardPatch, type CardPatchScope, type CardPatchSource, type PatchableCard } from './cardPatch';
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
    upgraded?: boolean;
    upgradeLevel?: number;
    upgradeHistory?: CardUpgradeRecord[];
}
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
/**
 * Persist run/permanent changes from concrete combat instances without leaking combat-only
 * identities or patches. Temporary copies that share a run identity are deliberately ignored.
 */
export declare function writeBackPersistentCardProgression<TCard extends ProgressionCard>(runCards: readonly TCard[], combatCards: readonly TCard[]): PersistentCardWriteBackResult<TCard>;
