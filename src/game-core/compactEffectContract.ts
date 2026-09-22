/** Shared by compilation and bounded repair so filters survive both paths. */
export const COMPACT_CARD_SELECTOR_FILTER_KEYS = [
  'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id',
  'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'keyword', 'exclude_keyword', 'root_only',
] as const;
export const COMPACT_CARD_SELECTOR_INPUT_KEYS = ['from', 'pick', ...COMPACT_CARD_SELECTOR_FILTER_KEYS] as const;

export const COMPACT_EFFECT_META_KEYS = [
  'id',
  'to',
  'targets',
  'when',
  'on',
  'stacks',
  'hits',
  'damage_type',
  'bypass_block',
  'lifesteal',
  'threshold_mode',
  'exclude_tags',
  'trigger_fatal',
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
  'name',
  'name_contains',
  'card_type',
  'rarity',
  'cost',
  'min_cost',
  'max_cost',
  'tag',
  'template_id',
  'summon_template',
  'run_instance_id',
  'combat_instance_id',
  'origin',
  'upgraded',
  'keyword',
  'exclude_keyword',
  'root_only',
  'include_copies',
  'phase',
  'priority',
  'repeat_every',
  'repeats',
  'effects',
  'free',
  'destination',
  'position',
  'options',
  'changes',
  'levels',
  'max_level',
  'orb_id',
  'resources',
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

const LEGACY_PATCH_CARD_META_KEYS = new Set([
  'from',
  'pick',
  'count',
  'scope',
  'match',
  'future_copies',
  'timing',
  'minimum',
  'maximum',
  'name',
  'name_contains',
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
  'root_only',
  'when',
]);

const LEGACY_PATCH_CARD_PAYLOAD_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  damage: new Set(['add', 'subtract', 'multiply', 'divide']),
  block: new Set(['add', 'subtract', 'multiply', 'divide']),
  lust: new Set(['add', 'subtract', 'multiply', 'divide']),
  stacks: new Set(['add', 'subtract', 'multiply', 'divide']),
  cost: new Set(['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max']),
  x_value: new Set(['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max']),
  dynamic_cost: new Set([
    'add',
    'subtract',
    'multiply',
    'divide',
    'set',
    'min',
    'max',
    'timing',
    'minimum',
    'maximum',
  ]),
  replay: new Set(['extra']),
  retain: new Set(['enabled']),
  exhaust: new Set(['enabled']),
  ethereal: new Set(['enabled']),
  innate: new Set(['enabled']),
};

const LEGACY_PATCH_CARD_ARITHMETIC_KEYS = new Set([
  'add',
  'subtract',
  'multiply',
  'divide',
  'set',
  'min',
  'max',
]);

function hasSingleLegacyPatchOperator(patchType: string, payload: Readonly<Record<string, unknown>>): boolean {
  if (['damage', 'block', 'lust', 'stacks'].includes(patchType)) {
    return ['add', 'subtract', 'multiply', 'divide'].filter(key => payload[key] !== undefined).length === 1;
  }
  if (['cost', 'x_value', 'dynamic_cost'].includes(patchType)) {
    return [...LEGACY_PATCH_CARD_ARITHMETIC_KEYS].filter(key => payload[key] !== undefined).length === 1;
  }
  if (patchType === 'replay') return payload.extra !== undefined;
  return typeof payload.enabled === 'boolean';
}

/**
 * Canonicalize one unambiguous model deviation:
 * `{patch_card:{damage:{add:1},scope:'combat',...}}` becomes the public shallow
 * shape `{patch_card:'damage',add:1,scope:'combat',...}`. Ambiguous patch kinds,
 * unknown nested fields, multiple operators, or conflicting outer fields remain
 * untouched and are rejected by the normal compiler.
 */
