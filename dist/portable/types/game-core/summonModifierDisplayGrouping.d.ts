/** Display-only grouping. Never rewrite executable effects or resolve a random target. */
export declare function summonModifierDisplayGroups<T>(entries: readonly T[], format: 'compact' | 'program'): T[][];
/** The target prefix is shared only after structured ownership checks above. */
export declare function joinSummonModifierDescriptions(texts: readonly string[]): string;
