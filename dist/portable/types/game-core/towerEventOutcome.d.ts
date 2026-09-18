import { type TowerOpeningOutcomePlan } from './towerOpeningOutcome';
import type { RunNodeOutcome } from './runState';
export interface TowerEventOutcomePlan extends Omit<TowerOpeningOutcomePlan, 'reward' | 'maxLustDelta' | 'deckTransforms'> {
    routeOutcome: RunNodeOutcome;
    resourceDeltas: Record<string, number>;
    reward: Record<string, unknown> | null;
    grantedCards: Record<string, unknown>[];
    maxLustDelta: number;
    cost: import('./nonCombatSettlement').NonCombatSettlementCosts;
    deckActions: import('./nonCombatDeckActions').NonCombatDeckAction[];
    grant: import('./nonCombatSettlement').NonCombatGrantPlan | null;
}
export interface TowerEventResourceChange {
    id: string;
    name: string;
    emoji: string;
    delta: number;
    before: number;
    after: number;
    max: number;
}
export interface TowerEventResourceSettlementPlan {
    affordable: boolean;
    changes: TowerEventResourceChange[];
    resources: Record<string, unknown>[];
    shortage?: {
        id: string;
        name: string;
        required: number;
        available: number;
    };
}
/**
 * Resolve one event's persistent custom-resource changes against the player's
 * current registered resource library. The whole plan is atomic: when one
 * cost is unaffordable none of the returned resource values are changed.
 */
export declare function planTowerEventResourceSettlement(deltasValue: unknown, resourcesValue: unknown): TowerEventResourceSettlementPlan;
/**
 * Validate the compact, program-settled outcome used by pre-generated tower
 * events. Reward candidate validation remains runtime-owned because it needs
 * the player's current card/status/resource libraries.
 */
export declare function planTowerEventOutcome(value: unknown): TowerEventOutcomePlan;
