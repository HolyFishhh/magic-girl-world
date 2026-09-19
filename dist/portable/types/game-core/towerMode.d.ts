export declare const GAME_MODE_LOCK_SCHEMA_VERSION: 1;
export declare const GAME_MODES: readonly ["story", "tower"];
export type GameMode = (typeof GAME_MODES)[number];
export type GameModeInput = GameMode;
export interface GameModeLock {
    schemaVersion: typeof GAME_MODE_LOCK_SCHEMA_VERSION;
    mode: GameMode;
}
/** Only the current public mode names are accepted. */
export declare function normalizeGameMode(value: unknown): GameMode | null;
/** Read only an explicit program lock; legacy fields are deliberately not treated as a lock. */
export declare function readGameModeLock(statValue: unknown): GameModeLock | null;
/** Read the current lock or explicit mode without inferring from saved route content. */
export declare function readGameMode(statValue: unknown): GameMode;
/**
 * Lock a new game exactly once. Repeated calls only repair the canonical
 * mirrors and can never change the already locked mode.
 */
export declare function lockGameModeInStat(statValue: unknown, requestedMode: GameModeInput): GameModeLock;
/** Synchronize current mode mirrors without converting retired modes or guessing from a run. */
export declare function synchronizeGameModeInStat(statValue: unknown): GameModeLock;
