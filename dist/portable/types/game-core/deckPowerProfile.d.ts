import { type ArchetypeAffinity } from './archetypeGraph';
import { type ContentPack } from './contentPack';
import { type ShadowDistribution, type ShadowHorizonTurn } from './encounterShadowSimulation';
export declare const DECK_POWER_PROFILE_SPEC: "mwg.deck-power/v2";
export interface DeckPowerHorizon {
    hpDamage: ShadowDistribution;
    lustPressure: ShadowDistribution;
    mitigation: ShadowDistribution;
    healing: ShadowDistribution;
    cardsSeen: ShadowDistribution;
    energySurplus: ShadowDistribution;
    deadDrawRate: number;
}
export interface DeckPowerDimensionsV2 {
    burst: number;
    sustainedOutput: number;
    survival: number;
    economy: number;
    consistency: number;
    scaling: number;
    control: number;
    combo: number;
    flexibility: number;
}
export type DeckVictoryAxis = 'hp' | 'lust' | 'special';
export interface DeckVictoryFrontier {
    axis: DeckVictoryAxis;
    score: number;
    confidence: number;
}
export interface DeckProbeFrontier {
    id: StandardProbeId;
    label: string;
    scale: number;
    score: number;
    confidence: number;
    skilledWinRate: number;
    medianHpRatio: number;
}
export interface DeckPowerProfile {
    spec: typeof DECK_POWER_PROFILE_SPEC;
    fingerprint: string;
    seeds: number;
    maxHp: number;
    horizons: Record<ShadowHorizonTurn, DeckPowerHorizon>;
    dimensions: DeckPowerDimensionsV2;
    probeFrontiers: DeckProbeFrontier[];
    victoryFrontiers: DeckVictoryFrontier[];
    totalScore: number;
    confidence: number;
    unsupportedFeatures: string[];
    archetypes: ArchetypeAffinity[];
    scatterShare: number;
    deckQuality: DeckQualityProfile;
    reasons: string[];
}
export interface DeckQualityProfile {
    /** Multiplier applied after simulation so dead or inefficient draws cannot add power. */
    multiplier: number;
    totalCopies: number;
    deadCopies: number;
    hardToPlayCopies: number;
    inefficientCopies: number;
    offPlanCopies: number;
}
export type StandardProbeId = 'steady-pressure' | 'telegraphed-burst' | 'late-scaling' | 'control-tax' | 'desire-pressure' | 'multi-target';
/**
 * Score a persistent build with full resources. Current HP/lust are deliberately absent.
 * The score is the risk-averse frontier of standard probe enemies, normalized so a
 * five-strike/five-guard reference build at 80 max HP is approximately 100.
 */
export declare function createDeckPowerProfileFingerprint(input: {
    pack: ContentPack;
    maxHp: number;
    maxLust?: number;
    seeds?: number;
}): string;
export declare function profileDeckPower(input: {
    pack: ContentPack;
    maxHp: number;
    maxLust?: number;
    seeds?: number;
}): DeckPowerProfile;
export declare function clearDeckPowerProfileCache(): void;
