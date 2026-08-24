import { type ShopCandidateCategory } from './contentBudget';
import { type RewardSelectionLimits, type RewardSelections } from './rewardSelection';
import { type RunState } from './runState';
export interface RestHealPlan {
    healed: number;
    hp: number;
    run: RunState;
}
export interface RestHealInput {
    run: RunState;
    hp: number;
    maxHp: number;
    ratio?: number;
}
export interface ShopPurchasePlanInput {
    run: RunState;
    candidates: Record<ShopCandidateCategory, readonly unknown[]>;
    selections: unknown;
    limits: RewardSelectionLimits;
}
export interface ShopPurchasePlan {
    selections: RewardSelections;
    spentGold: number;
    remainingGold: number;
    run: RunState;
}
/** Compute a campfire heal without mutating battle or run state. */
export declare function planRestHeal(input: RestHealInput): RestHealPlan;
/** Validate a shop selection and compute its atomic gold/route result. */
export declare function planShopPurchase(input: ShopPurchasePlanInput): ShopPurchasePlan;
