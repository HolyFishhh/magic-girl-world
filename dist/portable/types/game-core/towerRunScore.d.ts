export declare const TOWER_SCORE_SCHEMA_VERSION: 1;
export type TowerEncounterOutcome = 'victory' | 'defeat' | 'escaped';
export interface TowerEncounterScoreRecord {
    nodeId: string;
    act: number;
    floor: number;
    playerDeckScore: number;
    enemyScore: number;
    relativeDifficulty: number;
    outcome: TowerEncounterOutcome;
}
export interface TowerRunScore {
    schemaVersion: typeof TOWER_SCORE_SCHEMA_VERSION;
    encounters: TowerEncounterScoreRecord[];
    defeatedEnemyScore: number;
    averageDifficultyRatio: number;
    averageDifficultyPercent: number;
}
export interface RecordTowerEncounterInput {
    nodeId: string;
    act: number;
    floor: number;
    playerDeckScore: number;
    enemyScore: number;
    outcome: TowerEncounterOutcome;
}
export declare function createTowerRunScore(): TowerRunScore;
/**
 * Store the immutable pre-battle player/enemy score snapshot used by the final
 * two-axis result. Current HP deliberately does not belong to this contract.
 */
export declare function recordTowerEncounter(current: TowerRunScore, input: RecordTowerEncounterInput): TowerRunScore;
export declare function validateTowerRunScore(value: unknown): value is TowerRunScore;
