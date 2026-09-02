import type { RunNodeCounts, RunState } from './runState';
export declare const TOWER_FINALE_SCHEMA_VERSION: 1;
export declare const TOWER_SHARE_SCHEMA: "mwg.tower-run-share/v1";
export interface TowerFinale {
    schemaVersion: typeof TOWER_FINALE_SCHEMA_VERSION;
    fishEmoji: '🐟';
    fishLine: string;
    playerLine: string;
    damage: number;
    defeatedEnemyScore: number;
    averageDifficultyPercent: number;
}
export interface TowerRunShareSnapshot {
    spec: typeof TOWER_SHARE_SCHEMA;
    runSchemaVersion: number;
    seed: number;
    acts: number;
    floorsPerAct: number;
    visitedNodeIds: string[];
    nodeCounts: RunNodeCounts;
    score: {
        defeatedEnemyScore: number;
        averageDifficultyPercent: number;
        encounters: Array<{
            nodeId: string;
            act: number;
            floor: number;
            playerDeckScore: number;
            enemyScore: number;
            relativeDifficulty: number;
        }>;
    };
}
/** Deterministic final scene; reopening a completed save never changes its lines. */
export declare function createTowerFinale(run: RunState): TowerFinale;
/**
 * Stable, JSON-only handoff for a future export/share feature. Generated prose,
 * private chat context and player profile are intentionally excluded.
 */
export declare function createTowerRunShareSnapshot(run: RunState): TowerRunShareSnapshot;
