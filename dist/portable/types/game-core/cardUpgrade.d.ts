import type { CardCost } from './combatResource';
export interface CardUpgradePatch {
    /** Optional route binding for node-scoped upgrades. */
    node_id: string;
    card_id: string;
    description?: string;
    name?: string;
    cost?: CardCost;
    effects?: unknown;
    discard_effects?: unknown;
    trigger?: string;
    creates?: unknown[];
    retain?: boolean;
    exhaust?: boolean;
    ethereal?: boolean;
    innate?: boolean;
}
export interface CardUpgradeOptions {
    maxLevel?: number;
    knownStatusIds?: Iterable<string>;
    statusDefinitions?: readonly unknown[];
    knownResourceIds?: Iterable<string>;
}
export type CardUpgradeResult = {
    ok: true;
    card: Record<string, unknown>;
    level: number;
} | {
    ok: false;
    message: string;
};
/** Apply one small AI-authored patch while preserving card identity and ownership fields. */
export declare function applyCardUpgrade(cardValue: unknown, patchValue: unknown, options?: CardUpgradeOptions): CardUpgradeResult;
/** Return a new persistent deck; malformed patches never partially mutate the source array. */
export declare function applyCardUpgradeToDeck(cardsValue: unknown, patchValue: unknown, options?: CardUpgradeOptions): CardUpgradeResult & {
    cards?: Record<string, unknown>[];
};
