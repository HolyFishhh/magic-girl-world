export const GAME_MODE_LOCK_SCHEMA_VERSION = 1 as const;

export const GAME_MODES = ['story', 'tower'] as const;
export type GameMode = (typeof GAME_MODES)[number];
export type GameModeInput = GameMode;

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

/** Only the current public mode names are accepted. */
export function normalizeGameMode(value: unknown): GameMode | null {
  if (value === 'story') return 'story';
  if (value === 'tower') return 'tower';
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

/** Read the current lock or explicit mode without inferring from saved route content. */
export function readGameMode(statValue: unknown): GameMode {
  const stat = asRecord(statValue);
  if (!stat) return 'story';
  const lock = readGameModeLock(stat);
  if (lock) return lock.mode;
  if (stat.game_mode === 'expedition' || asRecord(stat.game_mode_lock)?.mode === 'expedition') {
    throw new Error('此旧版模式存档不受支持，请使用1.0.3角色卡新开局；原存档未修改。');
  }
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

/** Synchronize current mode mirrors without converting retired modes or guessing from a run. */
export function synchronizeGameModeInStat(statValue: unknown): GameModeLock {
  const stat = requireStatRecord(statValue);
  const existing = readGameModeLock(stat);
  return persistCanonicalLock(stat, existing?.mode ?? readGameMode(stat));
}
