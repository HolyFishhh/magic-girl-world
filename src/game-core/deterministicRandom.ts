export const BATTLE_RANDOM_SCHEMA_VERSION = 1 as const;

export interface BattleRandomState {
  schemaVersion: typeof BATTLE_RANDOM_SCHEMA_VERSION;
  seed: number;
  cursor: number;
}

const UINT32_MAX = 0xffffffff;

function requireUint32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(`${name} must be an unsigned 32-bit integer`);
  }
  return value >>> 0;
}

export function createBattleRandomState(seed: number, cursor = 0): BattleRandomState {
  return {
    schemaVersion: BATTLE_RANDOM_SCHEMA_VERSION,
    seed: requireUint32(seed, 'seed'),
    cursor: requireUint32(cursor, 'cursor'),
  };
}

export function isBattleRandomState(value: unknown): value is BattleRandomState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    state.schemaVersion === BATTLE_RANDOM_SCHEMA_VERSION &&
    Number.isInteger(state.seed) &&
    Number(state.seed) >= 0 &&
    Number(state.seed) <= UINT32_MAX &&
    Number.isInteger(state.cursor) &&
    Number(state.cursor) >= 0 &&
    Number(state.cursor) <= UINT32_MAX
  );
}

function mixUint32(seed: number, cursor: number): number {
  let value = (seed + Math.imul(cursor + 1, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

/** Draw one deterministic unit value and return the advanced immutable state. */
export function drawBattleRandom(state: BattleRandomState): { value: number; state: BattleRandomState } {
  if (!isBattleRandomState(state)) throw new Error('battle random state is invalid');
  if (state.cursor === UINT32_MAX) throw new Error('battle random cursor exhausted');
  return {
    value: mixUint32(state.seed, state.cursor) / (UINT32_MAX + 1),
    state: { ...state, cursor: state.cursor + 1 },
  };
}

export function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'undefined':
    case 'function':
    case 'symbol':
      return 'null';
  }

  if (seen.has(value)) throw new TypeError('Cannot serialize cyclic data');
  seen.add(value);
  const serialized = Array.isArray(value)
    ? `[${value.map(item => stableSerialize(item, seen)).join(',')}]`
    : `{${Object.keys(value)
        .sort()
        .filter(key => !['undefined', 'function', 'symbol'].includes(typeof (value as Record<string, unknown>)[key]))
        .map(key => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key], seen)}`)
        .join(',')}}`;
  seen.delete(value);
  return serialized;
}

export function stableHash32(value: unknown): number {
  const serialized = typeof value === 'string' ? value : stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
