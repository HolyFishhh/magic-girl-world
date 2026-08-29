export declare const RUN_STATE_SCHEMA_VERSION: 2;
export declare const RUN_NODE_KINDS: readonly ["battle", "elite", "event", "rest", "shop", "boss"];
export type RunNodeKind = (typeof RUN_NODE_KINDS)[number];
export type RunPhase = 'awaiting_choice' | 'in_node' | 'won' | 'lost';
export type RunNodeOutcome = 'cleared' | 'failed' | 'escaped';
export interface RunNodeChoice {
    id: string;
    kind: RunNodeKind;
    act: number;
    floor: number;
    danger: 0 | 1 | 2 | 3;
}
export type RunNodeCounts = Record<RunNodeKind, number>;
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
}
export interface CreateRunStateOptions {
    seed: number;
    actCount?: number;
    floorsPerAct?: number;
    startingGold?: number;
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
/** Generate only the next choice set; no full map is stored in prompts or saves. */
export declare function generateRunChoices(input: RunState): RunState;
export declare function createRunState(options: CreateRunStateOptions): RunState;
export declare function enterRunNode(input: RunState, choiceId: string): RunState;
/** Return the active node or fail before a host mutates node-specific state. */
export declare function requireActiveRunNode(input: RunState, kind?: RunNodeKind): RunNodeChoice;
export declare function completeRunNode(input: RunState, options: CompleteRunNodeOptions): RunState;
export declare function spendRunGold(input: RunState, amount: number): RunState;
/** Migrate persisted run snapshots without using route RNG or host state. */
export declare function migrateRunState(value: unknown): unknown;
/** Strict reader for adapters restoring RunState from MUV, a website, or a Mod save. */
export declare function validateRunState(value: unknown): RunStateValidationResult;
