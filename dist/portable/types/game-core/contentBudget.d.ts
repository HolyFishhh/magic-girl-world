import type { BattleRouteContext } from './battleContract';
import type { RunNodeKind } from './runState';
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
export interface TowerBattleRewardContext {
    nodeId: string;
    kind: Extract<RunNodeKind, 'battle' | 'elite' | 'boss'>;
    act: number;
    floor: number;
    floorsPerAct?: number;
}
/** Build the fixed battle reward budget without asking callers to invent pacing fields. */
export declare function recommendTowerBattleRewardBudget(context: TowerBattleRewardContext): BattleRewardBudget;
/**
 * Make battle reward quantity and pick limits program-owned.
 *
 * Extra candidates/categories are trimmed so already prepared nodes from an
 * older build remain playable. Missing required candidates are rejected and
 * sent through the bounded structure-repair request instead of silently
 * inventing authored content.
 */
export declare function enforceBattleRewardBudget(rewardValue: unknown, budget: BattleRewardBudget): Record<string, unknown>;
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
