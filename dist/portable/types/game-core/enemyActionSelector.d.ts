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
export declare const CANONICAL_ENEMY_ACTION_MODES: Set<string>;
/**
 * Canonicalize common model-authored aliases and fill mechanically obvious
 * action configuration from the action list. This keeps generated enemies
 * executable without changing their authored actions or weights.
 */
export declare function normalizeEnemyActionSelectionInput(enemy: any): {
    actionMode: string;
    actionConfig: Record<string, any>;
};
/** Select one action without mutating the enemy object or reading a global random source. */
export declare function selectEnemyAction(enemy: any, random: () => number): EnemyActionSelectionResult;
