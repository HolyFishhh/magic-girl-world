import { type ContentPack } from './contentPack';
export type ShadowStrategy = 'aggressive' | 'survival' | 'engine' | 'random';
export interface ShadowStrategyResult {
    strategy: ShadowStrategy;
    runs: number;
    wins: number;
    winRate: number;
    winRateLow: number;
    winRateHigh: number;
    medianTurns: number;
    p90Turns: number;
    medianHpRatio: number;
    noPlayableTurnRate: number;
    horizons: Record<ShadowHorizonTurn, ShadowHorizonSummary>;
}
export type ShadowHorizonTurn = 1 | 2 | 3 | 5 | 8;
export interface ShadowDistribution {
    mean: number;
    p10: number;
    p50: number;
    p90: number;
}
export interface ShadowHorizonSummary {
    hpDamage: ShadowDistribution;
    lustPressure: ShadowDistribution;
    mitigation: ShadowDistribution;
    healing: ShadowDistribution;
    cardsSeen: ShadowDistribution;
    energySurplus: ShadowDistribution;
    deadDrawRate: number;
}
export interface EncounterShadowSimulation {
    spec: 'mwg.encounter-shadow/v1';
    confidence: 'low' | 'medium' | 'high';
    seeds: number;
    strategies: ShadowStrategyResult[];
    skilledWinRate: number;
    greedyWinRate: number;
    strategySpread: number;
    coverage: ShadowSimulationCoverage;
}
export interface ShadowSimulationCoverage {
    supportedFeatures: string[];
    approximatedFeatures: string[];
    unsupportedFeatures: string[];
    coverageRatio: number;
}
/**
 * Deterministic shadow estimate using the shared effect analyzer and enemy selector.
 * It is deliberately advisory: complex triggers/statuses lower confidence instead of being guessed as exact runtime behavior.
 */
export declare function simulateEncounterShadow(input: {
    pack: ContentPack;
    player: {
        hp: number;
        maxHp: number;
        lust?: number;
        maxLust?: number;
    };
    seeds?: number;
    strategies?: readonly ShadowStrategy[];
}): EncounterShadowSimulation | null;
