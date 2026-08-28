import type { BattleRouteContext } from './battleContract';
import { type RunPacingContext } from './runPacing';
export interface BattleRewardBudget {
    cards: {
        candidates: number;
        pick: number;
        rarities: string[];
    };
    artifacts: {
        candidates: number;
        pick: number;
    } | null;
    items: {
        candidates: number;
        pick: number;
    } | null;
    experience: number;
}
export interface ShopBudget {
    cards: number;
    artifacts: number;
    items: number;
}
export type ShopCandidateCategory = 'cards' | 'artifacts' | 'items';
/** Fixed candidate budgets reduce AI arithmetic and keep rewards comparable between runs. */
export declare function recommendBattleRewardBudget(route: BattleRouteContext | null): BattleRewardBudget;
export declare function formatBattleRewardBudget(budget: BattleRewardBudget, options?: {
    includeExperience?: boolean;
}): string;
/** Flat, non-formula checklist for the MVU model after a victory. */
export declare function formatBattleRewardChecklist(budget: BattleRewardBudget): string;
export declare function recommendShopBudget(pacing: RunPacingContext): ShopBudget;
export declare function formatShopBudget(budget: ShopBudget): string;
/** Program-owned shop pricing keeps arithmetic and required price fields out of AI output. */
export declare function recommendShopPrice(category: ShopCandidateCategory, candidate: unknown, act: number): number;
