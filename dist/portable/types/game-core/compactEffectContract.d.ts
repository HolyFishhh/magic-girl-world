export declare const COMPACT_EFFECT_META_KEYS: readonly ["to", "when", "on", "stacks", "hits", "from", "pick", "count", "add", "subtract", "multiply", "divide", "set"];
export declare const COMPACT_EFFECT_META_KEY_SET: Set<string>;
/**
 * Stable expansion order for an unordered JSON effect bundle.
 * Authors must use separate array entries when one effect depends on another.
 */
export declare const COMPACT_EFFECT_BUNDLE_OPERATIONS: readonly ["damage", "heal", "block", "energy", "lust", "apply_status", "remove_status", "draw"];
export type CompactEffectBundleOperation = (typeof COMPACT_EFFECT_BUNDLE_OPERATIONS)[number];
export declare const COMPACT_EFFECT_BUNDLE_OPERATION_SET: Set<string>;
/** AI may omit the array wrapper when a card has exactly one shallow effect. */
export declare function normalizeCompactEffectEntries(value: unknown): unknown[] | null;
export declare function isCompactEffectList(value: unknown): boolean;
export declare function compactEffectOperationKeys(value: Readonly<Record<string, unknown>>): string[];
export declare function sortCompactBundleOperations(operations: readonly string[]): string[];
export declare function compactOperationMetaKeys(operation: string): readonly string[];
export declare function compactBundleMetaKeys(operations: readonly string[]): Set<string>;
/** Project one bundled operation into the existing single-operation contract. */
export declare function projectCompactOperation(value: Readonly<Record<string, unknown>>, operation: string, includeControlFields?: boolean): Record<string, unknown>;
