import { type DeckPowerScore } from './deckPowerScore';
import { type EnemyPowerScore } from './enemyPowerScore';
export declare const DIFFICULTY_BUDGET_SPEC: "mwg.difficulty-budget/v1";
export declare const DIFFICULTY_PRESETS: readonly [{
    readonly percent: 10;
    readonly id: "story";
    readonly name: "剧情体验";
    readonly description: "明显低于构筑强度，允许宽松试牌和高容错。";
}, {
    readonly percent: 50;
    readonly id: "relaxed";
    readonly name: "轻松";
    readonly description: "能体现敌人特色，但通常不会迫使玩家消耗生命资源。";
}, {
    readonly percent: 80;
    readonly id: "standard";
    readonly name: "标准";
    readonly description: "需要围绕敌人意图做决策，仍保留稳定容错。";
}, {
    readonly percent: 100;
    readonly id: "limit";
    readonly name: "极限平衡";
    readonly description: "充分发挥构筑时可无损或仅受最小伤害获胜。";
}, {
    readonly percent: 110;
    readonly id: "pressure";
    readonly name: "高压";
    readonly description: "稳定造成少量生命或道具消耗，但必须保持可战胜。";
}];
export type DifficultyPresetId = (typeof DIFFICULTY_PRESETS)[number]['id'];
export interface NumericRange {
    min: number;
    max: number;
}
export interface EncounterFeasibility {
    currentHp: number;
    currentLust: number;
    projectedHpLoss: NumericRange;
    projectedLustGain: NumericRange;
    winnableAtCurrentResources: boolean;
    maxRecommendedPercent: number;
    preparationAdvice: string[];
}
export interface DifficultyBudget {
    spec: typeof DIFFICULTY_BUDGET_SPEC;
    difficultyPercent: number;
    preset: DifficultyPresetId | 'custom';
    playerScore: number;
    targetEnemyScore: number;
    targetTurns: NumericRange;
    enemyHp: NumericRange;
    expectedActionDamage: NumericRange;
    peakActionDamage: NumericRange;
    expectedActionLust: NumericRange;
    expectedActionBlock: NumericRange;
    counterplayWindows: NumericRange;
    desiredHpLossRatio: NumericRange;
    feasibility: EncounterFeasibility;
    generationGuidance: string[];
}
export interface EnemyBalanceCalibration {
    actualPercent: number;
    targetPercent: number;
    deviationPercent: number;
    band: 'far_below' | 'below' | 'on_target' | 'above' | 'far_above';
    requiresCorrection: boolean;
    guidance: string[];
}
export declare function normalizeDifficultyPercent(value: unknown): number;
/** Convert a persistent deck score into concrete, directly consumable enemy-generation numbers. */
export declare function createDifficultyBudget(input: {
    deck: DeckPowerScore;
    difficultyPercent: number;
    currentHp: number;
    currentLust?: number;
    maxLust?: number;
}): DifficultyBudget;
/** Compare a generated enemy with the requested target after the second model has produced it. */
export declare function calibrateEnemyPower(deck: DeckPowerScore, enemy: EnemyPowerScore, targetPercent: number): EnemyBalanceCalibration;
