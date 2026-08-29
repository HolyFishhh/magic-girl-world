import { type BuildBudget, type ContentPack } from './contentPack';
export declare const DECK_POWER_SCORE_SPEC: "mwg.deck-power/v1";
export interface DeckPowerDimensions {
    /** Sustainable pressure through HP and desire routes. */
    output: number;
    /** Block, healing and maximum-HP reserve. */
    survival: number;
    /** Draw, energy and custom-resource access. */
    economy: number;
    /** Likelihood that a useful, payable hand appears. */
    consistency: number;
    /** Delayed engines, triggers and compounding effects. */
    scaling: number;
    /** Debuffs, denial, turn control and enemy manipulation. */
    control: number;
    /** Number of meaningful routes and bridge mechanics. */
    flexibility: number;
    /** Draw/target/formula variance; higher means less reliable. */
    volatility: number;
}
export interface DeckPowerCurvePoint {
    turn: 1 | 3 | 5 | 8;
    cumulativePressure: number;
    cumulativeProtection: number;
    cumulativeHealing: number;
}
export interface DeckPowerScore {
    spec: typeof DECK_POWER_SCORE_SPEC;
    /** Ignores current HP/lust and presentation text. */
    fingerprint: string;
    totalScore: number;
    dimensions: DeckPowerDimensions;
    curves: DeckPowerCurvePoint[];
    budget: BuildBudget;
    maxHp: number;
    deckSize: number;
    confidence: 'low' | 'medium' | 'high';
    coverage: number;
    mechanicAxes: string[];
    reasons: string[];
}
/**
 * Score persistent player power without using current HP or current lust.
 * This is a fast, deterministic baseline. Encounter simulation is a separate calibration layer.
 */
export declare function scoreDeckPower(input: {
    pack: ContentPack;
    maxHp: number;
    fullHealthBudget?: BuildBudget;
}): DeckPowerScore;
export declare function clearDeckPowerScoreCache(): void;
