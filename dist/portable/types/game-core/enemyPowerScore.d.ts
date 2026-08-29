import { type ContentPack } from './contentPack';
export declare const ENEMY_POWER_SCORE_SPEC: "mwg.enemy-power/v1";
export interface EnemyPowerDimensions {
    durability: number;
    pressure: number;
    control: number;
    scaling: number;
    complexity: number;
    volatility: number;
}
export interface EnemyActionPressure {
    id: string;
    name: string;
    probability: number;
    damage: number;
    lust: number;
    block: number;
    heal: number;
    mechanics: string[];
}
export interface EnemyPowerScore {
    spec: typeof ENEMY_POWER_SCORE_SPEC;
    fingerprint: string;
    /** Full-health authored strength, comparable with DeckPowerScore.totalScore. */
    totalScore: number;
    /** Same enemy at the HP/lust state supplied by the story. */
    currentEncounterScore: number;
    dimensions: EnemyPowerDimensions;
    enemyCount: number;
    maxHp: number;
    currentHp: number;
    expectedDamagePerTurn: number;
    expectedLustPerTurn: number;
    expectedBlockPerTurn: number;
    peakDamage: number;
    actions: EnemyActionPressure[];
    confidence: 'low' | 'medium' | 'high';
    coverage: number;
    reasons: string[];
}
/** Score authored enemy strength without mutating or repairing the generated definition. */
export declare function scoreEnemyPower(pack: ContentPack): EnemyPowerScore | null;
export declare function clearEnemyPowerScoreCache(): void;
