export interface ProgressionSnapshot {
    level: number;
    exp: number;
}
export interface ProgressionSettlement {
    before: ProgressionSnapshot;
    after: ProgressionSnapshot;
    promotions: number;
    cardRemovalsGranted: number;
}
export interface ProgressionSettlementPlan extends ProgressionSettlement {
    changed: boolean;
    nextCardRemovalCount: number;
}
/** Experience needed to advance from the supplied level. */
export declare function requiredExperienceForLevel(level: unknown): number;
export declare function totalExperienceAt(level: unknown, exp: unknown): number;
export declare function progressionFromTotalExperience(totalExperience: unknown): ProgressionSnapshot;
export declare function needsProgressionSettlement(battle: unknown): boolean;
/**
 * Compute an immutable upgrade plan. The host decides how to persist the
 * resulting level, exp, and removal count.
 */
export declare function planProgressionSettlement(battle: unknown): ProgressionSettlementPlan;
