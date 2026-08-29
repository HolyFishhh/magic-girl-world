import { type RewardCategory, type RewardSelectionLimits, type RewardSelections } from './rewardSelection';
export interface RewardSelectionPlanEntry {
    category: RewardCategory;
    index: number;
    value: Record<string, unknown>;
    name: string;
    quantity: number;
}
export interface RewardSelectionPlan {
    selections: RewardSelections;
    entries: RewardSelectionPlanEntry[];
    statuses: Record<string, unknown>[];
    summary: {
        cards: string[];
        artifacts: string[];
        items: string[];
    };
}
export interface RewardSelectionPlanInput {
    selections: unknown;
    candidates: Record<RewardCategory, readonly unknown[]>;
    existing: Record<RewardCategory, readonly unknown[]>;
    statusDefinitions?: readonly unknown[];
    knownResourceIds?: Iterable<string>;
    limits: RewardSelectionLimits;
}
export interface RewardPoolState {
    candidates: Record<RewardCategory, readonly unknown[]>;
    disabledCategories?: readonly RewardCategory[];
    revision?: number;
    rerolls?: number;
}
export type RewardPoolMutation = {
    kind: 'replace';
    category: RewardCategory;
    index: number;
    candidate: unknown;
} | {
    kind: 'reroll';
    categories: readonly RewardCategory[];
    candidates: Partial<Record<RewardCategory, readonly unknown[]>>;
} | {
    kind: 'disable_category';
    category: RewardCategory;
} | {
    kind: 'modify';
    category: RewardCategory;
    removeIndices?: readonly number[];
    add?: readonly unknown[];
};
export interface RewardPoolMutationPlan {
    candidates: Record<RewardCategory, unknown[]>;
    disabledCategories: RewardCategory[];
    revision: number;
    rerolls: number;
    changedCategories: RewardCategory[];
}
/**
 * Plan one reward-pool edit without mutating candidates. Generated replacement content is supplied
 * by the caller; the plan owns only pool structure, disabled categories, reroll count, and revision.
 */
export declare function planRewardPoolMutation(state: RewardPoolState, mutation: RewardPoolMutation): RewardPoolMutationPlan;
/** Validate all selected candidates before a host applies any MUV mutation. */
export declare function planRewardSelections(input: RewardSelectionPlanInput): RewardSelectionPlan;
