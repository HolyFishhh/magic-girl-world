import type { BattleRequest } from './battleContract';
import type { BuildBudget } from './contentPack';
export interface EnemyBudget {
    hpMin: number;
    hpMax: number;
    hitMin: number;
    hitMax: number;
}
export interface EnemyBudgetAssessment {
    budget: EnemyBudget;
    warnings: string[];
}
/** Give the generator concrete ranges; it should not have to perform balance arithmetic. */
export declare function recommendEnemyBudget(build: BuildBudget, danger: 0 | 1 | 2 | 3, act?: number): EnemyBudget;
export declare function formatEnemyBudget(budget: EnemyBudget): string;
/** Diagnose obvious numeric outliers without rejecting formula-driven custom encounters. */
export declare function assessEnemyBudget(request: BattleRequest, build: BuildBudget): EnemyBudgetAssessment;
