import type { EnemyBudgetEnvelope } from './encounterBalance';
import type { EncounterEvaluation } from './encounterEvaluation';
export declare const TOWER_BUILD_MEASUREMENT_SPEC: "mwg.tower-build-measurement/v1";
export interface TowerBuildMeasurement {
    spec: typeof TOWER_BUILD_MEASUREMENT_SPEC;
    damageByTurn: number[];
    defensePerTurn: number;
    maxHp: number;
    status: 'measured' | 'inconclusive';
    decisionCoverage?: 'bounded' | 'limited';
    evidence: EncounterEvaluation[];
    calibration?: {
        spec: 'mwg.build-calibration/v1';
        cases: import('./buildCalibration').BuildCalibrationCase[];
    };
}
export interface TowerEncounterBaseline {
    spec: 'mwg.tower-encounter-baseline/v1';
    act: number;
    capturedAct?: number;
    source?: 'opening-reference' | 'late-reference';
    damageByTurn: number[];
    defensePerTurn: number;
    maxHp: number;
}
export declare const TOWER_BALANCE_DESIGN: {
    normalTurns: [number, number];
    eliteTurns: [number, number];
    bossTurns: [number, number];
    growthResponseExponent: number;
    actGrowth: number[];
    maxCalibrationPasses: number;
};
export declare function validTowerEncounterBaseline(value: unknown): value is TowerEncounterBaseline;
export declare function createTowerEncounterBaseline(measurement: TowerBuildMeasurement, act: number): TowerEncounterBaseline;
export declare function hasReliableTowerMeasurement(measurement: TowerBuildMeasurement): boolean;
/** Fixed act progression plus partial response to measured build growth preserves upgrades' benefit.
 * Current HP does not change the world budget. Calibration uses a clean full-health reference.
 */
export declare function towerBudgetFromMeasurement(input: {
    measurement: TowerBuildMeasurement;
    baseline?: TowerEncounterBaseline;
    kind: string;
    act: number;
    floor: number;
    difficulty: number;
}): EnemyBudgetEnvelope;
