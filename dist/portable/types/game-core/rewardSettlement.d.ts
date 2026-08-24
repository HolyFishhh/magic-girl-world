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
    limits: RewardSelectionLimits;
}
/** Validate all selected candidates before a host applies any MUV mutation. */
export declare function planRewardSelections(input: RewardSelectionPlanInput): RewardSelectionPlan;
