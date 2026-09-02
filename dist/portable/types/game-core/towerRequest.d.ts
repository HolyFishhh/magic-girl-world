import { type RunNodeKind } from './runState';
export declare const TOWER_NODE_RESULT_SPEC: "mwg.tower-node-result/v1";
export declare const TOWER_OPENING_RESULT_SPEC: "mwg.tower-opening-result/v1";
export declare const TOWER_NODE_RESULT_TAG: "TOWER_NODE_RESULT";
export declare const TOWER_OPENING_RESULT_TAG: "TOWER_OPENING_RESULT";
export interface TowerGenerationJobDescriptor {
    nodeId: string;
    requestId: string;
    basedOnRevision: number;
    kind: RunNodeKind;
    act: number;
    floor: number;
    contentSeed: number;
    rewardSeed: number;
    difficultyMultiplier: number;
}
export interface TowerGenerationContext {
    /** Authoritative gameplay facts, with program-only map/cache/schema data removed. */
    completeMvuContext?: string;
    worldContext?: string;
    playerContext?: string;
    deckBalanceContext?: string;
    enemyLineageContext?: string;
    customRequirements?: string;
    difficultyPercent: number;
}
export interface TowerNodeResult {
    spec: typeof TOWER_NODE_RESULT_SPEC;
    node_id: string;
    request_id: string;
    based_on_revision: number;
    kind: RunNodeKind;
    title: string;
    narrative: string;
    payload: Record<string, unknown>;
    reward?: Record<string, unknown>;
    /** Program-authored after parsing; model output is never trusted for this field. */
    program_balance?: TowerProgramBalanceAudit;
}
export interface TowerProgramBalanceAudit {
    [key: string]: unknown;
    spec: string;
    winnableAtCurrentResources: boolean;
    modelRepairUsed: boolean;
}
export interface TowerBalanceRepairContext {
    playerDeckScore: number;
    targetEnemyScore: number;
    originalEnemyScore: number;
    finalEnemyScore: number;
    effectiveRatio: number;
    warnings?: string[];
}
export interface TowerOpeningResult {
    spec: typeof TOWER_OPENING_RESULT_SPEC;
    request_id: string;
    based_on_revision: number;
    title: string;
    narrative: string;
    choices: Array<{
        id: string;
        label: string;
        description?: string;
        outcome: Record<string, unknown>;
    }>;
}
type TowerNodeScope = Pick<TowerGenerationJobDescriptor, 'nodeId' | 'requestId' | 'basedOnRevision' | 'kind'> & Partial<Pick<TowerGenerationJobDescriptor, 'act' | 'floor'>>;
/** Compact node prompt: topology and reward timing stay program-owned. */
export declare function formatTowerNodeGenerationPrompt(job: TowerGenerationJobDescriptor, context: TowerGenerationContext): string;
/** One optional, bounded repair after deterministic numeric calibration fails. */
export declare function formatTowerBattleBalanceRepairPrompt(result: TowerNodeResult, audit: TowerBalanceRepairContext): string;
/** One bounded retry for providers that return JSON with a non-executable node shape. */
export declare function formatTowerNodeStructureRepairPrompt(job: TowerNodeScope, response: string, error: unknown): string;
/** Bounded repair for a structurally invalid opening gift response. */
export declare function formatTowerOpeningStructureRepairPrompt(job: Pick<TowerOpeningPromptInput, 'requestId' | 'basedOnRevision'>, response: string, error: unknown): string;
export interface TowerOpeningPromptInput {
    requestId: string;
    basedOnRevision: number;
    seed: number;
    context: TowerGenerationContext;
}
export declare function formatTowerOpeningGenerationPrompt(input: TowerOpeningPromptInput): string;
export interface TowerJsonSchema {
    name: string;
    description: string;
    strict: false;
    value: Record<string, unknown>;
}
export declare function createTowerOpeningJsonSchema(): TowerJsonSchema;
export declare function createTowerNodeJsonSchema(kind: RunNodeKind, scope?: Partial<Pick<TowerGenerationJobDescriptor, 'nodeId' | 'act' | 'floor'>>): TowerJsonSchema;
export declare function parseTowerNodeResult(text: string, expected: TowerNodeScope): TowerNodeResult;
export declare function parseTowerOpeningResult(text: string, expected: Pick<TowerOpeningPromptInput, 'requestId' | 'basedOnRevision'>): TowerOpeningResult;
export {};
