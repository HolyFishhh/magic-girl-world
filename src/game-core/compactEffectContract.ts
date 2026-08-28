export const COMPACT_EFFECT_META_KEYS = [
  'to',
  'targets',
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
  'limit',
  'extra',
  'scope',
  'match',
  'future_copies',
  'timing',
  'minimum',
  'maximum',
  'enabled',
  'min',
  'max',
  'card_type',
  'rarity',
  'cost',
  'min_cost',
  'max_cost',
  'tag',
  'template_id',
  'run_instance_id',
  'combat_instance_id',
  'origin',
  'upgraded',
  'phase',
  'priority',
  'repeat_every',
  'repeats',
  'effects',
  'free',
  'destination',
  'position',
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

/**
 * One auxiliary card-zone operation may accompany a common shallow bundle.
 * Its position is deterministic (after common operations), so the adapter can
 * split the object internally without guessing author intent.
 */
export const COMPACT_EFFECT_SAFE_AUXILIARY_BUNDLE_OPERATION_SET = new Set<string>(['scry', 'seek']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalize one frequent model deviation without weakening status validation:
 * `{apply_status:{id,stacks,to}}` carries the same unambiguous information as
 * the canonical shallow sibling fields. Unknown nested keys and conflicting
 * outer values stay untouched so the compiler still rejects ambiguous input.
 */
function normalizeNestedStatusInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  let normalized = value;
  for (const operation of ['apply_status', 'remove_status'] as const) {
    const nested = value[operation];
    if (!isRecord(nested) || typeof nested.id !== 'string') continue;
    const transferable = operation === 'apply_status' ? ['stacks', 'to', 'targets'] : ['to', 'targets'];
    const allowed = new Set(['id', ...transferable]);
    if (Object.keys(nested).some(key => !allowed.has(key))) continue;
    if (
      transferable.some(
        key => value[key] !== undefined && nested[key] !== undefined && value[key] !== nested[key],
      )
    ) {
      continue;
    }
    if (normalized === value) normalized = { ...value };
    normalized[operation] = nested.id;
    transferable.forEach(key => {
      if (normalized[key] === undefined && nested[key] !== undefined) normalized[key] = nested[key];
    });
  }
  return normalized;
}

/** AI may omit the array wrapper when a card has exactly one shallow effect. */
export function normalizeCompactEffectEntries(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value.map(normalizeNestedStatusInput);
  if (value !== null && typeof value === 'object') return [normalizeNestedStatusInput(value)];
  return null;
}

export function isCompactEffectList(value: unknown): boolean {
  return normalizeCompactEffectEntries(value) !== null;
}

const NAMED_EFFECT_PRESENTATION_KEYS = new Set(['name', 'emoji', 'description', 'creates']);

/**
 * Tolerate the common compact-model shape `{ name?, damage, ... }` at the runtime boundary.
 * The authored contract remains `{ name, effects }`; this only prevents a valid shallow
 * effect from making a battle unplayable before the repair pass can canonicalize it.
 */
export function normalizeCompactNamedEffectInput(value: unknown, fallbackName: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(source, 'effects')) return value;

  const effects = Object.fromEntries(
    Object.entries(source).filter(([key]) => !NAMED_EFFECT_PRESENTATION_KEYS.has(key)),
  );
  if (Object.keys(effects).length === 0) return value;

  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : fallbackName;
  const normalized: Record<string, unknown> = { name };
  for (const key of ['emoji', 'description', 'creates'] as const) {
    if (source[key] !== undefined) normalized[key] = source[key];
  }
  normalized.effects = effects;
  return normalized;
}

const OPERATION_META_KEYS: Readonly<Record<string, readonly string[]>> = {
  damage: ['hits', 'to', 'targets', 'when', 'on'],
  heal: ['to', 'targets', 'when', 'on'],
  block: ['to', 'targets', 'when', 'on'],
  energy: ['to', 'targets', 'when', 'on'],
  lust: ['to', 'targets', 'when', 'on'],
  set_hp: ['to', 'targets', 'when', 'on'],
  set_lust: ['to', 'targets', 'when', 'on'],
  set_energy: ['to', 'targets', 'when', 'on'],
  set_block: ['to', 'targets', 'when', 'on'],
  narrate: ['when', 'on'],
  apply_status: ['stacks', 'to', 'targets', 'when', 'on'],
  remove_status: ['to', 'targets', 'when', 'on'],
  draw: ['when', 'on'],
  scry: ['when', 'on'],
  seek: ['when', 'on'],
  discard: ['from', 'pick', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when', 'on'],
  exhaust: ['from', 'pick', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when', 'on'],
  recover: ['from', 'pick', 'when', 'on'],
  reduce_cost: ['from', 'pick', 'count', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when', 'on'],
  modify_card: ['from', 'pick', 'count', 'add', 'subtract', 'multiply', 'divide', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when', 'on'],
  patch_card: ['from', 'pick', 'count', 'add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max', 'extra', 'enabled', 'scope', 'match', 'future_copies', 'timing', 'minimum', 'maximum', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when', 'on'],
  copy: ['from', 'pick', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when', 'on'],
  double: ['from', 'pick', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when', 'on'],
  add_card: ['to', 'count', 'when', 'on'],
  modify: ['add', 'subtract', 'multiply', 'divide', 'set', 'to', 'targets'],
  card_rule: ['limit', 'extra', 'to'],
  schedule: ['phase', 'priority', 'repeat_every', 'repeats', 'effects', 'when'],
  auto_play: ['from', 'pick', 'count', 'free', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when'],
  card_destination: ['when'],
  move_card: ['from', 'pick', 'count', 'destination', 'position', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when'],
  remove_card: ['from', 'pick', 'count', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when'],
  transform_card: ['from', 'pick', 'count', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'when'],
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
