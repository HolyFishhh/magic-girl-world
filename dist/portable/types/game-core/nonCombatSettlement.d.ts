import { type NonCombatDeckAction } from './nonCombatDeckActions';
export interface NonCombatSettlementCosts {
    hp: number;
    maxHp: number;
    gold: number;
    resources: Record<string, number>;
}
export interface NonCombatGrantPlan {
    cards: Record<string, unknown>[];
    items: Record<string, unknown>[];
    limits: {
        cards: number;
        items: number;
    };
}
export interface NonCombatSettlementPlan {
    hpDelta: number;
    maxHpDelta: number;
    lustDelta: number;
    maxLustDelta: number;
    goldDelta: number;
    cardRemovalDelta: number;
    resourceDeltas: Record<string, number>;
    grantedCards: Record<string, unknown>[];
    costs: NonCombatSettlementCosts;
    deckActions: NonCombatDeckAction[];
    grant: NonCombatGrantPlan | null;
}
export interface NonCombatCostState {
    hp: number;
    max_hp: number;
    lust: number;
    max_lust: number;
    gold: number;
    resources: unknown;
}
export interface NonCombatCostPlan extends Omit<NonCombatCostState, 'resources'> {
    resources: Record<string, unknown>[];
}
/**
 * Strictly parse a pre-authored non-combat settlement. This is a pure plan:
 * card/item mechanics and deck mutation targets are validated by their owning
 * reward/deck transactions, never silently interpreted here.
 */
export declare function parseNonCombatSettlement(value: unknown): NonCombatSettlementPlan;
/**
 * Validate and plan costs against the pre-settlement state. No gain/delta is
 * consulted here, so a reward from the same choice can never pay its cost.
 */
export declare function planNonCombatCosts(cost: NonCombatSettlementCosts, state: NonCombatCostState): NonCombatCostPlan;
