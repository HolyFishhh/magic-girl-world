export declare const COMPACT_EFFECT_META_KEYS: readonly ["to", "targets", "when", "on", "stacks", "hits", "damage_type", "bypass_block", "lifesteal", "threshold_mode", "exclude_tags", "trigger_fatal", "from", "pick", "count", "add", "subtract", "multiply", "divide", "set", "limit", "extra", "scope", "match", "future_copies", "timing", "minimum", "maximum", "enabled", "min", "max", "name", "card_type", "rarity", "cost", "min_cost", "max_cost", "tag", "template_id", "run_instance_id", "combat_instance_id", "origin", "upgraded", "root_only", "include_copies", "phase", "priority", "repeat_every", "repeats", "effects", "free", "destination", "position", "options", "changes", "levels", "max_level", "orb_id", "resources"];
export declare const COMPACT_EFFECT_META_KEY_SET: Set<string>;
/**
 * Stable expansion order for an unordered JSON effect bundle.
 * Authors must use separate array entries when one effect depends on another.
 */
export declare const COMPACT_EFFECT_BUNDLE_OPERATIONS: readonly ["damage", "heal", "block", "energy", "lust", "apply_status", "remove_status", "draw"];
export type CompactEffectBundleOperation = (typeof COMPACT_EFFECT_BUNDLE_OPERATIONS)[number];
export declare const COMPACT_EFFECT_BUNDLE_OPERATION_SET: Set<string>;
/**
 * One auxiliary card-zone operation may accompany a common shallow bundle.
 * Its position is deterministic (after common operations), so the adapter can
 * split the object internally without guessing author intent.
 */
export declare const COMPACT_EFFECT_SAFE_AUXILIARY_BUNDLE_OPERATION_SET: Set<string>;
/** AI may omit the array wrapper when a card has exactly one shallow effect. */
export declare function normalizeCompactEffectEntries(value: unknown): unknown[] | null;
export declare function isCompactEffectList(value: unknown): boolean;
/**
 * Tolerate the common compact-model shape `{ name?, damage, ... }` at the runtime boundary.
 * The authored contract remains `{ name, effects }`; this only prevents a valid shallow
 * effect from making a battle unplayable before the repair pass can canonicalize it.
 */
export declare function normalizeCompactNamedEffectInput(value: unknown, fallbackName: string): unknown;
export declare function compactEffectOperationKeys(value: Readonly<Record<string, unknown>>): string[];
export declare function sortCompactBundleOperations(operations: readonly string[]): string[];
export declare function compactOperationMetaKeys(operation: string): readonly string[];
export declare function compactBundleMetaKeys(operations: readonly string[]): Set<string>;
/** Project one bundled operation into the existing single-operation contract. */
export declare function projectCompactOperation(value: Readonly<Record<string, unknown>>, operation: string, includeControlFields?: boolean): Record<string, unknown>;
