export declare const RUN_MAP_SCHEMA_VERSION: 1;
export declare const DEFAULT_RUN_MAP_ACTS: 3;
export declare const DEFAULT_RUN_MAP_COLUMNS: 7;
export declare const DEFAULT_RUN_MAP_ROUTE_FLOORS: 15;
export declare const DEFAULT_RUN_MAP_PATHS: 6;
export declare const RUN_MAP_ROOM_ASSIGNMENT_ATTEMPTS: 256;
export type RunMapSeed = number | string;
export type RunMapNodeKind = 'battle' | 'elite' | 'event' | 'rest' | 'shop' | 'treasure' | 'boss';
export type RunMapRandomNodeKind = Exclude<RunMapNodeKind, 'treasure' | 'boss'>;
export interface RunMapStreamSeeds {
    topology: number;
    room: number;
    content: number;
    reward: number;
}
export interface RunMapNode {
    id: string;
    act: number;
    floor: number;
    column: number;
    kind: RunMapNodeKind;
    contentSeed: number;
    rewardSeed: number;
}
export interface RunMapEdge {
    from: string;
    to: string;
}
export interface RunMapAct {
    act: number;
    difficultyMultiplier: number;
    seeds: RunMapStreamSeeds;
    roomAssignmentAttempt: number;
    roomAssignmentSeed: number;
    nodes: RunMapNode[];
    edges: RunMapEdge[];
    /** Six independently generated routes. Shared ids represent route merges. */
    paths: string[][];
    startNodeIds: string[];
    bossNodeId: string;
}
export interface RunMapConfig {
    acts: number;
    columns: number;
    routeFloors: number;
    pathsPerAct: number;
    actDifficultyStep: number;
}
export interface RunMapActValidationStats {
    act: number;
    nodeCount: number;
    edgeCount: number;
    randomRoomCounts: Record<RunMapRandomNodeKind, number>;
    randomRoomRatios: Record<RunMapRandomNodeKind, number>;
    routeEliteCounts: number[];
    minimumRouteElites: number;
    maximumRouteElites: number;
}
export interface RunMapValidation {
    ok: boolean;
    errors: string[];
    warnings: string[];
    acts: RunMapActValidationStats[];
}
export interface RunMap {
    schemaVersion: typeof RUN_MAP_SCHEMA_VERSION;
    seed: RunMapSeed;
    normalizedSeed: number;
    seeds: RunMapStreamSeeds;
    config: RunMapConfig;
    acts: RunMapAct[];
    /** Flattened views for renderers and persistence adapters. */
    nodes: RunMapNode[];
    edges: RunMapEdge[];
    startNodeIds: Record<number, string[]>;
    bossNodeIds: Record<number, string>;
    validation: RunMapValidation;
}
export interface GenerateRunMapOptions {
    seed: RunMapSeed;
    actDifficultyStep?: number;
}
export declare function validateRunMap(map: Omit<RunMap, 'validation'> | RunMap): RunMapValidation;
export declare function generateRunMap(options: GenerateRunMapOptions | RunMapSeed): RunMap;
export declare const createRunMap: typeof generateRunMap;
