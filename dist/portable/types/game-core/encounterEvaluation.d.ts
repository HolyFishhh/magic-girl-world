/** Public evidence from the production battle engine, not a second effect interpreter. */
export declare const ENCOUNTER_EVALUATION_SPEC: "mwg.encounter-evaluation/v1";
export type EncounterPolicy = 'tempo' | 'survival' | 'engine';
export interface EncounterTrial {
    seed: number;
    policy: EncounterPolicy;
    outcome: 'victory' | 'defeat' | 'terminated' | 'horizon' | 'inconclusive';
    turns: number;
    hpRemaining: number;
    lustRemaining: number;
    netLustGained: number;
    conditionLoss: number;
    netHpLost: number;
    hpLost: number;
    damageDealt: number;
    lustDealt?: number;
    /** Observed at the end of each player action phase, before turn-end expiry. */
    statusUptime?: {
        id: string;
        name: string;
        turns: number;
    }[];
    blocked: number;
    /** Actual intercepted damage suffered by allied summons, not equivalent player damage prevented. */
    summonHpLost?: number;
    summonBlocked?: number;
    summonHpRemaining?: number;
    cardsPlayed: number;
    deadTurns: number;
    decisions: number;
    defensiveChoices: number;
    killOrder: string[];
    horizons: {
        turn: number;
        damage: number;
        hpLost: number;
        blocked: number;
        hpRemaining?: number;
        summonHpLost?: number;
        summonBlocked?: number;
        summonHpRemaining?: number;
    }[];
    limitations: string[];
    decisionCoverage: 'bounded' | 'limited';
}
export interface EncounterPolicySummary {
    policy: EncounterPolicy;
    completed: number;
    wins: number;
    winRate: number;
    winRateInterval: [number, number];
    medianTurns: number;
    medianHpLost: number;
    medianNetHpLost: number;
    medianNetLustGained: number;
    medianConditionLoss: number;
    firstTurnWins: number;
    deadTurnRate: number;
}
export interface EncounterEvaluation {
    spec: typeof ENCOUNTER_EVALUATION_SPEC;
    engine: 'production-battle-runtime';
    status: 'measured' | 'inconclusive';
    decisionCoverage: 'bounded' | 'limited';
    seeds: number[];
    policies: EncounterPolicySummary[];
    trials: EncounterTrial[];
    limitations: string[];
}
export declare function evaluationMedian(values: readonly number[]): number;
export declare function summarizeEncounterEvaluation(trials: EncounterTrial[], seeds: number[]): EncounterEvaluation;