function normalizeNestedPatchCardInput(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.patch_card)) return value;
  const nested = value.patch_card;
  const patchTypes = Object.keys(nested).filter(key => !LEGACY_PATCH_CARD_META_KEYS.has(key));
  if (patchTypes.length !== 1) return value;

  const patchType = patchTypes[0];
  const payload = nested[patchType];
  const allowedPayloadKeys = LEGACY_PATCH_CARD_PAYLOAD_KEYS[patchType];
  if (!isRecord(payload) || !allowedPayloadKeys) return value;
  const payloadKeys = Object.keys(payload);
  if (
    payloadKeys.length === 0 ||
    payloadKeys.some(key => !allowedPayloadKeys.has(key)) ||
    !hasSingleLegacyPatchOperator(patchType, payload)
  ) {
    return value;
  }

  const flattened: Record<string, unknown> = { ...value, patch_card: patchType };
  const merge = (entries: Readonly<Record<string, unknown>>, ignoredKey?: string): boolean => {
    for (const [key, entry] of Object.entries(entries)) {
      if (key === ignoredKey) continue;
      if (flattened[key] !== undefined && flattened[key] !== entry) return false;
      flattened[key] = entry;
    }
    return true;
  };
  if (!merge(nested, patchType) || !merge(payload)) return value;
  return flattened;
}

const EFFECT_ITEM_PRESENTATION_KEYS = ['description', 'emoji'] as const;

/**
 * Models sometimes repeat display copy inside each executable effect entry.
 * Those fields do not change mechanics and already belong to the owning card,
 * status, relic, item, ability, or action. Strip only these unambiguous
 * presentation duplicates; an entry containing no real operation still fails
 * normal empty-effect validation.
 */
function normalizeEffectItemPresentation(value: unknown): unknown {
  if (!isRecord(value) || !EFFECT_ITEM_PRESENTATION_KEYS.some(key => key in value)) return value;
  const normalized = { ...value };
  EFFECT_ITEM_PRESENTATION_KEYS.forEach(key => delete normalized[key]);
  return normalized;
}

function normalizeCompactEffectInput(value: unknown): unknown {
  return normalizeNestedPatchCardInput(
    normalizeNestedStatusInput(
      normalizeEffectItemPresentation(value),
    ),
  );
}

