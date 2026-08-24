/**
 * One host-neutral pass over a shallow content definition.
 *
 * Budgeting, build guidance, and enemy diagnostics must observe the same
 * numeric literals and formula-driven fields. Modern effects are evaluated
 * against a detached representative state; no host or runtime state is read.
 */
import { type EffectModifierOperator, type EffectProgram, type EffectTarget, type ModifierStat } from './effectDsl';
export type ContentMetric = 'attack' | 'defense' | 'sustain' | 'draw' | 'energy';
/** One-time desire overflow is useful, but less frequent than a normal hand effect. */
export declare const CONTENT_DESIRE_EFFECT_WEIGHT = 0.5;
export interface ContentAnalysis {
    metrics: Record<ContentMetric, number>;
    dynamicMetrics: Set<ContentMetric>;
    tags: string[];
    statusIds: string[];
    modifiers: ContentModifier[];
    damage: number;
    /** Raw outgoing desire amount, kept separate so lust modifiers are not applied to HP damage. */
    lust: number;
    damageKnown: boolean;
}
/** Shared positive-or-dynamic metric predicate for budgets and diagnostics. */
export declare function hasContentMetric(analysis: Pick<ContentAnalysis, 'metrics' | 'dynamicMetrics'>, metric: ContentMetric): boolean;
export interface ContentModifier {
    target: EffectTarget;
    stat: ModifierStat;
    operator: EffectModifierOperator;
    value: number;
}
export interface ContentAnalysisOptions {
    statusStacks?: Readonly<Record<string, number>>;
    selfStatusStacks?: Readonly<Record<string, number>>;
    opponentStatusStacks?: Readonly<Record<string, number>>;
    currentStatusStacks?: number;
    spentEnergy?: number;
    /** Optional detached-state overrides used by the shared scenario sampler. */
    selfHp?: number;
    selfMaxHp?: number;
    opponentHp?: number;
    opponentMaxHp?: number;
    selfEnergy?: number;
    selfMaxEnergy?: number;
    currentTurn?: number;
    cardsPlayedThisTurn?: number;
    attacksPlayedThisTurn?: number;
    skillsPlayedThisTurn?: number;
}
export interface ContentScenarioRange {
    expected: ContentAnalysis;
    min: Record<ContentMetric, number>;
    max: Record<ContentMetric, number>;
    damageMin: number;
    damageMax: number;
    lustMin: number;
    lustMax: number;
}
export declare function analyzeEffectProgram(program: EffectProgram, options?: ContentAnalysisOptions, directWeight?: number): ContentAnalysis | null;
/** Analyze one shallow card/relic/ability/action without mutating runtime state. */
export declare function analyzeContentDefinition(value: unknown, options?: ContentAnalysisOptions): ContentAnalysis;
export interface ContentAnalysisScenario {
    weight: number;
    options: ContentAnalysisOptions;
}
/** Return the fixed detached scenarios used by all content-budget consumers. */
export declare function getContentAnalysisScenarios(options?: ContentAnalysisOptions): ContentAnalysisScenario[];
/** Estimate a definition across common runtime states without adding AI fields. */
export declare function analyzeContentScenarios(value: unknown, options?: ContentAnalysisOptions): ContentAnalysis;
/**
 * Return both the expected estimate and the observed scenario range. The range
 * is for diagnostics/balance only and is never serialized into an AI prompt.
 */
export declare function analyzeContentScenarioRange(value: unknown, options?: ContentAnalysisOptions): ContentScenarioRange;
/** Analyze status trigger maps through the same shallow-effect path. */
export declare function analyzeStatusDefinition(value: unknown, options?: ContentAnalysisOptions): ContentAnalysis;
/** Status counterpart of analyzeContentScenarios; it shares the same sampler. */
export declare function analyzeStatusScenarios(value: unknown, options?: ContentAnalysisOptions): ContentAnalysis;
export declare function analyzeStatusScenarioRange(value: unknown, options?: ContentAnalysisOptions): ContentScenarioRange;
