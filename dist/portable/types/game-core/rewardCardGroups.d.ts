/** Program-owned partitions of the flat card pool. Authored cards keep their existing contract. */
export interface RewardCardGroup {
    id: string;
    indices: number[];
    pick: number;
}
export declare function readRewardCardGroups(reward: Record<string, any>, cardCount: number): RewardCardGroup[];
/** Consume only the chosen group; expired alternatives never become another group's options. */
export declare function planRewardCardGroupClaim(groups: RewardCardGroup[], selected: number[]): {
    removed: Set<number>;
    groups: {
        indices: number[];
        id: string;
        pick: number;
    }[];
};
