import { type RunMap } from './runMap';
import { type TowerNodeContentStore } from './towerContentState';
import { type TowerRunScore } from './towerRunScore';
export declare const RUN_STATE_SCHEMA_VERSION: 3;
export declare const RUN_NODE_KINDS: readonly ["battle", "elite", "event", "rest", "shop", "treasure", "boss"];
export type RunNodeKind = (typeof RUN_NODE_KINDS)[number];
export type RunPhase = 'awaiting_choice' | 'in_node' | 'won' | 'lost';
export type RunNodeOutcome = 'cleared' | 'failed' | 'escaped';
export type RunRouteMode = 'map' | 'legacy-window';
export type TowerOpeningPhase = 'pending' | 'generating' | 'ready' | 'consumed' | 'failed' | 'skipped';
export type TowerOpeningNarrativePhase = 'pending' | 'generating' | 'ready' | 'failed';
export interface RunNodeChoice {
    id: string;
    kind: RunNodeKind;
    act: number;
    floor: number;
    danger: 0 | 1 | 2 | 3;
    column?: number;
}
export type RunNodeCounts = Record<RunNodeKind, number>;
export interface TowerOpeningState {
    phase: TowerOpeningPhase;
    requestId: string | null;
    basedOnRevision: number;
    attempts: number;
    content?: unknown;
    error?: string;
    /** Current-preset prose is generated separately from the structured opening choices. */
    narrativePhase?: TowerOpeningNarrativePhase;
    narrativeRequestId?: string;
    narrativeError?: string;
}
export interface RunState {
    schemaVersion: typeof RUN_STATE_SCHEMA_VERSION;
    seed: number;
    rngCursor: number;
    phase: RunPhase;
    act: number;
    actCount: number;
    floor: number;
    floorsPerAct: number;
    currentNode: RunNodeChoice | null;
    choices: RunNodeChoice[];
    gold: number;
    nodeCounts: RunNodeCounts;
    lastNodeKind: RunNodeKind | null;
    routeMode: RunRouteMode;
    map: RunMap | null;
    visitedNodeIds: string[];
    nodeContent: TowerNodeContentStore;
    opening: TowerOpeningState;
    score: TowerRunScore;
    stateRevision: number;
}
export interface CreateRunStateOptions {
    seed: number;
    actCount?: number;
    floorsPerAct?: number;
    startingGold?: number;
    routeMode?: RunRouteMode;
}
export interface CompleteRunNodeOptions {
    outcome: RunNodeOutcome;
    goldDelta?: number;
}
export type RunStateValidationResult = {
    ok: true;
    value: RunState;
} | {
    ok: false;
    message: string;
};
export declare function isBattleRunNode(kind: RunNodeKind): boolean;
/** Keep `choices` as the compatibility view of the current DAG successors. */
export declare function generateRunChoices(input: RunState): RunState;
export declare function createRunState(options: CreateRunStateOptions): RunState;
export declare function enterRunNode(input: RunState, choiceId: string): RunState;
/** Return the active node or fail before a host mutates node-specific state. */
export declare function requireActiveRunNode(input: RunState, kind?: RunNodeKind): RunNodeChoice;
export declare function completeRunNode(input: RunState, options: CompleteRunNodeOptions): RunState;
export declare function spendRunGold(input: RunState, amount: number): RunState;
/** Migrate v1/v2 route-window saves without inventing a historical DAG. */
export declare function migrateRunState(value: unknown): unknown;
/** Strict reader for adapters restoring RunState from MUV, a website, or a Mod save. */
export declare function validateRunState(value: unknown): RunStateValidationResult;
