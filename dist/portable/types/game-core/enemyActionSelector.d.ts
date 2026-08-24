export interface EnemyActionLike {
    name: string;
    effectProgram?: unknown;
    description?: string;
    weight?: number;
    [key: string]: any;
}
export interface EnemyActionSelectionState {
    sequenceIndex: number;
    sequenceDoneOnce: boolean;
}
export interface EnemyActionSelectionResult {
    action: EnemyActionLike | null;
    state: EnemyActionSelectionState;
    mode: string;
}
/** Select one action without mutating the enemy object or reading a global random source. */
export declare function selectEnemyAction(enemy: any, random: () => number): EnemyActionSelectionResult;
