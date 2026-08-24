import { type ContentPack } from './contentPack';
import { type ContentContractIssue } from './contentContract';
import type { BattleEndResult } from './battleTerminal';
import { type RunPacingContext } from './runPacing';
export declare const BATTLE_REQUEST_SCHEMA_VERSION: 1;
export declare const BATTLE_RESULT_SCHEMA_VERSION: 1;
export interface BattleRouteContext extends RunPacingContext {
    nodeId: string;
}
export interface BattleRequest {
    schemaVersion: typeof BATTLE_REQUEST_SCHEMA_VERSION;
    content: ContentPack;
    player: {
        hp: number;
        maxHp: number;
        lust: number;
        maxLust: number;
        level: number;
    };
    route: BattleRouteContext | null;
    seed: number;
}
export interface BattleResult {
    schemaVersion: typeof BATTLE_RESULT_SCHEMA_VERSION;
    outcome: BattleEndResult;
    player: {
        hp: number;
        lust: number;
    };
    items: Array<{
        id: string;
        count: number;
    }>;
    turns: number;
    route: {
        nodeId: string;
        outcome: 'cleared' | 'failed' | 'escaped';
    } | null;
}
export declare class BattleContentContractError extends Error {
    readonly issues: ContentContractIssue[];
    constructor(issues: readonly ContentContractIssue[]);
}
export declare function deriveBattleSeed(content: ContentPack, route: BattleRouteContext | null, runSeed?: number): number;
export declare function createBattleRequest(input: {
    content: ContentPack;
    player: BattleRequest['player'];
    route?: unknown;
    runSeed?: number;
    seed?: number;
}): BattleRequest;
export declare function createBattleResult(input: {
    request: BattleRequest;
    outcome: BattleResult['outcome'];
    player: {
        hp: unknown;
        lust: unknown;
    };
    items?: ReadonlyArray<{
        id: unknown;
        count: unknown;
    }>;
    turns: unknown;
}): BattleResult;
