import type { TowerGenerationTaskKey } from './towerGenerationQueue';
import type { NarrativeDeliveryMetadata } from './narrativeDeliveryObservation';
import { GenerationTransportError, type GenerationTransportFailureKind, type GenerationTransportFailure } from './generationTransportError';

export type TowerGenerationStage = 'structured' | 'structure-repair' | 'narrative';
export interface TowerGenerationAttemptDiagnostic extends TowerGenerationTaskKey {
  generationId: string;
  stage: TowerGenerationStage;
  attempt: number;
  startedAt: number;
  finishedAt?: number;
  outcome: 'running' | 'returned' | 'empty_final' | 'non_text_response' | 'exception' | 'cancelled' | 'timeout';
  finalCharacters?: number;
  narrativeDelivery?: NarrativeDeliveryMetadata;
  /** Helper events for mechanism requests, not upstream HTTP content. */
  structuredDelivery?: NarrativeDeliveryMetadata;
  /** Metadata only; the original response/auxiliary field is never retained. */
  responseDelivery?: 'auxiliary_json';
  /** A requested strategy, not proof of the final HTTP transport. */
  emptyJsonFallbackRequested: boolean;
  /** Requested per-call policy, not proof of upstream provider parameters. */
  presetFinalFallbackRequested: boolean;
  errorType?: string;
  httpStatus?: number;
  failureKind?: GenerationTransportFailureKind;
  retryable?: boolean;
  transportEvidence?: GenerationTransportFailure['evidence'];
  transportDispatchedAt?: number;
  transportResponseAt?: number;
  transportContentType?: 'event_stream' | 'json' | 'other' | 'missing';
}

/** Bounded, in-memory metadata only: never store prompts, output, reasoning,
 * settings or arbitrary exception messages (which can contain credentials). */
export class TowerGenerationDiagnostics {
  private readonly entries: TowerGenerationAttemptDiagnostic[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  begin(key: TowerGenerationTaskKey, stage: TowerGenerationStage, attempt: number,
    generationId: string, emptyJsonFallbackRequested: boolean, presetFinalFallbackRequested = false) {
    const entry: TowerGenerationAttemptDiagnostic = {
      chatId: key.chatId, nodeId: key.nodeId, requestId: key.requestId,
      ...(key.runScope ? { runScope: key.runScope } : {}),
      stage, attempt, generationId, emptyJsonFallbackRequested, presetFinalFallbackRequested,
      startedAt: this.now(), outcome: 'running',
    };
    this.entries.push(entry);
    if (this.entries.length > 64) this.entries.splice(0, this.entries.length - 64);
    return {
      observedNarrative: (value: NarrativeDeliveryMetadata) => {
        if (entry.outcome !== 'running') return;
        entry.narrativeDelivery = { ...value };
      },
      observedStructured: (value: NarrativeDeliveryMetadata) => {
        if (entry.outcome !== 'running') return;
        entry.structuredDelivery = { ...value };
      },
      observedTransportFailure: (failure: GenerationTransportFailure) => {
        if (entry.outcome !== 'running') return;
        entry.failureKind = failure.kind;
        entry.retryable = failure.retryable;
        entry.transportEvidence = failure.evidence;
        if (failure.httpStatus !== undefined) entry.httpStatus = failure.httpStatus;
      },
      observedTransportProgress: (event: import('./generationTransportObserver').GenerationTransportProgress) => {
        if (entry.outcome !== 'running') return;
        if (event.phase === 'request_dispatched') entry.transportDispatchedAt = event.at;
        else {
          entry.transportResponseAt = event.at;
          entry.transportContentType = event.contentType;
          if (event.httpStatus !== undefined) entry.httpStatus = event.httpStatus;
        }
      },
      returned: (value: unknown, delivery?: 'auxiliary_json') => {
        if (entry.outcome !== 'running') return;
        entry.finishedAt = this.now();
        entry.outcome = typeof value !== 'string' ? 'non_text_response' : value.trim() ? 'returned' : 'empty_final';
        if (typeof value === 'string') entry.finalCharacters = value.length;
        if (delivery === 'auxiliary_json' && typeof value === 'string' && value.trim()) entry.responseDelivery = delivery;
      },
      failed: (error: unknown, aborted = false) => {
        if (entry.outcome !== 'running') return;
        entry.finishedAt = this.now();
        entry.outcome = aborted ? 'cancelled' : 'exception';
        entry.errorType = error === null ? 'null' : typeof error;
        if (error instanceof GenerationTransportError) {
          entry.errorType = error.name;
          entry.failureKind = error.failure.kind;
          entry.retryable = error.failure.retryable;
          entry.transportEvidence = error.failure.evidence;
          if (error.failure.httpStatus !== undefined) entry.httpStatus = error.failure.httpStatus;
        }
        // Getter/proxy failures must not replace the original error.
        try {
          const candidate = error as { name?: unknown; code?: unknown; status?: unknown } | null;
          if (candidate?.code === 'timeout') entry.outcome = 'timeout';
          else if (candidate?.code === 'cancelled' || candidate?.name === 'AbortError') entry.outcome = 'cancelled';
          if (['Error', 'TypeError', 'SyntaxError', 'RangeError', 'AbortError'].includes(String(candidate?.name))) {
            entry.errorType = String(candidate?.name);
          }
          if (typeof candidate?.status === 'number' && Number.isInteger(candidate.status)
            && candidate.status >= 100 && candidate.status <= 599) entry.httpStatus = candidate.status;
        } catch { /* Metadata is best effort; never inspect/serialize the error body. */ }
      },
    };
  }

  snapshot(chatId: string): TowerGenerationAttemptDiagnostic[] {
    return this.entries.filter(entry => entry.chatId === chatId).map(entry => ({ ...entry,
      ...(entry.narrativeDelivery ? { narrativeDelivery: { ...entry.narrativeDelivery } } : {}),
      ...(entry.structuredDelivery ? { structuredDelivery: { ...entry.structuredDelivery } } : {}),
    }));
  }

  retainChat(chatId: string): void {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index].chatId !== chatId) this.entries.splice(index, 1);
    }
  }
}
