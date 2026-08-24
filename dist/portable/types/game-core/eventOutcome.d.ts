import { type RunNodeOutcome, type RunState } from './runState';
export interface EventOutcomeInput {
    nodeId: string;
    outcome: RunNodeOutcome;
    goldDelta?: number;
    hpDelta?: number;
}
/**
 * Parse the short snake_case command written by an AI into the portable core
 * input. This is the single shape/range gate for Tavern, web, and Mod hosts.
 */
export declare function parseRunResultInput(value: unknown): EventOutcomeInput;
export interface EventPlayerVitals {
    hp: number;
    maxHp: number;
}
export interface EventOutcomeSettlement {
    run: RunState;
    hp: number | null;
}
/** Settle host-neutral event costs and route progress without mutating the input. */
export declare function settleEventOutcome(run: RunState, pending: EventOutcomeInput, player?: EventPlayerVitals | null): EventOutcomeSettlement;
