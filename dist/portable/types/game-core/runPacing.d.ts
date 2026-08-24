import { type RunNodeChoice, type RunNodeCounts, type RunNodeKind, type RunState } from './runState';
export type RunPacingPhase = 'opening' | 'development' | 'pressure' | 'finale';
export type RunEventCost = 'none' | 'light' | 'tradeoff' | 'high';
export type RunShopTier = 'none' | 'basic' | 'focused' | 'premium';
export type RunRewardTier = 'standard' | 'enhanced' | 'major';
export type RunStoryBeat = 'setup' | 'escalation' | 'resolution';
export interface RunPacingContext {
    act: number;
    actCount?: number;
    floor: number;
    floorsPerAct?: number;
    kind: RunNodeKind;
    danger: 0 | 1 | 2 | 3;
    nodeCounts?: Partial<RunNodeCounts>;
}
export interface RunNodePacing {
    phase: RunPacingPhase;
    intensity: 1 | 2 | 3 | 4;
    repeatCount: number;
    eventCost: RunEventCost;
    shopTier: RunShopTier;
    rewardTier: RunRewardTier;
    storyBeat: RunStoryBeat;
}
/** Normalize an Act at a shared boundary so consumers do not reimplement clamping. */
export declare function normalizeRunAct(value: unknown, maximum?: number): number;
/** One deterministic pacing contract shared by route prompts, budgets, and adapters. */
export declare function recommendRunNodePacing(input: RunPacingContext): RunNodePacing;
export declare function createRunPacingContext(node: Pick<RunNodeChoice, 'act' | 'floor' | 'kind' | 'danger'>, run?: Pick<RunState, 'actCount' | 'floorsPerAct' | 'nodeCounts'> | null): RunPacingContext;
/** Normalize external route context before it crosses into the portable core. */
export declare function normalizeRunPacingContext(value: unknown): RunPacingContext | null;
export declare function formatRunPacingHint(pacing: RunNodePacing, kind: RunNodeKind): string;
