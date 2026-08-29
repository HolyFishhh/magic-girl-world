import { type ContentPack } from './contentPack';
import { type DeckPowerProfile } from './deckPowerProfile';
import { type EncounterShadowSimulation } from './encounterShadowSimulation';
export declare const ENEMY_BUDGET_ENVELOPE_SPEC: "mwg.enemy-budget/v2";
export declare const ENCOUNTER_CALIBRATION_SPEC: "mwg.encounter-calibration/v1";
export interface BalanceRange {
    min: number;
    max: number;
}
export interface EnemyTurnPressureBudget {
    turn: number;
    hpDamage: BalanceRange;
    lust: BalanceRange;
    block: BalanceRange;
}
export interface EnemyBudgetEnvelope {
    spec: typeof ENEMY_BUDGET_ENVELOPE_SPEC;
    requestedRatio: number;
    effectiveRatio: number;
    targetScore: number;
    targetTurns: [number, number];
    durability: {
        hp: BalanceRange;
        sustain: BalanceRange;
    };
    pressureByTurn: EnemyTurnPressureBudget[];
    burstCap: number;
    scalingCap: number;
    controlBudget: number;
    requiredCounterplayWindows: number;
    inheritedMechanics: string[];
    confidence: number;
    guidance: string[];
}
export interface EncounterCalibrationResult {
    spec: typeof ENCOUNTER_CALIBRATION_SPEC;
    requestedRatio: number;
    effectiveRatio: number;
    frontierScale: number;
    appliedScale: number;
    calibratedPack: ContentPack;
    simulation: EncounterShadowSimulation | null;
    currentResourceSimulation: EncounterShadowSimulation | null;
    changedPaths: string[];
    iterations: number;
    winnableAtCurrentResources: boolean;
    confidence: number;
    warnings: string[];
}
export declare function createEnemyBudgetEnvelope(input: {
    profile: DeckPowerProfile;
    requestedRatio: number;
    currentHp: number;
    currentLust?: number;
    maxLust?: number;
    inheritedMechanics?: string[];
}): EnemyBudgetEnvelope;
export declare function scaleEncounterNumbers(pack: ContentPack, factor: number): {
    pack: ContentPack;
    changedPaths: string[];
};
/**
 * Calibrate only authored enemy numbers. Mechanic identity, action order, hit counts,
 * target selectors, names and descriptions remain untouched.
 */
export declare function calibrateEncounterNumbers(input: {
    pack: ContentPack;
    profile: DeckPowerProfile;
    requestedRatio: number;
    currentHp: number;
    currentLust?: number;
    maxLust?: number;
    seeds?: number;
}): EncounterCalibrationResult;
