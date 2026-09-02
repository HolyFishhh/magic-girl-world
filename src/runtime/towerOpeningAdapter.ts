import {
  claimTowerOpening,
  commitTowerOpening,
  failTowerOpening,
  queueTowerOpening,
  recoverInterruptedTowerOpening,
} from '../game-core/towerOpeningState';
import { validateRunState, type RunState } from '../game-core/runState';
import type { TowerOpeningResult } from '../game-core/towerRequest';
import { readTowerRunState, type TowerRunMutationResult } from './towerStateAdapter';

export interface TowerOpeningRequest {
  nodeId: 'tower-opening';
  requestId: string;
  revision: number;
  seed: number;
}

export interface TowerOpeningClaimResult extends TowerRunMutationResult {
  request: TowerOpeningRequest;
}

function requireRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('stat_data is unavailable');
  return value as Record<string, any>;
}

function replaceOpening(
  stat: Record<string, any>,
  previous: RunState,
  opening: RunState['opening'],
): TowerRunMutationResult {
  if (opening === previous.opening) return { previous, run: previous, changed: false };
  const candidate: RunState = { ...previous, opening };
  const parsed = validateRunState(candidate);
  if (!parsed.ok) throw new Error(`tower opening replacement is invalid: ${parsed.message}`);
  stat.run = parsed.value;
  return { previous, run: parsed.value, changed: true };
}

function requestFor(run: RunState): TowerOpeningRequest {
  if (!run.opening.requestId) throw new Error('tower opening request id is unavailable');
  return {
    nodeId: 'tower-opening',
    requestId: run.opening.requestId,
    revision: run.opening.basedOnRevision,
    seed: run.seed,
  };
}

export function queueTowerOpeningInStat(statValue: unknown): TowerOpeningClaimResult {
  const stat = requireRecord(statValue);
  const previous = readTowerRunState(stat);
  if (previous.floor !== 0 || previous.phase !== 'awaiting_choice') {
    throw new Error('tower opening is only available before the first route choice');
  }
  const mutation = queueTowerOpening(previous.opening, previous.seed, previous.stateRevision);
  const replaced = replaceOpening(stat, previous, mutation.opening);
  return { ...replaced, request: requestFor(replaced.run) };
}

export function claimTowerOpeningInStat(
  statValue: unknown,
  expectedRequestId?: string,
): TowerOpeningClaimResult {
  const stat = requireRecord(statValue);
  const previous = readTowerRunState(stat);
  if (previous.opening.phase === 'generating' && previous.opening.requestId) {
    if (expectedRequestId && previous.opening.requestId !== expectedRequestId) {
      throw new Error('tower opening request is stale');
    }
    return { previous, run: previous, changed: false, request: requestFor(previous) };
  }
  const mutation = claimTowerOpening(previous.opening, expectedRequestId);
  const replaced = replaceOpening(stat, previous, mutation.opening);
  return { ...replaced, request: requestFor(replaced.run) };
}

export function commitTowerOpeningInStat(
  statValue: unknown,
  result: TowerOpeningResult,
): TowerRunMutationResult {
  const stat = requireRecord(statValue);
  const previous = readTowerRunState(stat);
  if (
    (previous.opening.phase === 'ready' || previous.opening.phase === 'consumed')
    && previous.opening.requestId === result.request_id
    && previous.opening.basedOnRevision === result.based_on_revision
  ) {
    return { previous, run: previous, changed: false };
  }
  const mutation = commitTowerOpening(previous.opening, {
    requestId: result.request_id,
    basedOnRevision: result.based_on_revision,
    content: result,
  });
  return replaceOpening(stat, previous, mutation.opening);
}

export function failTowerOpeningInStat(
  statValue: unknown,
  failure: { requestId: string; revision: number; error?: string },
): TowerRunMutationResult {
  const stat = requireRecord(statValue);
  const previous = readTowerRunState(stat);
  if (
    previous.opening.phase === 'failed'
    && previous.opening.requestId === failure.requestId
    && previous.opening.basedOnRevision === failure.revision
  ) {
    return { previous, run: previous, changed: false };
  }
  const mutation = failTowerOpening(previous.opening, {
    requestId: failure.requestId,
    basedOnRevision: failure.revision,
    error: failure.error,
  });
  return replaceOpening(stat, previous, mutation.opening);
}

export function recoverTowerOpeningInStat(statValue: unknown): TowerRunMutationResult {
  const stat = requireRecord(statValue);
  const previous = readTowerRunState(stat);
  return replaceOpening(stat, previous, recoverInterruptedTowerOpening(previous.opening));
}
