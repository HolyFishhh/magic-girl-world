export declare const BATTLE_RANDOM_SCHEMA_VERSION: 1;
export interface BattleRandomState {
    schemaVersion: typeof BATTLE_RANDOM_SCHEMA_VERSION;
    seed: number;
    cursor: number;
}
export declare function createBattleRandomState(seed: number, cursor?: number): BattleRandomState;
export declare function isBattleRandomState(value: unknown): value is BattleRandomState;
/** Draw one deterministic unit value and return the advanced immutable state. */
export declare function drawBattleRandom(state: BattleRandomState): {
    value: number;
    state: BattleRandomState;
};
export declare function stableSerialize(value: unknown, seen?: WeakSet<object>): string;
export declare function stableHash32(value: unknown): number;
