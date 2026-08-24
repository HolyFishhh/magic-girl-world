import type { GameState } from './battleState';
export declare const BATTLE_SESSION_SCHEMA_VERSION: 3;
export interface BattleSessionSnapshot {
    schemaVersion: typeof BATTLE_SESSION_SCHEMA_VERSION;
    fingerprint: string;
    state: GameState;
    savedAt: number;
}
/** Create a stable identity for an AI content payload without reading host state. */
export declare function createBattleFingerprint(battleData: unknown): string;
export declare function createBattleSessionSnapshot(fingerprint: string, state: GameState, savedAt: number): BattleSessionSnapshot;
/** Strictly read one host-neutral snapshot value. Storage layout belongs to the host adapter. */
export declare function readBattleSessionSnapshot(value: unknown): BattleSessionSnapshot | null;
export declare function canRestoreBattleSession(snapshot: BattleSessionSnapshot | null, fingerprint: string): snapshot is BattleSessionSnapshot;
