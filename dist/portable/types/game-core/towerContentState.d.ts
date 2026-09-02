export declare const TOWER_CONTENT_SCHEMA_VERSION: 1;
export declare const TOWER_CONTENT_PHASES: readonly ["idle", "queued", "generating", "ready", "failed", "consumed", "abandoned"];
export type TowerContentPhase = (typeof TOWER_CONTENT_PHASES)[number];
export interface TowerNodeContentEnvelope<TContent = unknown, TReward = unknown> {
    schemaVersion: typeof TOWER_CONTENT_SCHEMA_VERSION;
    nodeId: string;
    kind: string;
    phase: TowerContentPhase;
    requestId: string | null;
    basedOnRevision: number;
    attempts: number;
    content?: TContent;
    reward?: TReward;
    error?: string;
}
export type TowerNodeContentStore<TContent = unknown, TReward = unknown> = Record<string, TowerNodeContentEnvelope<TContent, TReward>>;
export interface TowerGenerationCommit<TContent = unknown, TReward = unknown> {
    nodeId: string;
    requestId: string;
    basedOnRevision: number;
    content: TContent;
    reward?: TReward;
}
export interface TowerContentMutation<TContent = unknown, TReward = unknown> {
    store: TowerNodeContentStore<TContent, TReward>;
    envelope: TowerNodeContentEnvelope<TContent, TReward>;
    changed: boolean;
}
export declare function createTowerNodeContent<TContent = unknown, TReward = unknown>(nodeId: string, kind: string): TowerNodeContentEnvelope<TContent, TReward>;
export declare function createTowerContentStore<TContent = unknown, TReward = unknown>(nodes: ReadonlyArray<{
    id: string;
    kind: string;
}>): TowerNodeContentStore<TContent, TReward>;
export declare function queueTowerNodeContent<TContent = unknown, TReward = unknown>(store: TowerNodeContentStore<TContent, TReward>, nodeId: string, basedOnRevision: number): TowerContentMutation<TContent, TReward>;
export declare function claimTowerGeneration<TContent = unknown, TReward = unknown>(store: TowerNodeContentStore<TContent, TReward>, nodeId: string, expectedRequestId?: string): TowerContentMutation<TContent, TReward>;
export declare function commitTowerGeneration<TContent = unknown, TReward = unknown>(store: TowerNodeContentStore<TContent, TReward>, commit: TowerGenerationCommit<TContent, TReward>): TowerContentMutation<TContent, TReward>;
export declare function failTowerGeneration<TContent = unknown, TReward = unknown>(store: TowerNodeContentStore<TContent, TReward>, nodeId: string, request: {
    requestId: string;
    basedOnRevision: number;
    error?: string;
}): TowerContentMutation<TContent, TReward>;
export declare function consumeTowerNodeContent<TContent = unknown, TReward = unknown>(store: TowerNodeContentStore<TContent, TReward>, nodeId: string): TowerContentMutation<TContent, TReward>;
export declare function abandonTowerContent<TContent = unknown, TReward = unknown>(store: TowerNodeContentStore<TContent, TReward>, nodeIds: readonly string[]): TowerNodeContentStore<TContent, TReward>;
/** Turn browser-interrupted jobs into retryable failures after a page reload. */
export declare function recoverInterruptedTowerContent<TContent = unknown, TReward = unknown>(store: TowerNodeContentStore<TContent, TReward>): TowerNodeContentStore<TContent, TReward>;
export declare function isTowerNodeContentReady(envelope: TowerNodeContentEnvelope, options?: {
    rewardRequired?: boolean;
}): boolean;
/** Breadth-first node lookahead used by the queue; it never explores beyond maxDepth. */
export declare function collectReachableTowerNodeIds(adjacency: Readonly<Record<string, readonly string[]>>, startNodeIds: readonly string[], maxDepth?: number): string[];
export declare function validateTowerContentStore(value: unknown): value is TowerNodeContentStore;
