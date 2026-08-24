export const COMPACT_EFFECT_META_KEYS = [
  'to',
  'when',
  'on',
  'stacks',
  'hits',
  'from',
  'pick',
  'count',
  'add',
  'subtract',
  'multiply',
  'divide',
  'set',
] as const;

export const COMPACT_EFFECT_META_KEY_SET = new Set<string>(COMPACT_EFFECT_META_KEYS);

/**
 * Stable expansion order for an unordered JSON effect bundle.
 * Authors must use separate array entries when one effect depends on another.
 */
export const COMPACT_EFFECT_BUNDLE_OPERATIONS = [
  'damage',
  'heal',
  'block',
  'energy',
  'lust',
  'apply_status',
  'remove_status',
  'draw',
] as const;

export type CompactEffectBundleOperation = (typeof COMPACT_EFFECT_BUNDLE_OPERATIONS)[number];

export const COMPACT_EFFECT_BUNDLE_OPERATION_SET = new Set<string>(COMPACT_EFFECT_BUNDLE_OPERATIONS);

/** AI may omit the array wrapper when a card has exactly one shallow effect. */
export function normalizeCompactEffectEntries(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') return [value];
  return null;
}

export function isCompactEffectList(value: unknown): boolean {
  return normalizeCompactEffectEntries(value) !== null;
}

const OPERATION_META_KEYS: Readonly<Record<string, readonly string[]>> = {
  damage: ['hits', 'to', 'when', 'on'],
  heal: ['to', 'when', 'on'],
  block: ['to', 'when', 'on'],
  energy: ['to', 'when', 'on'],
  lust: ['to', 'when', 'on'],
  set_hp: ['to', 'when', 'on'],
  set_lust: ['to', 'when', 'on'],
  set_energy: ['to', 'when', 'on'],
  set_block: ['to', 'when', 'on'],
  narrate: ['when', 'on'],
  apply_status: ['stacks', 'to', 'when', 'on'],
  remove_status: ['to', 'when', 'on'],
  draw: ['when', 'on'],
  scry: ['when', 'on'],
  seek: ['when', 'on'],
  discard: ['from', 'pick', 'when', 'on'],
  exhaust: ['from', 'pick', 'when', 'on'],
  recover: ['from', 'pick', 'when', 'on'],
  reduce_cost: ['from', 'pick', 'count', 'when', 'on'],
  copy: ['from', 'pick', 'when', 'on'],
  double: ['from', 'pick', 'when', 'on'],
  add_card: ['to', 'count', 'when', 'on'],
  modify: ['add', 'subtract', 'multiply', 'divide', 'set', 'to'],
};

export function compactEffectOperationKeys(value: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(value).filter(key => !COMPACT_EFFECT_META_KEY_SET.has(key));
}

export function sortCompactBundleOperations(operations: readonly string[]): string[] {
  const rank = new Map<string, number>(COMPACT_EFFECT_BUNDLE_OPERATIONS.map((operation, index) => [operation, index]));
  return [...operations].sort(
    (left, right) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function compactOperationMetaKeys(operation: string): readonly string[] {
  return OPERATION_META_KEYS[operation] ?? [];
}

export function compactBundleMetaKeys(operations: readonly string[]): Set<string> {
  const result = new Set<string>(['when', 'on']);
  operations.forEach(operation => compactOperationMetaKeys(operation).forEach(key => result.add(key)));
  return result;
}

/** Project one bundled operation into the existing single-operation contract. */
export function projectCompactOperation(
  value: Readonly<Record<string, unknown>>,
  operation: string,
  includeControlFields = true,
): Record<string, unknown> {
  const result: Record<string, unknown> = { [operation]: value[operation] };
  compactOperationMetaKeys(operation).forEach(key => {
    if (!includeControlFields && (key === 'when' || key === 'on')) return;
    if (value[key] !== undefined) result[key] = value[key];
  });
  return result;
}
