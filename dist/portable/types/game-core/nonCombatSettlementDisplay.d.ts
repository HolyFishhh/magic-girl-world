import type { ContentRuleReference } from './contentDescription';
export interface NonCombatSettlementDisplayOptions {
    resourceNames?: Readonly<Record<string, string>>;
    /** Card definitions in the current content scope, used for deck filters. */
    cardNames?: Readonly<Record<string, string>>;
}
/** Player-facing acquisition rules. It never contains transaction receipts. */
export declare function describeNonCombatSettlement(value: unknown, options?: NonCombatSettlementDisplayOptions): string;
export declare function nonCombatSettlementReferences(value: unknown, describeItem: (item: Record<string, unknown>) => string): ContentRuleReference[];
