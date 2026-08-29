import type { EffectProgram } from './effectDsl';
import { type CardEffectCommand } from './cardEffectRuntime';
export type ScheduledPhase = 'turn_start' | 'before_draw' | 'after_draw' | 'turn_end';
export type ScheduledOwner = 'player' | 'enemy' | 'system';
export type ScheduledPayload = {
    type: 'effect_program';
    program: EffectProgram;
    sourceIsPlayer: boolean;
} | {
    type: 'remove_status';
    owner: ScheduledOwner;
    statusId: string;
} | {
    type: 'defeat_entity';
    entityId: string;
    reason: 'delayed_death' | 'execute';
} | {
    type: 'card_zone_operation';
    command: CardEffectCommand;
} | {
    type: 'card_zone';
    operation: 'move' | 'remove' | 'recover' | 'generate';
    data: Record<string, unknown>;
};
/** Normalize old saved card-zone payloads into the only executable command shape. */
export declare function scheduledCardZoneCommand(payload: ScheduledPayload): CardEffectCommand | null;
export interface ScheduledEffect {
    id: string;
    source: {
        kind: string;
        id: string;
        name?: string;
    };
    owner: ScheduledOwner;
    createdTurn: number;
    dueTurn: number;
    phase: ScheduledPhase;
    priority: number;
    repeatEvery?: number;
    remainingRepeats?: number;
    payload: ScheduledPayload;
}
export interface EffectSchedulerState {
    schemaVersion: 1;
    nextSequence: number;
    queue: ScheduledEffect[];
}
export interface ScheduleEffectDraft extends Omit<ScheduledEffect, 'id'> {
}
export declare function createEffectSchedulerState(queue?: readonly ScheduledEffect[]): EffectSchedulerState;
export declare function scheduleEffect(state: EffectSchedulerState, draft: ScheduleEffectDraft): {
    state: EffectSchedulerState;
    scheduled: ScheduledEffect;
};
export interface DueScheduledEffects {
    state: EffectSchedulerState;
    due: ScheduledEffect[];
}
/** Take exactly one phase atomically; repeating entries are rescheduled after this phase. */
export declare function takeDueScheduledEffects(state: EffectSchedulerState, turn: number, phase: ScheduledPhase): DueScheduledEffects;
/**
 * Prepare a scheduler phase without mutating the supplied state. Callers apply
 * the returned state only after every payload has committed successfully; on a
 * payload failure they retain the original state and can retry the whole phase.
 */
export declare function runScheduledPhaseAtomically<T>(state: EffectSchedulerState, turn: number, phase: ScheduledPhase, initial: T, execute: (draft: T, effect: ScheduledEffect) => T | Promise<T>, options?: {
    isTerminal?: (draft: T) => boolean;
}): Promise<{
    state: EffectSchedulerState;
    value: T;
    executed: ScheduledEffect[];
}>;
export declare function cancelScheduledEffects(state: EffectSchedulerState, predicate: (effect: ScheduledEffect) => boolean): {
    state: EffectSchedulerState;
    cancelled: ScheduledEffect[];
};
export declare function validateEffectSchedulerState(value: unknown): value is EffectSchedulerState;
