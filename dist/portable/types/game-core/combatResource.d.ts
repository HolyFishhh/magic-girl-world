export type CardCostComponent = number | 'all';
export type CompositeCardCost = Readonly<Record<string, CardCostComponent>>;
export type CardCost = number | 'energy' | CompositeCardCost;
export interface CombatResourceState {
    id: string;
    name: string;
    emoji: string;
    current: number;
    max: number;
    /** reset refills at player turn start; retain preserves the previous amount. */
    refresh: 'reset' | 'retain';
}
export type CombatResourcePool = Readonly<Record<string, number>>;
export type CardResourceWaiver = 'all' | readonly string[] | undefined;
export interface CardResourcePayment {
    affordable: boolean;
    required: Record<string, number>;
    spent: Record<string, number>;
    xValues: Record<string, number>;
    waived: string[];
    shortage?: {
        resource: string;
        required: number;
        available: number;
    };
    /** Compatibility projections for existing X-energy formulas and logs. */
    requiredEnergy: number;
    spentEnergy: number;
    xValue: number;
}
export interface CombatResourceDefinitionIssue {
    path: string;
    code: 'INVALID_RESOURCE_COLLECTION' | 'TOO_MANY_RESOURCES' | 'INVALID_RESOURCE_ENTRY' | 'UNKNOWN_RESOURCE_FIELD' | 'INVALID_RESOURCE_ID' | 'DUPLICATE_RESOURCE_ID' | 'INVALID_RESOURCE_NAME' | 'INVALID_RESOURCE_EMOJI' | 'INVALID_RESOURCE_VALUE' | 'INVALID_RESOURCE_REFRESH';
    message: string;
}
export declare function isCompositeCardCost(value: unknown): value is CompositeCardCost;
export declare function validateCardCost(value: unknown): string | null;
export declare function normalizeCardCost(value: CardCost | undefined): CompositeCardCost;
/**
 * Convert a heterogeneous cost into one advisory scalar without coercing an
 * object through Number(). Runtime affordability must still use
 * resolveCardResourcePayment; this helper is only for sorting and balance
 * estimates where different resource channels need a stable common weight.
 */
export declare function estimateCardCostWeight(cost: CardCost | undefined, available?: CombatResourcePool, allFallback?: number): number;
/** Resolve all cost components once; no resource is mutated until the caller commits the complete payment. */
export declare function resolveCardResourcePayment(cost: CardCost | undefined, available: CombatResourcePool, waiver: CardResourceWaiver, xValueBonus?: number): CardResourcePayment;
export declare function applyCardResourcePayment(available: CombatResourcePool, payment: CardResourcePayment): Record<string, number>;
export declare function normalizeCombatResourceStates(value: unknown): Record<string, CombatResourceState>;
/** Strict authoring validation; normalization remains tolerant only for old saves. */
export declare function validateCombatResourceDefinitions(value: unknown, path?: string): CombatResourceDefinitionIssue[];
export declare function resourcePoolFromCombatant(energy: number, resources?: Readonly<Record<string, CombatResourceState>>): Record<string, number>;
export declare function applyResourcePoolToStates(resources: Readonly<Record<string, CombatResourceState>> | undefined, pool: CombatResourcePool): Record<string, CombatResourceState>;
export declare function refreshCombatResourceStates(resources: Readonly<Record<string, CombatResourceState>> | undefined): Record<string, CombatResourceState>;
export declare function describeCardCost(cost: CardCost | undefined, resources?: Readonly<Record<string, Pick<CombatResourceState, 'name' | 'emoji'>>>): string;
