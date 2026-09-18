/** Ordinary entity-target defaults. Status contexts and enemy selectors can override them. */
export declare const COMPACT_OPPONENT_DEFAULT_OPERATIONS: readonly ["damage", "lust", "execute", "kill", "apply_status", "remove_status"];
export declare function compactEffectDefaultTarget(operation: string): 'self' | 'opponent';
export declare function formatCompactEffectTargetContract(): string;
