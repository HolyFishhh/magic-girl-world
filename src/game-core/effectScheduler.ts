import type { EffectProgram } from './effectDsl';

export type ScheduledPhase = 'turn_start' | 'before_draw' | 'after_draw' | 'turn_end';
export type ScheduledOwner = 'player' | 'enemy' | 'system';

export type ScheduledPayload =
  | { type: 'effect_program'; program: EffectProgram; sourceIsPlayer: boolean }
  | { type: 'remove_status'; owner: ScheduledOwner; statusId: string }
  | { type: 'defeat_entity'; entityId: string; reason: 'delayed_death' | 'execute' }
  | {
      type: 'card_zone';
      operation: 'move' | 'remove' | 'recover' | 'generate';
      data: Record<string, unknown>;
    };

export interface ScheduledEffect {
  id: string;
  source: { kind: string; id: string; name?: string };
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

export interface ScheduleEffectDraft extends Omit<ScheduledEffect, 'id'> {}

export function createEffectSchedulerState(queue: readonly ScheduledEffect[] = []): EffectSchedulerState {
  const sorted = queue.map(item => structuredClone(item)).sort(scheduleOrder);
  const nextSequence = sorted.reduce((max, item) => {
    const match = item.id.match(/:(\d+)$/);
    return Math.max(max, match ? Number(match[1]) + 1 : max);
  }, 1);
  return { schemaVersion: 1, nextSequence, queue: sorted };
}

function phaseRank(phase: ScheduledPhase): number {
  return { turn_start: 0, before_draw: 1, after_draw: 2, turn_end: 3 }[phase];
}

function scheduleOrder(left: ScheduledEffect, right: ScheduledEffect): number {
  return left.dueTurn - right.dueTurn || phaseRank(left.phase) - phaseRank(right.phase) || left.priority - right.priority || left.id.localeCompare(right.id);
}

function validateDraft(draft: ScheduleEffectDraft): void {
  if (!draft.source.id.trim()) throw new Error('scheduled effect requires source id');
  if (!Number.isInteger(draft.createdTurn) || draft.createdTurn < 0) throw new Error('createdTurn must be non-negative integer');
  if (!Number.isInteger(draft.dueTurn) || draft.dueTurn < draft.createdTurn) throw new Error('dueTurn must not precede creation');
  if (!Number.isInteger(draft.priority)) throw new Error('priority must be integer');
  if (draft.repeatEvery !== undefined && (!Number.isInteger(draft.repeatEvery) || draft.repeatEvery < 1))
    throw new Error('repeatEvery must be positive integer');
  if (draft.remainingRepeats !== undefined && (!Number.isInteger(draft.remainingRepeats) || draft.remainingRepeats < 1))
    throw new Error('remainingRepeats must be positive integer');
}

export function scheduleEffect(
  state: EffectSchedulerState,
  draft: ScheduleEffectDraft,
): { state: EffectSchedulerState; scheduled: ScheduledEffect } {
  validateDraft(draft);
  const sequence = Math.max(1, Math.floor(state.nextSequence || 1));
  const scheduled = { ...structuredClone(draft), id: `schedule:${draft.source.id}:${sequence}` };
  return {
    state: { ...state, nextSequence: sequence + 1, queue: [...state.queue, scheduled].sort(scheduleOrder) },
    scheduled,
  };
}

export interface DueScheduledEffects {
  state: EffectSchedulerState;
  due: ScheduledEffect[];
}

/** Take exactly one phase atomically; repeating entries are rescheduled after this phase. */
export function takeDueScheduledEffects(
  state: EffectSchedulerState,
  turn: number,
  phase: ScheduledPhase,
): DueScheduledEffects {
  if (!Number.isInteger(turn) || turn < 0) throw new Error('turn must be non-negative integer');
  // A restored save may resume after the exact due turn. Execute the overdue item
  // at the next matching phase rather than silently losing it. Repeating entries
  // resume from the observed turn so an extra turn cannot consume the same
  // occurrence twice and a skipped turn does not create a burst of stale ticks.
  const due = state.queue.filter(item => item.dueTurn <= turn && item.phase === phase).sort(scheduleOrder);
  const dueIds = new Set(due.map(item => item.id));
  const queue = state.queue.filter(item => !dueIds.has(item.id));
  for (const item of due) {
    if (!item.repeatEvery || !item.remainingRepeats || item.remainingRepeats <= 1) continue;
    queue.push({
      ...structuredClone(item),
      dueTurn: turn + item.repeatEvery,
      remainingRepeats: item.remainingRepeats - 1,
    });
  }
  return { state: { ...state, queue: queue.sort(scheduleOrder) }, due };
}

/**
 * Prepare a scheduler phase without mutating the supplied state. Callers apply
 * the returned state only after every payload has committed successfully; on a
 * payload failure they retain the original state and can retry the whole phase.
 */
export async function runScheduledPhaseAtomically<T>(
  state: EffectSchedulerState,
  turn: number,
  phase: ScheduledPhase,
  initial: T,
  execute: (draft: T, effect: ScheduledEffect) => T | Promise<T>,
): Promise<{ state: EffectSchedulerState; value: T; executed: ScheduledEffect[] }> {
  const taken = takeDueScheduledEffects(state, turn, phase);
  let draft = structuredClone(initial);
  for (const effect of taken.due) draft = await execute(draft, structuredClone(effect));
  return { state: taken.state, value: draft, executed: taken.due };
}

export function cancelScheduledEffects(
  state: EffectSchedulerState,
  predicate: (effect: ScheduledEffect) => boolean,
): { state: EffectSchedulerState; cancelled: ScheduledEffect[] } {
  const cancelled = state.queue.filter(predicate);
  const cancelledIds = new Set(cancelled.map(item => item.id));
  return { state: { ...state, queue: state.queue.filter(item => !cancelledIds.has(item.id)) }, cancelled };
}

export function validateEffectSchedulerState(value: unknown): value is EffectSchedulerState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as EffectSchedulerState;
  if (state.schemaVersion !== 1 || !Number.isInteger(state.nextSequence) || state.nextSequence < 1 || !Array.isArray(state.queue)) return false;
  try {
    state.queue.forEach(validateDraft);
    return new Set(state.queue.map(item => item.id)).size === state.queue.length;
  } catch {
    return false;
  }
}
