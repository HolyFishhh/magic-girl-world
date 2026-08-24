export type RewardCategory = 'cards' | 'artifacts' | 'items';
export interface RewardSelections {
    cards: number[];
    artifacts: number[];
    items: number[];
}
export type RewardSelectionLimits = Record<RewardCategory, number>;
export type RewardCandidateCounts = Record<RewardCategory, number>;
/** Validate the small selection payload without reading or mutating host data. */
export declare function validateRewardSelections(value: unknown, candidateCounts: RewardCandidateCounts, limits: RewardSelectionLimits): RewardSelections;
