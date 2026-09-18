import type { EnemyBudgetEnvelope } from './encounterBalance';
export declare const TOWER_ENCOUNTER_PLAN_SPEC: "mwg.tower-encounter-plan/v1";
/** Design priors, maintained here. They are not claims about Slay the Spire. */
export declare const TOWER_ENEMY_COUNT_WEIGHTS: {
    readonly battle: readonly [35, 35, 20, 7, 3];
    readonly elite: readonly [60, 10, 10, 10, 10];
    readonly boss: readonly [60, 10, 10, 10, 10];
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
