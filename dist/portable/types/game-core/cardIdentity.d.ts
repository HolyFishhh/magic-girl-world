export type CardOrigin = 'deck' | 'generated' | 'copied' | 'transformed';
export interface CardIdentity {
    /** Immutable content/template identity shared by cards created from the same definition. */
    templateId: string;
    /** Stable identity of one owned card for the whole run. */
    runInstanceId: string;
    /** Identity of this concrete combat copy. Kept equal to legacy `id`. */
    combatInstanceId: string;
    /** How this instance entered the current lineage. */
    origin: CardOrigin;
    /** Parent run instance for copies/transforms; omitted for deck/generated roots. */
    parentRunInstanceId?: string;
    /** Parent combat instance when a temporary combat copy was produced. */
    parentCombatInstanceId?: string;
}
export interface CardIdentityCarrier {
    id?: string;
    originalId?: string;
    templateId?: string;
    runInstanceId?: string;
    combatInstanceId?: string;
    origin?: CardOrigin;
    parentRunInstanceId?: string;
    parentCombatInstanceId?: string;
}
export interface EnsureCardIdentityOptions {
    origin?: CardOrigin;
    existingCombatIds?: ReadonlySet<string>;
    existingRunIds?: ReadonlySet<string>;
    templateId?: string;
    runInstanceId?: string;
    combatInstanceId?: string;
    parent?: CardIdentityCarrier;
    /** A combat-only copy shares its parent's run identity and is never written back to the run deck. */
    temporaryCombatCopy?: boolean;
}
/**
 * Upgrade legacy card data to the four-layer identity model without time/random globals.
 * Existing explicit identities always win, making save migration idempotent.
 */
export declare function ensureCardIdentity<TCard extends CardIdentityCarrier>(card: TCard, options?: EnsureCardIdentityOptions): TCard & CardIdentity & {
    id: string;
    originalId: string;
};
export type CardIdentityMatch = 'instance' | 'run_instance' | 'template' | 'lineage';
/** Explicit identity comparison; callers must choose whether they mean this copy, owned card, or template. */
export declare function cardsShareIdentity(left: CardIdentityCarrier, right: CardIdentityCarrier, match: CardIdentityMatch): boolean;
export interface CardCopyIdentityOptions {
    temporaryCombatCopy?: boolean;
    existingCombatIds?: ReadonlySet<string>;
    existingRunIds?: ReadonlySet<string>;
}
/** Create only the identity fields for a copy; payload inheritance is handled by the patch system. */
export declare function createCardCopyIdentity(source: CardIdentityCarrier, options?: CardCopyIdentityOptions): CardIdentity & {
    id: string;
    originalId: string;
};
/** Strip combat-only identity before writing one owned card back to persistent run state. */
export declare function persistentCardIdentity(identity: CardIdentityCarrier): Pick<CardIdentity, 'templateId' | 'runInstanceId' | 'origin'> & {
    parentRunInstanceId?: string;
};
