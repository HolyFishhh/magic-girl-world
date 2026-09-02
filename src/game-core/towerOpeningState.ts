import type { TowerOpeningState } from './runState';

export interface TowerOpeningMutation {
  opening: TowerOpeningState;
  changed: boolean;
}

function openingRequestId(seed: number, revision: number, attempt: number): string {
  let hash = 0x811c9dc5;
  const source = `${seed}:${revision}:${attempt}:opening`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `tower_opening_${revision}_${attempt}_${(hash >>> 0).toString(36)}`;
}

export function queueTowerOpening(
  opening: TowerOpeningState,
  seed: number,
  basedOnRevision: number,
): TowerOpeningMutation {
  if (!Number.isInteger(basedOnRevision) || basedOnRevision < 0) throw new Error('tower opening revision is invalid');
  if (opening.phase === 'ready' || opening.phase === 'consumed' || opening.phase === 'skipped') {
    return { opening, changed: false };
  }
  if (
    (opening.phase === 'pending' || opening.phase === 'generating')
    && opening.requestId
    && opening.basedOnRevision === basedOnRevision
  ) {
    return { opening, changed: false };
  }
  const attempts = opening.attempts + 1;
  return {
    opening: {
      phase: 'pending',
      requestId: openingRequestId(seed, basedOnRevision, attempts),
      basedOnRevision,
      attempts,
    },
    changed: true,
  };
}

export function claimTowerOpening(opening: TowerOpeningState, expectedRequestId?: string): TowerOpeningMutation {
  if (opening.phase !== 'pending' || !opening.requestId) throw new Error('tower opening is not queued');
  if (expectedRequestId && opening.requestId !== expectedRequestId) throw new Error('tower opening request is stale');
  return { opening: { ...opening, phase: 'generating' }, changed: true };
}

export function commitTowerOpening(
  opening: TowerOpeningState,
  result: { requestId: string; basedOnRevision: number; content: unknown },
): TowerOpeningMutation {
  if (
    opening.phase === 'ready'
    && opening.requestId === result.requestId
    && opening.basedOnRevision === result.basedOnRevision
  ) {
    return { opening, changed: false };
  }
  if (opening.phase !== 'generating') throw new Error('tower opening is not generating');
  if (opening.requestId !== result.requestId || opening.basedOnRevision !== result.basedOnRevision) {
    throw new Error('tower opening result is stale');
  }
  const narrativeRequestId = `${result.requestId}__narrative`;
  return {
    opening: {
      ...opening,
      phase: 'ready',
      content: structuredClone(result.content),
      error: undefined,
      narrativePhase: 'pending',
      narrativeRequestId,
      narrativeError: undefined,
    },
    changed: true,
  };
}

export function failTowerOpening(
  opening: TowerOpeningState,
  result: { requestId: string; basedOnRevision: number; error?: string },
): TowerOpeningMutation {
  if (opening.phase !== 'generating') throw new Error('tower opening is not generating');
  if (opening.requestId !== result.requestId || opening.basedOnRevision !== result.basedOnRevision) {
    throw new Error('tower opening failure is stale');
  }
  return {
    opening: {
      ...opening,
      phase: 'failed',
      error: String(result.error || '开局事件生成失败').slice(0, 500),
    },
    changed: true,
  };
}

export function consumeTowerOpening(opening: TowerOpeningState): TowerOpeningMutation {
  if (opening.phase === 'consumed') return { opening, changed: false };
  if (opening.phase !== 'ready' || opening.content === undefined) throw new Error('tower opening is not ready');
  return { opening: { ...opening, phase: 'consumed' }, changed: true };
}

export function recoverInterruptedTowerOpening(opening: TowerOpeningState): TowerOpeningState {
  return opening.phase === 'generating'
    ? { ...opening, phase: 'failed', error: '页面刷新中断了开局生成，可安全重试' }
    : opening;
}
