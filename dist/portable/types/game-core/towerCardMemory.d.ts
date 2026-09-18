import type { RunState } from './runState';
export interface TowerCardMemory {
    schemaVersion: 1;
    unchosen: Array<{
        id: string;
        card: Record<string, any>;
        sourceNodeId: string;
    }>;
    acquiredIds: string[];
    shopShownIds: string[];
    rejectedOffers?: Array<{
        receipt: string;
        sourceNodeId: string;
        cards: Record<string, any>[];
    }>;
}
export declare function readTowerCardMemory(run: RunState): TowerCardMemory;
/** Record a resolved offer, never an unseen future branch. */
export declare function rememberTowerCardOffer(run: RunState, candidates: readonly unknown[], selectedIds: readonly string[]): RunState;
/** A previous save may predate the explicit archive. Recover only consumed offers. */
export declare function recoverTowerCardMemory(run: RunState, ownedCards: readonly unknown[]): RunState;
/** Seeded ordering is stable across reopening and independent of battle RNG. */
export declare function towerMemoryCandidates(run: RunState, nodeId: string, purpose: 'recall' | 'shop'): Record<string, any>[];
export declare function markTowerShopCardsShown(run: RunState, cards: readonly unknown[]): RunState;
/** Only finalized, displayed groups of three count; partial claims never signal rejection. */
export declare function rememberRejectedTowerOffer(run: RunState, cards: readonly unknown[], receipt: string): RunState;
export declare function towerRewardPreferenceContext(run: RunState): Record<string, any> | undefined;
