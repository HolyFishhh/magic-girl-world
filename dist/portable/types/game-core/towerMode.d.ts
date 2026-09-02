export declare const GAME_MODE_LOCK_SCHEMA_VERSION: 1;
export declare const GAME_MODES: readonly ["story", "tower"];
export type GameMode = (typeof GAME_MODES)[number];
export type GameModeInput = GameMode | 'expedition';
export interface GameModeLock {
    schemaVersion: typeof GAME_MODE_LOCK_SCHEMA_VERSION;
    mode: GameMode;
}
/** Map the retired expedition name onto the canonical tower mode. */
export declare function normalizeGameMode(value: unknown): GameMode | null;
/** Read only an explicit program lock; legacy fields are deliberately not treated as a lock. */
export declare function readGameModeLock(statValue: unknown): GameModeLock | null;
/**
 * Resolve the effective mode without consulting chat text.
 * A lock always wins; an unlocked valid old run migrates to tower, followed by
 * the retired expedition value. Old chats without either remain story mode.
 */
export declare function readGameMode(statValue: unknown): GameMode;
/**
 * Lock a new game exactly once. Repeated calls only repair the canonical
 * mirrors and can never change the already locked mode.
 */
export declare function lockGameModeInStat(statValue: unknown, requestedMode: GameModeInput): GameModeLock;
/** Lock and canonicalize an old save using program-owned state only. */
export declare function migrateGameModeInStat(statValue: unknown): GameModeLock;
