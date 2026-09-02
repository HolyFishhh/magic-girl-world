import { validateRunState } from './runState';

export const GAME_MODE_LOCK_SCHEMA_VERSION = 1 as const;

export const GAME_MODES = ['story', 'tower'] as const;
export type GameMode = (typeof GAME_MODES)[number];
export type GameModeInput = GameMode | 'expedition';

export interface GameModeLock {
  schemaVersion: typeof GAME_MODE_LOCK_SCHEMA_VERSION;
  mode: GameMode;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function requireStatRecord(value: unknown): Record<string, any> {
  const stat = asRecord(value);
  if (!stat) throw new Error('stat_data is unavailable');
  return stat;
}

/** Map the retired expedition name onto the canonical tower mode. */
export function normalizeGameMode(value: unknown): GameMode | null {
  if (value === 'story') return 'story';
  if (value === 'tower' || value === 'expedition') return 'tower';
  return null;
}

/** Read only an explicit program lock; legacy fields are deliberately not treated as a lock. */
export function readGameModeLock(statValue: unknown): GameModeLock | null {
  const stat = asRecord(statValue);
  const rawLock = asRecord(stat?.game_mode_lock);
  if (!rawLock || rawLock.schemaVersion !== GAME_MODE_LOCK_SCHEMA_VERSION) return null;
  const mode = normalizeGameMode(rawLock.mode);
  return mode ? { schemaVersion: GAME_MODE_LOCK_SCHEMA_VERSION, mode } : null;
}

function hasValidLegacyRun(stat: Record<string, any>): boolean {
  return validateRunState(stat.run).ok;
}

/**
 * Resolve the effective mode without consulting chat text.
 * A lock always wins; an unlocked valid old run migrates to tower, followed by
 * the retired expedition value. Old chats without either remain story mode.
 */
export function readGameMode(statValue: unknown): GameMode {
  const stat = asRecord(statValue);
  if (!stat) return 'story';
  const lock = readGameModeLock(stat);
  if (lock) return lock.mode;
  if (hasValidLegacyRun(stat)) return 'tower';
  return normalizeGameMode(stat.game_mode) ?? 'story';
}

function persistCanonicalLock(stat: Record<string, any>, mode: GameMode): GameModeLock {
  const lock: GameModeLock = { schemaVersion: GAME_MODE_LOCK_SCHEMA_VERSION, mode };
  stat.game_mode = mode;
  stat.game_mode_lock = lock;
  if (mode === 'story') stat.run = null;
  return lock;
}

/**
 * Lock a new game exactly once. Repeated calls only repair the canonical
 * mirrors and can never change the already locked mode.
 */
export function lockGameModeInStat(statValue: unknown, requestedMode: GameModeInput): GameModeLock {
  const stat = requireStatRecord(statValue);
  const existing = readGameModeLock(stat);
  if (existing) return persistCanonicalLock(stat, existing.mode);
  const mode = normalizeGameMode(requestedMode);
  if (!mode) throw new Error(`unsupported game mode: ${String(requestedMode)}`);
  return persistCanonicalLock(stat, mode);
}

/** Lock and canonicalize an old save using program-owned state only. */
export function migrateGameModeInStat(statValue: unknown): GameModeLock {
  const stat = requireStatRecord(statValue);
  const existing = readGameModeLock(stat);
  return persistCanonicalLock(stat, existing?.mode ?? readGameMode(stat));
}
