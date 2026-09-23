import type { EnemyBudgetEnvelope } from './encounterBalance';
export declare const TOWER_ENCOUNTER_PLAN_SPEC: "mwg.tower-encounter-plan/v1";
/** Design priors, maintained here. They are not claims about Slay the Spire. */
export declare const TOWER_ENEMY_COUNT_WEIGHTS: {
    readonly battle: readonly [35, 35, 20, 7, 3];
    readonly elite: readonly [60, 10, 10, 10, 10];
    readonly boss: readonly [60, 10, 10, 10, 10];
};
/**
 * A node-owned roll decides whether the author is asked to consider a soft
 * counterplay angle.  It is deliberately separate from enemy-count entropy:
 * retries and restores must not turn a non-counter encounter into one.
 */
export declare const TOWER_COUNTER_STRATEGY_CHANCE: {
    readonly battle: 20;
    readonly elite: 50;
    readonly boss: 50;
};
export interface TowerEncounterScope {
    nodeId: string;
    kind: string;
    contentSeed?: number;
    act?: number;
    floor?: number;
}
export interface TowerEncounterPlan {
    spec: typeof TOWER_ENCOUNTER_PLAN_SPEC;
    enemyCount: number;
    countSeed: number;
    counterStrategySeed: number;
    counterStrategyChance: number;
    counterStrategy: boolean;
    act: number;
    floor: number;
    /** Entire encounter, never a budget to be copied onto every enemy. */
    totalBudget?: EnemyBudgetEnvelope;
    enemyShares: number[];
    challenge: string[];
}
/** No request/revision/time input: retrying and restoring cannot reroll the count. */
export declare function createTowerEncounterPlan(scope: TowerEncounterScope, budget?: EnemyBudgetEnvelope): TowerEncounterPlan | undefined;
export declare function formatTowerEncounterPlan(scope: TowerEncounterScope, budget?: EnemyBudgetEnvelope): string;
