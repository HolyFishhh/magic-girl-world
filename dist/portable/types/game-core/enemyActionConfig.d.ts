export interface EnemyActionLike {
    id?: string;
    name: string;
    effectProgram?: unknown;
    description?: string;
    weight?: number;
    [key: string]: any;
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
