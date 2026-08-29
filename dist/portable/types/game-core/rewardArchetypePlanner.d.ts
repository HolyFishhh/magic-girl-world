import { type DeckPowerDimensions } from './deckPowerScore';
import type { ContentDefinition, ContentPack } from './contentPack';
export declare const REWARD_ARCHETYPE_PLAN_SPEC: "mwg.reward-archetype-plan/v1";
export type RewardArchetypePathKind = 'reinforce' | 'bridge' | 'pivot' | 'universal';
export type RewardPowerDimension = Exclude<keyof DeckPowerDimensions, 'volatility'>;
export interface RewardArchetypeTarget {
    id: string;
    label: string;
    description: string;
}
export interface RewardArchetypeDirection {
    kind: RewardArchetypePathKind;
    direction: string;
    targets: RewardArchetypeTarget[];
    priorityDimensions: RewardPowerDimension[];
}
export interface RewardArchetypePlan {
    spec: typeof REWARD_ARCHETYPE_PLAN_SPEC;
    baseDeckScore: number;
    primaryArchetypes: RewardArchetypeTarget[];
    weakestDimensions: Array<{
        id: RewardPowerDimension;
        score: number;
    }>;
    directions: RewardArchetypeDirection[];
    avoidRecentStructures: string[];
    constraints: string[];
}
export interface RewardCandidateArchetypeEvaluation {
    candidateId: string;
    pathKind: RewardArchetypePathKind;
    deckScoreDelta: number;
    relativeDeckScoreDelta: number;
    candidatePowerScore: number;
    selectionValue: number;
    dimensionGains: Partial<Record<keyof DeckPowerDimensions, number>>;
    affinities: Array<{
        id: string;
        label: string;
        score: number;
    }>;
    pathScores: Record<RewardArchetypePathKind, number>;
    novelty: number;
    structuralDuplicate: boolean;
    mechanicalDuplicate: boolean;
}
export interface DeckCardContribution {
    id: string;
    name: string;
    scoreContribution: number;
    scoreContributionRatio: number;
}
/**
 * Produce a compact pre-generation plan. It describes meaningful choices without
 * dictating card names, narrative skins, status names, or a fixed card recipe.
 */
export declare function createRewardArchetypePlan(input: {
    pack: ContentPack;
    maxHp: number;
    recentStructures?: readonly string[];
}): RewardArchetypePlan;
/** Evaluate the real marginal change of adding one candidate to the current deck. */
export declare function evaluateRewardCandidateArchetype(input: {
    pack: ContentPack;
    candidate: ContentDefinition;
    maxHp: number;
}): RewardCandidateArchetypeEvaluation;
/**
 * Estimate how much one current copy contributes by removing only that copy.
 * Negative values are valid: a curse or severe clog may reduce total deck power.
 */
export declare function profileDeckCardContributions(input: {
    pack: ContentPack;
    maxHp: number;
}): DeckCardContribution[];
