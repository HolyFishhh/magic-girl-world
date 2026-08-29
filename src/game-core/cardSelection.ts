import { shuffleCards } from './cardZoneReducer';

export type CardSelectionMode = 'choose' | 'leftmost' | 'rightmost' | 'all' | 'random';

export type CardSelectionFailureCode =
  | 'DUPLICATE_CANDIDATE_ID'
  | 'RANDOM_SOURCE_REQUIRED'
  | 'INSUFFICIENT_CANDIDATES'
  | 'CANCEL_NOT_ALLOWED'
  | 'INVALID_RESPONSE';

export interface CardSelectionRequest {
  candidateIds: readonly string[];
  mode: CardSelectionMode;
  minimum: number;
  maximum: number;
  allowCancel: boolean;
}

export type CardSelectionPlan =
  | {
      ok: true;
      kind: 'interactive';
      candidateIds: string[];
      minimum: number;
      maximum: number;
      allowCancel: boolean;
    }
  | {
      ok: true;
      kind: 'automatic';
      candidateIds: string[];
      selectedIds: string[];
      minimum: number;
      maximum: number;
      allowCancel: boolean;
    }
  | {
      ok: false;
      code: CardSelectionFailureCode;
      requestedMinimum?: number;
      availableCount?: number;
    };

export type CardSelectionResult =
  | { status: 'selected'; selectedIds: string[] }
  | { status: 'cancelled' }
  | { status: 'invalid'; code: CardSelectionFailureCode };

function normalizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Build a stable, host-independent selection plan from card IDs. */
export function planCardSelection(
  request: CardSelectionRequest,
  random?: () => number,
): CardSelectionPlan {
  const candidateIds = [...request.candidateIds];
  if (new Set(candidateIds).size !== candidateIds.length) {
    return { ok: false, code: 'DUPLICATE_CANDIDATE_ID' };
  }

  const requestedMaximum = normalizeCount(request.maximum);
  const requestedMinimum = normalizeCount(request.minimum);
  const maximum = Math.min(candidateIds.length, requestedMaximum);
  if (requestedMinimum > maximum) {
    return {
      ok: false,
      code: 'INSUFFICIENT_CANDIDATES',
      requestedMinimum,
      availableCount: Math.min(candidateIds.length, requestedMaximum),
    };
  }
  const minimum = requestedMinimum;
  const base = { candidateIds, minimum, maximum, allowCancel: request.allowCancel };

  if (request.mode === 'choose' && maximum > 0) {
    return { ok: true, kind: 'interactive', ...base };
  }

  let selectedIds: string[];
  if (request.mode === 'all') selectedIds = candidateIds.slice(0, maximum);
  else if (request.mode === 'rightmost') selectedIds = maximum === 0 ? [] : candidateIds.slice(-maximum);
  else if (request.mode === 'random') {
    if (!random) return { ok: false, code: 'RANDOM_SOURCE_REQUIRED' };
    selectedIds = shuffleCards(candidateIds, random).slice(0, maximum);
  } else selectedIds = candidateIds.slice(0, maximum);

  return { ok: true, kind: 'automatic', ...base, selectedIds };
}

/** Validate a host response and restore authored candidate order. */
export function resolveCardSelection(
  plan: Exclude<CardSelectionPlan, { ok: false }>,
  response?: readonly string[] | null,
): CardSelectionResult {
  if (plan.kind === 'automatic') return { status: 'selected', selectedIds: [...plan.selectedIds] };
  if (response === null || response === undefined) {
    return plan.allowCancel ? { status: 'cancelled' } : { status: 'invalid', code: 'CANCEL_NOT_ALLOWED' };
  }
  if (new Set(response).size !== response.length) return { status: 'invalid', code: 'INVALID_RESPONSE' };
  const selected = new Set(response);
  if (response.some(id => !plan.candidateIds.includes(id))) {
    return { status: 'invalid', code: 'INVALID_RESPONSE' };
  }
  if (response.length < plan.minimum || response.length > plan.maximum) {
    return { status: 'invalid', code: 'INVALID_RESPONSE' };
  }
  return { status: 'selected', selectedIds: plan.candidateIds.filter(id => selected.has(id)) };
}
