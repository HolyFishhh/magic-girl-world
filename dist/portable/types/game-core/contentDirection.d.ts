import type { RunNodeChoice, RunState } from './runState';
/** Deterministic natural-language direction adds variety without another AI schema or history payload. */
export declare function formatRunNodeDirection(node: RunNodeChoice, runSeed: number, run?: Pick<RunState, 'actCount' | 'floorsPerAct' | 'nodeCounts'> | null): string;
