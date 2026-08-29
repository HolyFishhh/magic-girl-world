import { stableHash32, stableSerialize } from './deterministicRandom';

const PRESENTATION_KEYS = new Set([
  'id',
  'name',
  'emoji',
  'rarity',
  'description',
  'narrate',
  'dialogue',
  'source',
  'notes',
  'title',
]);

function mechanicsOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mechanicsOnly);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PRESENTATION_KEYS.has(key))
      .map(([key, entry]) => [key, mechanicsOnly(entry)]),
  );
}

const STRUCTURAL_ENUMS = new Set([
  'Attack', 'Skill', 'Power', 'Event', 'Curse',
  'self', 'opponent', 'player', 'enemy',
  'hand', 'draw', 'discard', 'exhaust', 'all', 'combat',
  'active', 'by_id', 'random', 'random_n', 'lowest_hp', 'highest_hp',
  'random', 'probability', 'sequence', 'sequence_then_probability',
  'turn_start', 'before_draw', 'after_draw', 'turn_end', 'battle_start',
  'card_played', 'attack_played', 'skill_played', 'power_played',
  'on_discard', 'on_exhaust', 'on_draw', 'on_shuffle', 'take_damage', 'deal_damage',
  'apply', 'stack', 'tick', 'remove', 'hold', 'passive',
  'replay', 'free', 'retain_hand', 'retain_block', 'limit_draw', 'limit_block_gain',
  'limit_energy_gain', 'deny_card_play', 'allow_card_play', 'limit_card_play', 'card_destination',
  'resolution', 'turn', 'until_played', 'run', 'permanent',
  'instance', 'run_instance', 'template', 'filter',
  'enchantment', 'affliction', 'generated', 'copied', 'transformed', 'deck',
  'add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max',
]);

const STRUCTURAL_REFERENCE_KEYS = new Set([
  'apply_status', 'remove_status', 'template_id', 'run_instance_id', 'combat_instance_id',
  'orb_id', 'tag', 'slot', 'resource', 'status',
]);

function structuralString(value: string, key = ''): string {
  if (STRUCTURAL_ENUMS.has(value)) return value;
  let normalized = value
    .replace(/(?:self|opponent)\.status\.[A-Za-z][A-Za-z0-9_]*\.stacks/g, '$&'.replace(/[A-Za-z][A-Za-z0-9_]*(?=\.stacks$)/, '@'))
    .replace(/((?:self|opponent)\.status\.)[A-Za-z][A-Za-z0-9_]*/g, '$1@')
    .replace(/((?:x_resource|self\.resource|opponent\.resource)\.)[A-Za-z][A-Za-z0-9_]*/g, '$1@')
    .replace(/\b\d+(?:\.\d+)?\b/g, '#');
  if (STRUCTURAL_REFERENCE_KEYS.has(key) && /^[A-Za-z][A-Za-z0-9_]*$/.test(normalized)) return '@ref';
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(normalized) && !STRUCTURAL_ENUMS.has(normalized)) return '@id';
  return normalized;
}

function structuralMechanics(value: unknown, key = ''): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) return '#';
  if (typeof value === 'string') return structuralString(value, key);
  if (Array.isArray(value)) return value.map(entry => structuralMechanics(entry, key));
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  if (key === 'probability') {
    return Object.values(source)
      .map(entry => structuralMechanics(entry, key))
      .sort((left, right) => stableSerialize(left).localeCompare(stableSerialize(right)));
  }
  return Object.fromEntries(
    Object.entries(source)
      .filter(([entryKey]) => !PRESENTATION_KEYS.has(entryKey))
      .map(([entryKey, entry]) => [entryKey, structuralMechanics(entry, entryKey)]),
  );
}

/** Stable signature whose value is unchanged by names, prose, emoji, or narrative source labels. */
export function createContentMechanicsFingerprint(value: unknown): string {
  const serialized = stableSerialize(mechanicsOnly(value));
  return `mechanics1:${stableHash32(serialized).toString(36)}:${serialized.length}`;
}

/** Coarser signature for finding reskins and number-only variants of the same authored structure. */
export function createContentStructuralFingerprint(value: unknown): string {
  const serialized = stableSerialize(structuralMechanics(value));
  return `structure1:${stableHash32(serialized).toString(36)}:${serialized.length}`;
}

export function createContentFingerprintPair(value: unknown): { exact: string; structural: string } {
  return {
    exact: createContentMechanicsFingerprint(value),
    structural: createContentStructuralFingerprint(value),
  };
}
