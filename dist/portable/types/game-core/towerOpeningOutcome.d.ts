export interface TowerOpeningRewardBundle {
    cards: Record<string, unknown>[];
    artifacts: Record<string, unknown>[];
    items: Record<string, unknown>[];
}
export interface TowerOpeningOutcomePlan {
    hpDelta: number;
    maxHpDelta: number;
    goldDelta: number;
    cardRemovalDelta: number;
    reward: TowerOpeningRewardBundle;
}
/**
 * Normalize the small, program-settled outcome language used by the opening
 * benefactor. Card/relic/item definitions remain dynamic and are validated by
 * the existing reward library before anything is committed to MVU.
 */
export declare function planTowerOpeningOutcome(value: unknown): TowerOpeningOutcomePlan;