/** AI may omit the array wrapper when a card has exactly one shallow effect. */
export function normalizeCompactEffectEntries(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value.map(normalizeCompactEffectInput);
  if (value !== null && typeof value === 'object') return [normalizeCompactEffectInput(value)];
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
  if (Object.prototype.hasOwnProperty.call(source, 'effects')) {
    // Desire effects are invoked only after the opposing desire meter has
    // already overflowed. Models sometimes repeat that fixed lifecycle guard
    // with the otherwise invalid bare expression `lust >= max_lust`. Removing
    // only this exact redundant guard is semantics-preserving; every other
    // authored condition remains intact and must pass the normal formula DSL.
    if (typeof source.when === 'string' && /^\s*lust\s*>=\s*max_lust\s*$/.test(source.when)) {
      const normalized = { ...source };
      delete normalized.when;
      return normalized;
    }
    return value;
  }

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
  damage: ['hits', 'damage_type', 'bypass_block', 'lifesteal', 'to', 'targets', 'when', 'on'],
  execute: ['threshold_mode', 'exclude_tags', 'trigger_fatal', 'to', 'targets', 'when', 'on'],
  kill: ['exclude_tags', 'trigger_fatal', 'to', 'targets', 'when', 'on'],
  heal: ['to', 'targets', 'when', 'on'],
  block: ['to', 'targets', 'when', 'on'],
  energy: ['to', 'targets', 'when', 'on'],
  resource: ['to', 'targets', 'when', 'on'],
  set_resource: ['to', 'targets', 'when', 'on'],
  lust: ['to', 'targets', 'when', 'on'],
  set_hp: ['to', 'targets', 'when', 'on'],
  set_lust: ['to', 'targets', 'when', 'on'],
  set_energy: ['to', 'targets', 'when', 'on'],
  set_block: ['to', 'targets', 'when', 'on'],
  persistent_growth: ['summon_template', 'add', 'subtract', 'set', 'when', 'on'],
  narrate: ['when', 'on'],
  apply_status: ['stacks', 'to', 'targets', 'when', 'on'],
  remove_status: ['to', 'targets', 'when', 'on'],
  draw: ['when', 'on'],
  scry: ['when', 'on'],
  seek: ['when', 'on'],
  discard: ['from', 'pick', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when', 'on'],
  exhaust: ['from', 'pick', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when', 'on'],
  recover: ['from', 'pick', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when', 'on'],
  reduce_cost: ['from', 'pick', 'count', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when', 'on'],
  modify_card: ['from', 'pick', 'count', 'add', 'subtract', 'multiply', 'divide', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when'],
  patch_card: ['from', 'pick', 'count', 'add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max', 'extra', 'enabled', 'scope', 'match', 'future_copies', 'timing', 'minimum', 'maximum', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when', 'on'],
  attach_card: ['from', 'pick', 'count', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when', 'on'],
  upgrade_card: ['from', 'pick', 'scope', 'levels', 'max_level', 'changes', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when', 'on'],
  copy: ['to', 'from', 'pick', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when', 'on'],
  double: ['from', 'pick', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when', 'on'],
  add_card: ['to', 'count', 'when', 'on'],
  ensure_card: ['to', 'minimum', 'include_copies', 'when', 'on'],
  modify: ['add', 'subtract', 'multiply', 'divide', 'set', 'to', 'targets', 'damage_type'],
  card_rule: ['limit', 'extra', 'to', 'destination', 'priority', 'resources', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only'],
  stance: ['to', 'targets', 'when'],
  channel_orb: ['to', 'targets', 'when'],
  spawn_summon: ['to', 'when'],
  spawn_enemy: ['when'],
  enemy_intent: ['when'],
  wait: ['when'],
  say: ['when'],
  damage_summon: ['when'],
  heal_summon: ['when'],
  modify_summon: ['when'],
  modify_summon_effect: ['when'],
  summon_resource: ['when'],
  set_summon_resource: ['when'],
  apply_summon_status: ['when'],
  remove_summon_status: ['when'],
  activate_summon: ['when'],
  trigger_summon_death: ['when'],
  dismiss_summon: ['when'],
  copy_summon: ['when'],
  summoner_effects: ['when'],
  evoke_orb: ['to', 'targets', 'pick', 'orb_id', 'when'],
  orb_slots: ['to', 'targets', 'when'],
  modify_orb: ['to', 'targets', 'pick', 'count', 'orb_id', 'add', 'subtract', 'multiply', 'divide', 'when'],
  extra_turn: ['to', 'when'],
  end_turn: ['to', 'when'],
  schedule: ['phase', 'priority', 'repeat_every', 'repeats', 'effects', 'when'],
  guard: ['effects'],
  auto_play: ['from', 'pick', 'free', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when'],
  replay_current: ['when'],
  card_destination: ['when'],
  move_card: ['from', 'pick', 'destination', 'position', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when'],
  remove_card: ['from', 'pick', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when'],
  transform_card: ['from', 'pick', 'count', 'name', 'name_contains', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag', 'id', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded', 'root_only', 'when'],
  choose: ['count', 'options', 'when', 'on'],
};

const CARD_SELECTOR_OPERATION_SET = new Set([
  'discard', 'exhaust', 'recover', 'reduce_cost', 'modify_card', 'patch_card', 'attach_card',
  'upgrade_card', 'copy', 'double', 'card_rule', 'auto_play', 'move_card', 'remove_card', 'transform_card',
]);
const CARD_KEYWORD_FILTER_META_KEYS = ['keyword', 'exclude_keyword'] as const;

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
  const base = OPERATION_META_KEYS[operation] ?? [];
  return CARD_SELECTOR_OPERATION_SET.has(operation)
    ? [...base, ...CARD_KEYWORD_FILTER_META_KEYS]
    : base;
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
