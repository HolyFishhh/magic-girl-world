import { type BuildBudget, type ContentDefinition, type ContentPack } from './contentPack';
import { type EnemyBudget } from './enemyBudget';
import { type EncounterShadowSimulation } from './encounterShadowSimulation';
import { type DeckPowerScore } from './deckPowerScore';
import { type EnemyPowerScore } from './enemyPowerScore';
import { type DifficultyBudget, type EnemyBalanceCalibration } from './difficultyBudget';
import { type DeckArchetypeProfile } from './archetypeGraph';
import { type RewardArchetypeDirection, type RewardArchetypePathKind, type RewardArchetypePlan } from './rewardArchetypePlanner';
import { type DeckPowerProfile } from './deckPowerProfile';
import { type EnemyBudgetEnvelope } from './encounterBalance';
import { type EncounterLineageMemory } from './encounterLineageMemory';
export declare const CONTENT_DESIGN_CONTEXT_SPEC: "mwg.content-design/v3";
export type DesignDiagnosticSeverity = 'critical' | 'risk' | 'advice';
export type EncounterChallengeBand = 'light' | 'fair' | 'tense' | 'severe' | 'unknown';
export type WinConditionProfile = '生命' | '欲望' | '混合' | '特殊';
export type EnemyPressureDimension = '爆发' | '消耗' | '成长' | '控制' | '资源' | '牌库污染' | '反应' | '阶段' | '群体' | '欲望';
export interface ContentDesignDiagnostic {
    code: string;
    severity: DesignDiagnosticSeverity;
    scope: 'build' | 'enemy' | 'encounter' | 'reward' | 'variety';
    message: string;
    suggestion: string;
}
export interface BuildDesignProfile {
    deckSize: number;
    winCondition: WinConditionProfile;
    engines: string[];
    tempo: '低' | '中' | '高';
    survival: '脆弱' | '有限' | '稳定' | '强韧';
    economy: '紧张' | '普通' | '充足';
    consistency: number;
    complexity: number;
    mechanicAxes: string[];
    enablers: string[];
    payoffs: string[];
    bridges: string[];
    resourceLoops: string[];
    riskHooks: string[];
    extensionHooks: string[];
}
export interface EnemyDesignProfile {
    signature: string;
    pressure: '生命' | '欲望' | '混合' | '控制' | '未知';
    dimensions: EnemyPressureDimension[];
    cadence: string;
    expectedDamage: number;
    expectedLust: number;
    expectedBlock: number;
    peakDamage: number;
    desireFinishDamage: number;
    actionDiversity: number;
    actionEntropy: number;
    maxActionProbability: number;
    complexity: number;
    counterplayWindow: boolean;
    enemyCount: number;
    roles: string[];
    synergies: string[];
    targetModes: string[];
    actionOrder: string[];
}
export interface EncounterForecast {
    challenge: EncounterChallengeBand;
    expectedVictoryTurns: number | null;
    expectedSurvivalTurns: number | null;
    targetTurns: [number, number];
    confidence: 'low' | 'medium' | 'high';
}
export interface RewardCandidateDesignProfile {
    id: string;
    fingerprint: string;
    structuralFingerprint: string;
    roles: string[];
    axes: string[];
    power: number;
    complexity: number;
    synergy: number;
    novelty: number;
    pathKind: RewardArchetypePathKind;
    deckScoreDelta: number;
    relativeDeckScoreDelta: number;
    candidatePowerScore: number;
    selectionValue: number;
    archetypes: Array<{
        id: string;
        label: string;
        score: number;
    }>;
    pathScores: Record<RewardArchetypePathKind, number>;
    dimensionGains: Record<string, number>;
}
export interface RewardChoiceDesignProfile {
    candidateCount: number;
    uniqueMechanics: number;
    uniqueStructures: number;
    distinctRoles: number;
    dominatedPairs: string[];
    candidates: RewardCandidateDesignProfile[];
}
export type RewardDesignDirection = RewardArchetypeDirection;
export type RewardDesignPlan = RewardArchetypePlan;
export interface EncounterDesignPlan {
    enemyCount: number;
    roles: string[];
    synergies: string[];
    targetModes: string[];
    actionOrder: string[];
    guidance: string[];
}
export interface BattleOutcomeFeedback {
    outcome: 'victory' | 'defeat' | 'terminated';
    turns: number;
    hpRatio: number;
    lustRatio: number;
}
export interface BattlePerformanceSummary {
    battles: number;
    ewmaWinRate: number;
    ewmaTurns: number;
    ewmaHpRatio: number;
    ewmaLustRatio: number;
    pressureFactor: number;
}
export interface ProgramEncounterCalibrationSummary {
    spec: 'mwg.encounter-calibration/v1';
    requestedRatio: number;
    effectiveRatio: number;
    appliedScale: number;
    winnableAtCurrentResources: boolean;
    confidence: number;
    changedPaths: string[];
    warnings: string[];
    enemyFingerprint: string;
}
export interface ContentDesignContext {
    spec: typeof CONTENT_DESIGN_CONTEXT_SPEC;
    fingerprint: string;
    build: BuildDesignProfile;
    brief: string;
    recentEnemySignatures: string[];
    recentRewardStructures: string[];
    rewardPlan: RewardDesignPlan;
    settings: {
        difficultyPercent: number;
        autoCalibration: boolean;
    };
    balance: {
        deck: DeckPowerScore;
        target: DifficultyBudget;
        /** Program-simulated long-term build score. Populated asynchronously and persisted. */
        deckProfile?: DeckPowerProfile;
        /** Numeric generation envelope derived from deckProfile and current resources. */
        targetEnvelope?: EnemyBudgetEnvelope;
        programCalibration?: ProgramEncounterCalibrationSummary;
        enemy?: EnemyPowerScore;
        calibration?: EnemyBalanceCalibration;
    };
    archetypes: DeckArchetypeProfile;
    lineage: EncounterLineageMemory;
    encounterPlan?: EncounterDesignPlan;
    lastBattle?: BattleOutcomeFeedback;
    performance?: BattlePerformanceSummary;
    rewardReview?: {
        candidateCount: number;
        uniqueMechanics: number;
        uniqueStructures: number;
        distinctRoles: number;
        diagnosticCodes: string[];
        candidates: Array<{
            id: string;
            pathKind: RewardArchetypePathKind;
            deckScoreDelta: number;
            selectionValue: number;
            archetypes: Array<{
                id: string;
                label: string;
                score: number;
            }>;
        }>;
    };
    lastEncounter?: {
        signature: string;
        challenge: EncounterChallengeBand;
        expectedVictoryTurns: number | null;
        diagnosticCodes: string[];
        priorityAdvice?: string;
        shadow?: {
            confidence: EncounterShadowSimulation['confidence'];
            skilledWinRate: number;
            greedyWinRate: number;
            strategySpread: number;
        };
    };
}
export interface ContentDesignAssistantInput {
    pack: ContentPack;
    budget: BuildBudget;
    player: {
        hp: number;
        maxHp: number;
        lust?: number;
        maxLust?: number;
    };
    danger?: 0 | 1 | 2 | 3;
    act?: number;
    previous?: unknown;
    outcome?: BattleOutcomeFeedback;
    rewardCandidates?: ContentDefinition[];
    difficultyPercent?: number;
    autoCalibration?: boolean;
    deckPowerProfile?: DeckPowerProfile;
    /** Normal UI refresh uses 24; explicit deep calibration may request up to 256. */
    simulationSeeds?: number;
}
export interface ContentDesignAssessment {
    build: BuildDesignProfile;
    enemy: EnemyDesignProfile | null;
    forecast: EncounterForecast | null;
    reward: RewardChoiceDesignProfile | null;
    rewardPlan: RewardDesignPlan;
    encounterPlan: EncounterDesignPlan | null;
    budget: EnemyBudget;
    diagnostics: ContentDesignDiagnostic[];
    simulation: EncounterShadowSimulation | null;
    deckPower: DeckPowerScore;
    /** v2 program simulation; null only while the deferred profiler has not completed. */
    deckPowerProfile: DeckPowerProfile | null;
    /** v2 enemy generation budget derived from the simulated profile and current resources. */
    enemyEnvelope: EnemyBudgetEnvelope | null;
    enemyPower: EnemyPowerScore | null;
    difficulty: DifficultyBudget;
    calibration: EnemyBalanceCalibration | null;
    archetypes: DeckArchetypeProfile;
    lineage: EncounterLineageMemory;
    context: ContentDesignContext;
}
/**
 * Host-neutral design director. It estimates rather than simulates and never mutates content.
 * Contract validity remains the hard gate; these diagnostics guide generation and bounded repair.
 */
export declare function assessContentDesign(input: ContentDesignAssistantInput): ContentDesignAssessment;
export declare function formatContentDesignDiagnostics(diagnostics: readonly ContentDesignDiagnostic[], limit?: number): string;
