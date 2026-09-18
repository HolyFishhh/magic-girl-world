import { CHARACTER_EMOJI_SCHEMA } from '../game-core/characterAppearance';
import { getSillyTavernContext } from './sillyTavernHost';
import { createCardRuleFieldOutline } from '../game-core/aiContentJsonSchema';
import { createEmptyJsonModeFallbackMessage, createInitialDraftSchemaPromptTransport, createNodeSchemaPromptTransport, createSchemaCompatibilityMessage, factorSchemaObjectProperties } from './schemaPromptTransport';
import { TowerGenerationDiagnostics } from './towerGenerationDiagnostics';
import { observeNarrativeDelivery } from './narrativeDeliveryObservation';
import { describeEmptyNarrative } from './emptyNarrativeDiagnosis';
import { INITIAL_DRAFT_TOOL_NAME, readInitialDraftToolResult } from './initialToolDelivery';
import { GenerationTransportError, type GenerationTransportFailure } from './generationTransportError';
import { createGenerationTransportBoundary, type GenerationFetchHost, type GenerationTransportProgress } from './generationTransportObserver';
import { createStructuredAuxiliaryDecoder } from './structuredAuxiliaryDelivery';
import { createCustomStructuredThinkingPolicy } from './customStructuredThinking';
import { createSchemaCapabilityCache } from './schemaCapabilityCache';
import {
  TowerGenerationCancelledError,
  TowerGenerationQueue,
  TowerGenerationTimeoutError,
  towerGenerationTaskKey,
  type TowerGenerationQueueOptions,
  type TowerGenerationTaskKey,
} from './towerGenerationQueue';
import {
  ABILITY_TRIGGERS,
  REGISTERABLE_EFFECT_TRIGGERS,
  STATUS_TRIGGERS,
} from '../game-core/battleTriggers';

export const TOWER_GENERATION_COMPLETED_EVENT = 'mwg_tower_generation_completed';
export const TOWER_STRUCTURED_REQUEST_MARKER = 'MWG_TOWER_STRUCTURED_REQUEST';
export const TOWER_NARRATIVE_REQUEST_MARKER = 'MWG_TOWER_NARRATIVE_REQUEST';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface TowerChatMessage {
  name?: string;
  role: 'user' | 'assistant';
  is_hidden?: boolean;
  message: string;
  data?: Record<string, any>;
  extra?: Record<string, any>;
}

export interface TowerGenerateConfig {
  preset_name?: 'in_use' | string;
  generation_id: string;
  user_input: string;
  should_stream: boolean;
  should_silence: true;
  max_chat_history?: 'all' | number;
  overrides?: Record<string, any>;
  injects?: Array<Record<string, any>>;
  custom_api?: Record<string, any>;
  tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: Record<string, any> } }>;
  tool_choice?: 'auto';
  json_schema?: Record<string, any>;
  /** Contract as ordinary text, without native schema/tools or model overrides. */
  structured_delivery?: 'text-json';
  /** Internal, request-local hint; never forwarded as an unknown Helper option. */
  empty_json_fallback?: boolean;
  /** Internal, sole empty preset response recovery; never a global setting. */
  empty_narrative_fallback?: boolean;
  /** Opt-in, exact initial mechanism requests only. Not a global/preset setting. */
  deepseek_thinking_mode?: 'disabled';
  /** Internal observation hook; stripped before calling Tavern Helper. */
  on_transport_observed_failure?: (failure: GenerationTransportFailure) => void;
  /** Internal observation hook; stripped before calling Tavern Helper. */
  on_transport_progress?: (event: GenerationTransportProgress) => void;
  ordered_prompts?: Array<
    | 'world_info_before'
    | 'persona_description'
    | 'char_description'
    | 'char_personality'
    | 'scenario'
    | 'world_info_after'
    | 'dialogue_examples'
    | 'chat_history'
    | 'user_input'
    | { role: 'system' | 'assistant' | 'user'; content: string }
  >;
}

export interface TowerGenerationPorts {
  currentChatId(): string | null;
  createChatMessages(
    messages: TowerChatMessage[],
    options: { insert_before: 'end'; refresh: 'none' },
  ): Promise<void>;
  generate(config: TowerGenerateConfig): Promise<string | Record<string, any>>;
  generateNarrative?(config: TowerGenerateConfig): Promise<string | Record<string, any>>;
  canRecoverEmptyNarrative?(): boolean;
  observeNarrativeDelivery?(generationId: string): ReturnType<typeof observeNarrativeDelivery>;
  observeStructuredDelivery?(generationId: string): ReturnType<typeof observeNarrativeDelivery>;
  takeStructuredResponseDelivery?(generationId: string): 'auxiliary_json' | undefined;
  stopGenerationById(generationId: string): boolean;
  emitInternalEvent(eventName: string, payload: TowerGenerationCompletedPayload): Promise<unknown>;
}

export interface TowerGenerationRequest extends TowerGenerationTaskKey {
  prompt: string;
  /** Program-authored node location used by reward/schema validation. */
  act?: number;
  floor?: number;
  /** Reserved by the coordinator; omitted from the AI's new shop stock. */
  shopMemoryCards?: Record<string, any>[];
  /** Program-authored act multiplier used by tower-only post-generation balance. */
  difficultyMultiplier?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Initial-preset recovery: empty text or explicit retryable transport error,
   * sharing at most one extra call. Name retained for existing callers. */
  recoverEmptyNarrative?: boolean;
  onEmptyNarrativeRecovery?(reason?: string): void;
  onNarrativeTransportRecovery?(): void;
  /** A controller-owned structure repair continues its source's successful empty-final transport. */
  continueEmptyFinalRecovery?: true;
  generation?: Partial<Omit<TowerGenerateConfig,
    'generation_id' | 'user_input' | 'should_stream' | 'should_silence'>>;
  userData?: Record<string, any>;
  userExtra?: Record<string, any>;
  assistantData?: Record<string, any>;
  assistantExtra?: Record<string, any>;
  eventName?: string;
}

export interface TowerGenerationCompletedPayload extends TowerGenerationTaskKey {
  spec: 'mwg.tower-generation/v1';
  prompt: string;
  response: string;
  generationId: string;
  completedAt: number;
  parsedResult?: unknown;
  mvuData?: unknown;
  /** Request settled, not necessarily every authored node succeeded. */
  batchOutcome?: {
    outcome: 'complete' | 'partial';
    readyNodeIds: string[];
    failedNodeIds: string[];
    ignoredNodeIds: string[];
  };
}

export interface TowerGenerationResult {
  response: string;
  generationId: string;
  /** Actual extra model invocations used before this result, excluding persistence. */
  additionalRequestsUsed?: number;
  /** Transport provenance only; never authoring validity or permission to add a request. */
  emptyJsonFallbackUsed?: true;
}

/**
 * Serializable subset of a completed silent request. The controller stores
 * these small records in per-chat metadata so an extension reload does not
 * lose the terminal archive queue. MVU snapshots deliberately stay outside
 * this record: duplicating one large snapshot for every future node would
 * make long tower runs progressively slower.
 */
export interface TowerGenerationArchiveRecord extends TowerGenerationTaskKey {
  spec: 'mwg.tower-archive-record/v1';
  prompt: string;
  response: string;
  generationId: string;
  userExtra?: Record<string, any>;
  assistantExtra?: Record<string, any>;
}

export class TowerGenerationHostError extends Error {
  public constructor(
    public readonly code: 'chat_changed' | 'invalid_response' | 'missing_api',
    message: string,
  ) {
    super(message);
    this.name = 'TowerGenerationHostError';
  }
}

export interface TowerGenerationHostOptions {
  queue?: TowerGenerationQueue;
  queueOptions?: TowerGenerationQueueOptions;
  now?: () => number;
  /** Lifecycle evidence only: no prompt, response, provider body or secrets. */
  onAttemptLifecycle?(event: TowerGenerationAttemptLifecycle): void;
  onGenerationRequested?(request: TowerGenerationRequest): void;
  onGenerationCompleted?(request: TowerGenerationRequest, result: TowerGenerationResult): void;
  onGenerationFailed?(request: TowerGenerationRequest, error: unknown): void;
}

export interface TowerGenerationAttemptLifecycle extends TowerGenerationTaskKey {
  generationId: string;
  attempt: number;
  phase: 'transport_invoked' | 'transport_dispatched' | 'transport_response' | 'transport_observed_failure' | 'settled';
  outcome?: 'returned' | 'empty_final' | 'non_text_response' | 'exception' | 'cancelled';
  transportFailure?: Pick<GenerationTransportFailure, 'kind' | 'retryable' | 'evidence' | 'httpStatus'>;
  transportProgress?: Pick<GenerationTransportProgress, 'at' | 'httpStatus' | 'contentType'>;
}

interface RequestProgress {
  response: string | null;
  mechanismRequests?: number;
  emptyFinal?: boolean;
  emptyJsonFallbackUsed?: true;
  generationId: string | null;
  persisted: boolean;
  persistence: Promise<void> | null;
  eventDispatched: boolean;
}

interface DeferredGenerationRecord {
  request: TowerGenerationRequest;
  progress: RequestProgress;
}

function requiredText(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} 不能为空`);
  return normalized;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function generationId(request: TowerGenerationTaskKey, attempt: number): string {
  return `mwg-tower-${stableHash(towerGenerationTaskKey(request))}-${attempt}`;
}

function taggedExtra(
  request: TowerGenerationTaskKey,
  kind: 'request' | 'response',
  extra?: Record<string, any>,
): Record<string, any> {
  return {
    ...(extra || {}),
    mwg_tower_generation: {
      spec: 'mwg.tower-generation/v1',
      kind,
      chatId: request.chatId,
      nodeId: request.nodeId,
      requestId: request.requestId,
      ...(request.runScope ? { runScope: request.runScope } : {}),
    },
  };
}

/**
 * Generates silently during active play, then exposes a low-level archive
 * primitive for run termination or explicit exit.
 */
export class TowerGenerationHost {
  public readonly queue: TowerGenerationQueue;
  private readonly records = new Map<string, DeferredGenerationRecord>();
  private readonly diagnostics: TowerGenerationDiagnostics;

  public constructor(
    private readonly ports: TowerGenerationPorts,
    private readonly options: TowerGenerationHostOptions = {},
  ) {
    this.queue = options.queue || new TowerGenerationQueue(options.queueOptions);
    this.diagnostics = new TowerGenerationDiagnostics(options.now);
  }

  private publishAttemptLifecycle(event: TowerGenerationAttemptLifecycle): void {
    try { this.options.onAttemptLifecycle?.(event); } catch { /* Diagnostics never affect generation. */ }
  }

  public getDiagnostics() {
    const chatId = this.ports.currentChatId();
    return chatId ? this.diagnostics.snapshot(chatId) : [];
  }

  public generateNode(input: TowerGenerationRequest): Promise<TowerGenerationResult> {
    const request: TowerGenerationRequest = {
      ...input,
      chatId: requiredText(input.chatId, 'chatId'),
      nodeId: requiredText(input.nodeId, 'nodeId'),
      requestId: requiredText(input.requestId, 'requestId'),
      prompt: requiredText(input.prompt, 'prompt'),
    };
    const key = towerGenerationTaskKey(request);
    let record = this.records.get(key);
    const created = !record;
    if (!record) {
      record = {
        request,
        progress: {
          response: null,
          generationId: null,
          persisted: false,
          persistence: null,
          eventDispatched: false,
        },
      };
      this.records.set(key, record);
    }

    if (created) this.options.onGenerationRequested?.(request);
    const queued = this.queue.enqueue<TowerGenerationResult>({
      chatId: request.chatId,
      nodeId: request.nodeId,
      requestId: request.requestId,
      ...(request.runScope ? { runScope: request.runScope } : {}),
      timeoutMs: request.timeoutMs,
      maxAttempts: request.maxAttempts,
      shouldRetry: error => !(
        error instanceof TowerGenerationTimeoutError
        || (error instanceof TowerGenerationHostError && error.code !== 'invalid_response')
        || (error instanceof GenerationTransportError && !error.failure.retryable)
      ),
      execute: context => this.executeRequest(record!, context.signal, context.attempt),
    });
    return queued.then(result => { try { this.options.onGenerationCompleted?.(request, result); } catch { /* Evidence must never affect generation. */ } return result; }, error => { try { this.options.onGenerationFailed?.(request, error); } catch { /* Evidence must never affect generation. */ } throw error; });
  }

  /** Current-preset story generation for the active node, sharing the same single-lane queue. */
  public generateNarrative(input: TowerGenerationRequest): Promise<TowerGenerationResult> {
    const request: TowerGenerationRequest = {
      ...input,
      chatId: requiredText(input.chatId, 'chatId'),
      nodeId: requiredText(input.nodeId, 'nodeId'),
      requestId: requiredText(input.requestId, 'requestId'),
      prompt: requiredText(input.prompt, 'prompt'),
    };
    if (typeof this.ports.generateNarrative !== 'function') {
      return Promise.reject(new TowerGenerationHostError('missing_api', 'Tavern Helper 当前预设生成接口缺失'));
    }
    const key = towerGenerationTaskKey(request);
    let record = this.records.get(key);
    const created = !record;
    if (!record) {
      record = {
        request,
        progress: {
          response: null,
          generationId: null,
          persisted: false,
          persistence: null,
          eventDispatched: false,
        },
      };
      this.records.set(key, record);
    }
    if (created) this.options.onGenerationRequested?.(request);
    const queued = this.queue.enqueue<TowerGenerationResult>({
      chatId: request.chatId,
      nodeId: request.nodeId,
      requestId: request.requestId,
      ...(request.runScope ? { runScope: request.runScope } : {}),
      priority: 100,
      timeoutMs: request.timeoutMs,
      // Recovery owns one shared second call. Never multiply it through
      // the queue's generic exception retry budget.
      maxAttempts: request.recoverEmptyNarrative ? 1 : request.maxAttempts,
      shouldRetry: error => !(
        error instanceof TowerGenerationTimeoutError
        || (error instanceof TowerGenerationHostError && error.code !== 'invalid_response')
        || (error instanceof GenerationTransportError && !error.failure.retryable)
      ),
      execute: context => this.executeNarrativeRequest(record!, context.signal, context.attempt),
    });
    return queued.then(result => { try { this.options.onGenerationCompleted?.(request, result); } catch { /* Evidence must never affect generation. */ } return result; }, error => { try { this.options.onGenerationFailed?.(request, error); } catch { /* Evidence must never affect generation. */ } throw error; });
  }

  public activateChat(chatId: string): void {
    this.queue.activateChat(chatId);
    this.diagnostics.retainChat(chatId);
    for (const [key, record] of this.records) {
      if (record.request.chatId !== chatId) this.records.delete(key);
    }
  }

  /** Completed, unarchived records for one run; callers may archive only at a terminal boundary. */
  public listPendingArchiveKeys(chatId: string): TowerGenerationTaskKey[] {
    return [...this.records.values()]
      .filter(record =>
        record.request.chatId === chatId &&
        Boolean(record.progress.response) &&
        Boolean(record.progress.generationId) &&
        !record.progress.persisted,
      )
      .map(record => ({
        chatId: record.request.chatId,
        nodeId: record.request.nodeId,
        requestId: record.request.requestId,
      }));
  }

  /** Export only completed, unarchived records; promises and AbortControllers never enter chat metadata. */
  public exportPendingArchiveRecords(chatId: string): TowerGenerationArchiveRecord[] {
    return [...this.records.values()]
      .filter(record =>
        record.request.chatId === chatId &&
        Boolean(record.progress.response) &&
        Boolean(record.progress.generationId) &&
        !record.progress.persisted,
      )
      .map(record => ({
        spec: 'mwg.tower-archive-record/v1',
        chatId: record.request.chatId,
        nodeId: record.request.nodeId,
        requestId: record.request.requestId,
        prompt: record.request.prompt,
        response: record.progress.response!,
        generationId: record.progress.generationId!,
        ...(record.request.userExtra ? { userExtra: structuredClone(record.request.userExtra) } : {}),
        ...(record.request.assistantExtra
          ? { assistantExtra: structuredClone(record.request.assistantExtra) }
          : {}),
      }));
  }

  /**
   * Release a completed request once its parsed result has been committed to
   * the run state and its completion event has been dispatched. The run state
   * is the authoritative save; retaining the full prompt/response here would
   * duplicate megabytes of data during a long single-floor tower run.
   */
  public releaseCompletedRecord(key: TowerGenerationTaskKey): boolean {
    const fingerprint = towerGenerationTaskKey(key);
    const record = this.records.get(fingerprint);
    if (!record || !record.progress.eventDispatched || record.progress.persistence) return false;
    const deleted = this.records.delete(fingerprint);
    if (deleted) this.queue.forgetSettledRequest(key);
    return deleted;
  }

  /**
   * Release one terminal request that is no longer needed by run persistence.
   * This is used by silent opening prose and by explicit retry after a failed
   * envelope so an old rejected promise cannot shadow the new request.
   */
  public forgetTerminalRecord(key: TowerGenerationTaskKey): boolean {
    const fingerprint = towerGenerationTaskKey(key);
    const record = this.records.get(fingerprint);
    if (!record || record.progress.persistence) return false;
    const status = this.queue.getStatus(key);
    if (status && !['completed', 'failed', 'cancelled'].includes(status.phase)) return false;
    const deleted = this.records.delete(fingerprint);
    this.queue.forgetSettledRequest(key);
    return deleted || Boolean(status);
  }

  /** Drop terminal request text after the run state has already preserved the result. */
  public discardCompletedRecords(chatId: string): number {
    let discarded = 0;
    for (const [fingerprint, record] of this.records) {
      if (
        record.request.chatId === chatId
        && Boolean(record.progress.response)
        && Boolean(record.progress.generationId)
        && !record.progress.persistence
      ) {
        this.records.delete(fingerprint);
        discarded += 1;
      }
    }
    this.queue.forgetSettled(chatId);
    return discarded;
  }

  /** Restore a terminal archive queue after an extension or page reload. */
  public restorePendingArchiveRecords(value: unknown, chatId: string): number {
    if (!Array.isArray(value)) return 0;
    let restored = 0;
    for (const candidate of value.slice(-256)) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const record = candidate as Partial<TowerGenerationArchiveRecord>;
      if (
        record.spec !== 'mwg.tower-archive-record/v1' ||
        record.chatId !== chatId ||
        typeof record.nodeId !== 'string' || !record.nodeId.trim() ||
        typeof record.requestId !== 'string' || !record.requestId.trim() ||
        typeof record.prompt !== 'string' || !record.prompt.trim() ||
        typeof record.response !== 'string' || !record.response.trim() ||
        typeof record.generationId !== 'string' || !record.generationId.trim()
      ) continue;
      const key = towerGenerationTaskKey(record as TowerGenerationTaskKey);
      if (this.records.has(key)) continue;
      this.records.set(key, {
        request: {
          chatId,
          nodeId: record.nodeId,
          requestId: record.requestId,
          prompt: record.prompt,
          ...(record.userExtra && typeof record.userExtra === 'object'
            ? { userExtra: structuredClone(record.userExtra) }
            : {}),
          ...(record.assistantExtra && typeof record.assistantExtra === 'object'
            ? { assistantExtra: structuredClone(record.assistantExtra) }
            : {}),
        },
        progress: {
          response: record.response,
          generationId: record.generationId,
          persisted: false,
          persistence: null,
          // The parsed result was already committed before the metadata record
          // was saved, so reloading must not dispatch the completion twice.
          eventDispatched: true,
        },
      });
      restored += 1;
    }
    return restored;
  }

  /**
   * Low-level archive primitive used only at run termination/explicit exit.
   * Both messages are appended in one Tavern Helper mutation, carrying the
   * full snapshots from before generation and after the final MVU commit.
   */
  public persistNode(
    key: TowerGenerationTaskKey,
    snapshots: { beforeMvuData: Record<string, any>; afterMvuData: Record<string, any> },
  ): Promise<void> {
    return this.persistNodes([{ key, snapshots }]).then(() => undefined);
  }

  /**
   * Archive a complete run in one Tavern Helper mutation. This preserves
   * request/response order, avoids repeated iframe ownership changes, and is
   * still idempotent when a terminal button or event fires more than once.
   */
  public async persistNodes(
    entries: ReadonlyArray<{
      key: TowerGenerationTaskKey;
      snapshots: { beforeMvuData: Record<string, any>; afterMvuData: Record<string, any> };
    }>,
  ): Promise<number> {
    const pending: Array<{
      record: DeferredGenerationRecord;
      snapshots: { beforeMvuData: Record<string, any>; afterMvuData: Record<string, any> };
    }> = [];
    for (const entry of entries) {
      const record = this.records.get(towerGenerationTaskKey(entry.key));
      if (!record?.progress.response || !record.progress.generationId) {
        throw new Error('爬塔后台结果尚未生成，不能持久化');
      }
      if (record.progress.persisted) continue;
      if (record.progress.persistence) {
        await record.progress.persistence;
        return this.persistNodes(entries);
      }
      if (this.ports.currentChatId() !== record.request.chatId) {
        throw new TowerGenerationHostError('chat_changed', '聊天已切换，拒绝持久化旧聊天内容');
      }
      pending.push({ record, snapshots: entry.snapshots });
    }
    if (pending.length === 0) return 0;

    const messages: TowerChatMessage[] = [];
    for (const { record, snapshots } of pending) {
      messages.push(
        {
          role: 'user',
          is_hidden: true,
          message: record.request.prompt,
          data: structuredClone(snapshots.beforeMvuData),
          extra: taggedExtra(record.request, 'request', record.request.userExtra),
        },
        {
          role: 'assistant',
          is_hidden: true,
          message: record.progress.response!,
          data: structuredClone(snapshots.afterMvuData),
          extra: taggedExtra(record.request, 'response', record.request.assistantExtra),
        },
      );
    }
    const persistence = this.ports.createChatMessages(
      messages,
      { insert_before: 'end', refresh: 'none' },
    ).then(() => {
      for (const { record } of pending) record.progress.persisted = true;
    }).finally(() => {
      for (const { record } of pending) {
        if (record.progress.persistence === persistence) record.progress.persistence = null;
      }
    });
    for (const { record } of pending) record.progress.persistence = persistence;
    await persistence;
    return pending.length;
  }

  /** Dispatch only after the controller has committed and replaced latest MVU. */
  public async dispatchCompletion(
    key: TowerGenerationTaskKey,
    payload: TowerGenerationCompletedPayload,
    eventName?: string,
  ): Promise<void> {
    const record = this.records.get(towerGenerationTaskKey(key));
    if (!record) throw new Error('爬塔后台结果记录不存在');
    if (record.progress.eventDispatched) return;
    if (this.ports.currentChatId() !== record.request.chatId) {
      throw new TowerGenerationHostError('chat_changed', '聊天已切换，拒绝派发旧聊天完成事件');
    }
    await this.ports.emitInternalEvent(
      eventName || record.request.eventName || TOWER_GENERATION_COMPLETED_EVENT,
      payload,
    );
    record.progress.eventDispatched = true;
  }

  private async executeRequest(
    record: DeferredGenerationRecord,
    signal: AbortSignal,
    attempt: number,
  ): Promise<TowerGenerationResult> {
    const { request, progress } = record;
    this.assertCurrentChat(request.chatId, signal);
    if (progress.response === null) {
      const currentGenerationId = generationId(request, attempt);
      progress.generationId = currentGenerationId;
      const structureRepair = request.userExtra?.mwg_tower_structure_repair === true
        || request.userExtra?.mwg_tower_batch_structure_repair === true
        || request.userExtra?.mwg_tower_opening_structure_repair === true;
      const fallbackRequested = Boolean(request.generation?.json_schema)
        && (progress.emptyFinal === true || structureRepair && request.continueEmptyFinalRecovery === true);
      const diagnostic = this.diagnostics.begin(request, structureRepair ? 'structure-repair' : 'structured',
        attempt, currentGenerationId, fallbackRequested);
      let deliveryObservation: ReturnType<typeof observeNarrativeDelivery> | undefined;
      try { deliveryObservation = this.ports.observeStructuredDelivery?.(currentGenerationId); } catch { /* Optional diagnostics. */ }
      const recordDelivery = () => {
        try { if (deliveryObservation) diagnostic.observedStructured(deliveryObservation.snapshot()); } catch { /* Optional diagnostics. */ }
      };
      let generationStarted = false;
      const stop = (): void => {
        recordDelivery();
        deliveryObservation?.close();
        diagnostic.failed(signal.reason, true);
        if (!generationStarted) return;
        try {
          this.ports.stopGenerationById(currentGenerationId);
        } catch {
          // Cancellation still prevents any stale result from being committed.
        }
      };
      signal.addEventListener('abort', stop, { once: true });
      try {
        this.assertCurrentChat(request.chatId, signal);
        generationStarted = true;
        progress.mechanismRequests = (progress.mechanismRequests || 0) + 1;
        this.publishAttemptLifecycle({
          chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
          ...(request.runScope ? { runScope: request.runScope } : {}),
          generationId: currentGenerationId, attempt, phase: 'transport_invoked',
        });
        const generated = await this.ports.generate({
          ...(request.generation || {}),
          // Reuse the queue's existing bounded attempt, not a nested retry.
          // Exceptions, non-text envelopes and narrative requests do not opt in.
          empty_json_fallback: fallbackRequested,
          generation_id: currentGenerationId,
          // No chat message is created during active play. Feed the complete
          // request directly to Tavern Helper's silent generation API.
          user_input: request.prompt,
          // Ordinary-text nodes use the same streaming delivery as initial
          // drafts. Helper still resolves one complete final string; nothing
          // is parsed or committed from partial chunks. Keep legacy explicit
          // schema/tool transports unchanged.
          should_stream: request.generation?.structured_delivery === 'text-json',
          should_silence: true,
          on_transport_observed_failure: failure => {
            diagnostic.observedTransportFailure(failure);
            this.publishAttemptLifecycle({
              chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
              ...(request.runScope ? { runScope: request.runScope } : {}),
              generationId: currentGenerationId, attempt, phase: 'transport_observed_failure',
              transportFailure: { kind: failure.kind, retryable: failure.retryable, evidence: failure.evidence,
                ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }) },
            });
          },
          on_transport_progress: event => {
            diagnostic.observedTransportProgress(event);
            this.publishAttemptLifecycle({
              chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
              ...(request.runScope ? { runScope: request.runScope } : {}), generationId: currentGenerationId, attempt,
              phase: event.phase === 'request_dispatched' ? 'transport_dispatched' : 'transport_response',
              transportProgress: { at: event.at, ...(event.httpStatus === undefined ? {} : { httpStatus: event.httpStatus }),
                ...(event.contentType ? { contentType: event.contentType } : {}) },
            });
          },
        });
        this.assertCurrentChat(request.chatId, signal);
        recordDelivery();
        diagnostic.returned(generated, this.ports.takeStructuredResponseDelivery?.(currentGenerationId));
        if (typeof generated !== 'string' || !generated.trim()) {
          progress.emptyFinal = typeof generated === 'string' && !generated.trim();
          const stage = structureRepair ? '结构修正' : '原始结构生成';
          const shape = typeof generated === 'string' ? `文本长度 ${generated.length}` : '非文本响应';
          throw new TowerGenerationHostError('invalid_response', `后台模型没有返回可写入的文本（${stage}，第 ${attempt} 次请求，${shape}）`);
        }
        progress.response = generated;
        progress.emptyJsonFallbackUsed = fallbackRequested ? true : undefined;
        this.publishAttemptLifecycle({
          chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
          ...(request.runScope ? { runScope: request.runScope } : {}),
          generationId: currentGenerationId, attempt, phase: 'settled',
          outcome: typeof generated === 'string' ? generated.trim() ? 'returned' : 'empty_final' : 'non_text_response',
        });
      } catch (error) {
        recordDelivery();
        diagnostic.failed(error, signal.aborted);
        this.publishAttemptLifecycle({
          chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
          ...(request.runScope ? { runScope: request.runScope } : {}),
          generationId: currentGenerationId, attempt, phase: 'settled',
          outcome: signal.aborted ? 'cancelled' : progress.emptyFinal ? 'empty_final' : 'exception',
        });
        throw error;
      } finally {
        deliveryObservation?.close();
        signal.removeEventListener('abort', stop);
      }
    }

    this.assertCurrentChat(request.chatId, signal);
    return {
      response: progress.response,
      generationId: progress.generationId || generationId(request, attempt),
      ...((progress.mechanismRequests || 0) > 1 ? { additionalRequestsUsed: progress.mechanismRequests! - 1 } : {}),
      ...(progress.emptyJsonFallbackUsed ? { emptyJsonFallbackUsed: true as const } : {}),
    };
  }

  private async executeNarrativeRequest(
    record: DeferredGenerationRecord,
    signal: AbortSignal,
    attempt: number,
  ): Promise<TowerGenerationResult> {
    const { request, progress } = record;
    this.assertCurrentChat(request.chatId, signal);
    if (progress.response === null) {
      let recoveryKind: 'empty' | 'transport' = 'empty';
      for (let delivery = 0; delivery < 2; delivery++) {
        const fallback = delivery === 1;
        const emptyFallback = fallback && recoveryKind === 'empty';
        const currentGenerationId = `${generationId(request, attempt)}-story${fallback ? emptyFallback ? '-empty-final' : '-transport-recovery' : ''}`;
        progress.generationId = currentGenerationId;
        const diagnostic = this.diagnostics.begin(request, 'narrative', request.recoverEmptyNarrative ? delivery + 1 : attempt,
          currentGenerationId, false, emptyFallback);
        let deliveryObservation: ReturnType<typeof observeNarrativeDelivery> | undefined;
        try { deliveryObservation = this.ports.observeNarrativeDelivery?.(currentGenerationId); } catch { /* Optional diagnostics. */ }
        const recordDelivery = () => {
          try { if (deliveryObservation) diagnostic.observedNarrative(deliveryObservation.snapshot()); } catch { /* Optional diagnostics. */ }
        };
        let generationStarted = false;
        const stop = (): void => {
          recordDelivery();
          deliveryObservation?.close();
          diagnostic.failed(signal.reason, true);
          if (!generationStarted) return;
          try {
            this.ports.stopGenerationById(currentGenerationId);
          } catch {
            // Aborting the queue still prevents this response from being committed.
          }
        };
        signal.addEventListener('abort', stop, { once: true });
        try {
          this.assertCurrentChat(request.chatId, signal);
          generationStarted = true;
          const generated = await this.ports.generateNarrative!({
            generation_id: currentGenerationId,
            preset_name: 'in_use',
            user_input: request.prompt,
            should_stream: true,
            should_silence: true,
            max_chat_history: 'all',
            ...(emptyFallback ? { empty_narrative_fallback: true } : {}),
          });
          this.assertCurrentChat(request.chatId, signal);
          recordDelivery();
          diagnostic.returned(generated);
          if (!fallback && request.recoverEmptyNarrative && typeof generated === 'string' && !generated.trim()
            && this.ports.canRecoverEmptyNarrative?.() === true) {
            request.onEmptyNarrativeRecovery?.(describeEmptyNarrative(deliveryObservation?.snapshot()));
            continue;
          }
          if (typeof generated !== 'string' || !generated.trim()) {
            const shape = typeof generated === 'string' ? `文本长度 ${generated.length}`
              : generated && typeof generated === 'object' ? '非文本响应' : '无响应';
            throw new TowerGenerationHostError('invalid_response', `剧情模型没有返回可显示正文（${shape}；${describeEmptyNarrative(deliveryObservation?.snapshot())}${fallback ? '；一次备用请求也未成功' : ''}），未开始机制生成`);
          }
          progress.response = generated;
        } catch (error) {
          recordDelivery();
          diagnostic.failed(error, signal.aborted);
          if (!fallback && request.recoverEmptyNarrative
            && error instanceof GenerationTransportError && error.failure.retryable
            && ['server', 'rate_limit'].includes(error.failure.kind)
            && this.ports.canRecoverEmptyNarrative?.() === true) {
            // Scope/cancellation still wins even if the provider delivered a
            // transient failure concurrently. No request settings are changed.
            this.assertCurrentChat(request.chatId, signal);
            recoveryKind = 'transport';
            request.onNarrativeTransportRecovery?.();
            continue;
          }
          throw error;
        } finally {
          deliveryObservation?.close();
          signal.removeEventListener('abort', stop);
        }
        break;
      }
    }
    if (progress.response === null) throw new TowerGenerationHostError('invalid_response', '剧情恢复未产生正文，已停止');
    return {
      response: progress.response,
      generationId: progress.generationId || `${generationId(request, attempt)}-story`,
    };
  }

  private assertCurrentChat(expectedChatId: string, signal: AbortSignal): void {
    if (signal.aborted) {
      throw signal.reason instanceof TowerGenerationCancelledError
        ? signal.reason
        : new TowerGenerationCancelledError();
    }
    if (this.ports.currentChatId() !== expectedChatId) {
      throw new TowerGenerationHostError('chat_changed', '聊天已切换，拒绝写入旧聊天的后台内容');
    }
  }
}

type TavernHelperGenerationApi = {
  createChatMessages?: TowerGenerationPorts['createChatMessages'];
  generate?: TowerGenerationPorts['generate'];
  generateRaw?: TowerGenerationPorts['generate'];
  stopGenerationById?: TowerGenerationPorts['stopGenerationById'];
};

/** Tavern Helper renamed the raw request method to `generate` in newer
 * releases. Keep the raw path preferred because it bypasses preset history,
 * but accept the current public name when `generateRaw` is absent. */
function resolveRawGenerator(helper: TavernHelperGenerationApi | null | undefined): NonNullable<TavernHelperGenerationApi['generateRaw']> | null {
  const raw = helper?.generateRaw;
  if (typeof raw === 'function') return raw.bind(helper);
  const current = helper?.generate;
  return typeof current === 'function' ? current.bind(helper) : null;
}

const PROVIDER_SCHEMA_MAX_DEPTH = 9;

/**
 * SillyTavern 1.18 expands every `$ref` before forwarding a JSON Schema.  The
 * complete effect grammar deliberately reuses recursive card, summon and
 * enemy definitions, so expanding it can grow beyond V8's maximum string
 * length before a request ever reaches DeepSeek.  The exact grammar already
 * lives in the worker prompt and is enforced again by the runtime parser.
 * Send providers only a bounded transport outline: it keeps the response
 * envelope, required fields, constants and primitive limits, but treats a
 * referenced gameplay object as an authored JSON value for the parser to
 * validate.  This is a transport adaptation, not a weaker execution gate.
 */
export function createProviderSafeJsonSchema(
  input: Record<string, any> | null | undefined,
): Record<string, any> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const inputName = typeof input.name === 'string' ? input.name : '';

  const definitions = input.value?.$defs && typeof input.value.$defs === 'object' && !Array.isArray(input.value.$defs)
    ? input.value.$defs as Record<string, any>
    : {};
  // Provider-only outline: the complete schema remains in the request contract
  // and local validator. Avoid repeating conditional schemas at every owner.
  const protectionOutline = (): Record<string, any> => ({
    type: 'object', additionalProperties: false, required: ['mode', 'scope'],
    description: 'specific必须有target_id；all_allies不带target_id。',
    properties: { mode: { enum: ['intercept', 'share_damage'] }, scope: { enum: ['specific', 'all_allies'] }, target_id: { type: 'string' }, priority: { type: 'integer' } },
  });
  const structuralDefinitions = new Set([
    'cardTemplate',
    'mwgCombatResource',
    'mwgActiveStatus',
    'mwgStatusDefinition',
    'mwgNamedEffects',
    'mwgAbility',
    'mwgCard',
    'mwgRewardCard',
    'mwgArtifact',
    'mwgRewardArtifact',
    'mwgItem',
    'mwgRewardItem',
    'mwgInitialStance',
    'mwgInitialOrb',
    'mwgEnemyAction',
    'mwgEnemyAbility',
    'mwgEnemyNamedEffects',
    'mwgEnemy',
  ]);
  const triggerDefinitions = new Set([
    'mwgAbilityTrigger',
    'mwgCardTrigger',
    'mwgEnemyAbilityTrigger',
    'mwgSummonAbilityTrigger',
    'abilityTriggerInput',
  ]);
  const shallowValueDefinitions = new Set([
    'formula',
    'formulaString',
    'damageProtection', 'mwgDamageProtection',
    'nonZeroFormula',
    'target',
    'enemyTargetSelector',
    'summonSelector',
    'summonAmountInput',
    'summonResource',
    'resourceId',
    'cardCost',
    'cardZone',
    'cardPick',
    'cardTypeFilter',
    'cardRarityFilter',
    'cardTagFilter',
    'cardOriginFilter',
    'entityResource',
    'activeStatus',
    'stanceDefinition',
    'orbDefinition',
    'initialOrbDefinition',
  ]);
  const initialRepairEffectDefinitions = new Set([
    'amountEffect',
    'healEffect',
    'blockEffect',
    'energyEffect',
    'lustEffect',
    'setEffect',
    'drawEffect',
    'applyStatusEffect',
    'removeStatusEffect',
    'resourceEffect',
    'moveCardEffect',
    'recoverEffect',
    'advancedZoneEffect',
    'selectCardEffect',
    'reduceCostEffect',
    'modifierEffect',
    'cardPlayRuleEffect',
    'choiceEffect',
  ]);

  type EffectOutlineBranch = {
    properties: Record<string, unknown>;
    required: string[];
  };

  function collectEffectOutlineBranches(
    value: unknown,
    inheritedProperties: Record<string, unknown> = {},
    inheritedRequired: string[] = [],
    trail: ReadonlySet<string> = new Set(),
  ): EffectOutlineBranch[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const source = value as Record<string, any>;
    if (typeof source.$ref === 'string') {
      const name = source.$ref.split('/').at(-1) || '';
      if (!name || trail.has(name) || /effectlist/i.test(name)) return [];
      return collectEffectOutlineBranches(
        definitions[name],
        inheritedProperties,
        inheritedRequired,
        new Set([...trail, name]),
      );
    }
    const properties = {
      ...inheritedProperties,
      ...(source.properties && typeof source.properties === 'object' ? source.properties : {}),
    };
    const required = [
      ...inheritedRequired,
      ...(Array.isArray(source.required) ? source.required.filter((entry: unknown) => typeof entry === 'string') : []),
    ];
    const alternatives = Array.isArray(source.oneOf)
      ? source.oneOf
      : Array.isArray(source.anyOf)
        ? source.anyOf
        : null;
    if (alternatives?.length) {
      const branches = alternatives.flatMap(entry => (
        collectEffectOutlineBranches(entry, properties, required, trail)
      ));
      if (branches.length) return branches;
    }
    return Object.keys(properties).length ? [{ properties, required }] : [];
  }

  /**
   * A finite, non-recursive view of the public effect vocabulary. It gives a
   * provider the real operation keys and their immediate value shapes while
   * nested effect lists terminate as generic non-empty objects. This prevents
   * the old `operation/target/amount` guessing without recreating the cyclic
   * card -> summon -> card graph that SillyTavern expands eagerly.
   */
  function publicEffectOutline(): Record<string, any> {
    const branches = collectEffectOutlineBranches(definitions.effect);
    const properties: Record<string, any> = {};
    for (const branch of branches) {
      for (const key of Object.keys(branch.properties)) {
        // `on` is a legacy save spelling. New generated triggers live on the
        // owning card, ability, relic or summon ability instead.
        if (key === 'on' || properties[key] !== undefined) continue;
        properties[key] = {};
      }
    }

    const selector = { type: 'object' };
    const enemyTargetSelector = {
      type: 'object',
      properties: {
        mode: { enum: ['active', 'by_id', 'all', 'random', 'random_n', 'lowest_hp', 'highest_hp'] },
        id: { type: 'string', minLength: 1 },
        count: { type: 'integer', minimum: 1, maximum: 100 },
        allow_repeat: { type: 'boolean' },
        retarget: { enum: ['locked', 'each_hit'] },
      },
      required: ['mode'],
      additionalProperties: false,
    };
    // Formula syntax is explained once in the compact prompt; duplicating its
    // scalar union into every arithmetic slot would consume the transport
    // budget without adding operation-shape guidance.
    const formula: Record<string, any> = {};
    const nestedEffectList = {
      anyOf: [
        { type: 'object', minProperties: 1 },
        { type: 'array', minItems: 1, maxItems: 256, items: { type: 'object', minProperties: 1 } },
      ],
    };
    const createdCards = { type: 'array', maxItems: 32, items: { type: 'object', minProperties: 1 } };
    const summonAmount = {
      type: 'object',
      properties: { selector, amount: formula },
      required: ['selector', 'amount'],
      additionalProperties: false,
    };
    // `to` is overloaded: entity effects address an owner, while card-zone
    // operations address hand/deck/discard. Project the union of the actual
    // public field shapes rather than applying the entity enum to every op.
    for (const field of ['to', 'from', 'pick']) {
      const alternatives = [...new Map(branches
        .filter(branch => branch.properties[field] !== undefined)
        .map(branch => {
          const shape = outlineDefinition(branch.properties[field], 0, new Set());
          return [JSON.stringify(shape), shape] as const;
        })).values()];
      const enumOnly = alternatives.every(shape =>
        Object.keys(shape).length === 1 && (Array.isArray(shape.enum) || Object.hasOwn(shape, 'const')));
      if (alternatives.length) properties[field] = enumOnly
        ? { enum: [...new Set(alternatives.flatMap(shape => shape.enum ?? [shape.const]))] }
        : alternatives.length === 1 ? alternatives[0] : { anyOf: alternatives };
    }
    properties.targets = enemyTargetSelector;
    properties.when = { type: 'string', minLength: 1 };
    properties.spawn_summon = {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
        name: { type: 'string', minLength: 1 }, emoji: { type: 'string', minLength: 1 },
        description: { type: 'string' }, has_hp: { type: 'boolean' },
        max_hp: { type: 'number', exclusiveMinimum: 0 }, block: { type: 'number', minimum: 0 },
        tags: { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true,
          items: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' } },
        resources: { type: 'object', maxProperties: 16 },
        modifiers: { type: 'object',
          description: '每个 modifier 的值只能是有限数字；不能写 self/opponent、公式、对象或目标名。',
          properties: Object.fromEntries(['damage_modifier', 'damage_taken_modifier', 'lust_damage_modifier',
            'lust_damage_taken_modifier', 'heal_modifier', 'block_modifier'].map(key => [key, { type: 'number' }])),
          additionalProperties: false },
        actions: { type: 'array', minItems: 1, maxItems: 20, items: {
          type: 'object', properties: {
            id: { type: 'string' }, name: { type: 'string' }, emoji: { type: 'string' },
            description: { type: 'string' }, weight: { type: 'number' }, fixed: { type: 'boolean' },
            effects: { anyOf: [{ type: 'object' }, { type: 'array', items: { type: 'object' } }] },
            when: { type: 'string' }, creates: { type: 'array', items: { type: 'object' } },
          }, required: ['id', 'name', 'effects'], additionalProperties: false,
        } },
        abilities: { type: 'array', minItems: 1, maxItems: 20, items: {
          type: 'object', properties: {
            id: { type: 'string' }, name: { type: 'string' }, emoji: { type: 'string' },
            description: { type: 'string' }, fixed: { type: 'boolean' }, trigger: triggerOutline('mwgSummonAbilityTrigger'),
            creates: { type: 'array', items: { type: 'object' } },
          }, required: ['id', 'trigger'], additionalProperties: false,
        } },
        actions_per_activation: { type: 'integer', minimum: 0, maximum: 20 },
        action_priority: { type: 'integer' }, speed: { type: 'integer' },
        intercept: { type: 'object', properties: {
          mode: { const: 'unblocked_attack' }, priority: { type: 'integer' },
          max_per_turn: { type: 'integer', minimum: 1 },
        }, required: ['mode'], additionalProperties: false },
        slot: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
        on_existing: { enum: ['reinforce', 'replace'] },
        on_defeated: { enum: ['new_instance', 'revive_reset', 'revive_reinforce'] },
        retain_corpse: { type: 'boolean' },
        capabilities: { type: 'object', properties: {
          selectable: { type: 'boolean' }, accepts_status: { type: 'boolean' },
          acts: { type: 'boolean' }, intercepts: { type: 'boolean' },
        }, additionalProperties: false },
        count: formula, capacity: { type: 'integer', minimum: 1 },
        overflow: { enum: ['reject', 'replace_oldest', 'replace_lowest_hp'] },
      }, required: ['id', 'name', 'emoji'], additionalProperties: false,
    };
    // Keep the authored enemy wrapper finite but explicit. In particular,
    // count/capacity belong inside spawn_enemy; leaving this operation as an
    // arbitrary object made providers close the enemy too early and emit both
    // fields beside spawn_enemy, producing invalid JSON before runtime
    // validation could give a useful path.
    properties.spawn_enemy = {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
        name: { type: 'string', minLength: 1 },
        emoji: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        victory_on_defeat: { type: 'boolean' },
        max_hp: { type: 'number', exclusiveMinimum: 0 },
        hp: { type: 'number', minimum: 0 },
        max_lust: { type: 'number', exclusiveMinimum: 0 },
        lust: { type: 'number', minimum: 0 },
        block: { type: 'number', minimum: 0 },
        actions: {
          type: 'array', minItems: 1, maxItems: 24,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
              name: { type: 'string', minLength: 1 },
              emoji: { type: 'string' },
              description: { type: 'string' },
              dialogue: { type: 'string', minLength: 1 },
              weight: { type: 'number', exclusiveMinimum: 0 },
              when: { type: 'string', minLength: 1 },
              creates: createdCards,
              effects: nestedEffectList,
            },
            required: ['name', 'effects'],
            additionalProperties: false,
          },
        },
        abilities: {
          type: 'array', maxItems: 24,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
              name: { type: 'string', minLength: 1 },
              source: { type: 'string', minLength: 1 },
              emoji: { type: 'string' },
              description: { type: 'string' },
              creates: createdCards,
              trigger: { anyOf: [triggerOutline('mwgEnemyAbilityTrigger'), { type: 'object', properties: { on: { const: 'passive' }, effects: { type: 'object', maxProperties: 0 } }, required: ['on', 'effects'], additionalProperties: false }] },
              protection: protectionOutline(),
            },
            required: ['id', 'name', 'trigger'],
            additionalProperties: false,
          },
        },
        status_effects: {
          type: 'array', maxItems: 64,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
              stacks: { type: 'integer', minimum: 1, maximum: 999 },
            },
            required: ['id', 'stacks'],
            additionalProperties: false,
          },
        },
        lust_effect: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            emoji: { type: 'string' },
            description: { type: 'string' },
            creates: createdCards,
            when: { type: 'string', minLength: 1 },
            effects: nestedEffectList,
          },
          required: ['name', 'effects'],
          additionalProperties: false,
        },
        action_mode: { enum: ['random', 'probability', 'sequence', 'sequence_then_probability'] },
        action_config: {
          type: 'object',
          properties: {
            probability: {
              type: 'object', minProperties: 1, maxProperties: 24,
              additionalProperties: { type: 'number', exclusiveMinimum: 0 },
            },
            sequence: {
              type: 'array', minItems: 1, maxItems: 100,
              items: { type: 'string', minLength: 1 },
            },
          },
          additionalProperties: false,
        },
        action_priority: { type: 'integer', minimum: -999, maximum: 999 },
        speed: { type: 'integer', minimum: -999, maximum: 999 },
        tags: {
          type: 'array', maxItems: 32, uniqueItems: true,
          items: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
        },
        resources: {
          type: 'array', maxItems: 16,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
              name: { type: 'string', minLength: 1 },
              emoji: { type: 'string', minLength: 1 },
              start: { type: 'integer', minimum: 0 },
              current: { type: 'integer', minimum: 0 },
              max: { type: 'integer', minimum: 1 },
              refresh: { enum: ['reset', 'retain'] },
            },
            required: ['id', 'name', 'emoji', 'max', 'refresh'],
            anyOf: [{ required: ['start'] }, { required: ['current'] }],
            additionalProperties: false,
          },
        },
        stance: {
          anyOf: [
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
                name: { type: 'string', minLength: 1 },
                emoji: { type: 'string' },
                description: { type: 'string' },
                enter: nestedEffectList,
                exit: nestedEffectList,
                passive: passiveEffectListOutline(),
              },
              required: ['id', 'name'],
              additionalProperties: false,
            },
            { type: 'null' },
          ],
        },
        orb_slots: { type: 'integer', minimum: 0, maximum: 20 },
        orbs: {
          type: 'array', maxItems: 20,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
              name: { type: 'string', minLength: 1 },
              emoji: { type: 'string' },
              description: { type: 'string' },
              value: { type: 'number', minimum: 0 },
              passive: nestedEffectList,
              evoke: nestedEffectList,
            },
            required: ['id', 'name', 'value'],
            additionalProperties: false,
          },
        },
        count: formula,
        capacity: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      },
      required: ['id', 'name', 'emoji', 'max_hp', 'hp', 'max_lust', 'lust', 'actions'],
      additionalProperties: false,
    };
    properties.damage_summon = summonAmount;
    properties.heal_summon = summonAmount;
    properties.modify_summon = {
      type: 'object',
      properties: {
        selector,
        stat: { enum: ['max_hp', 'block', 'actions_per_activation', 'speed', 'action_priority'] },
        add: formula, subtract: formula, multiply: formula, divide: formula, set: formula,
      },
      required: ['selector', 'stat'],
      additionalProperties: false,
    };
    properties.modify_summon_effect = {
      type: 'object',
      properties: {
        selector,
        stat: { enum: ['damage', 'block', 'lust', 'stacks'] },
        add: formula, subtract: formula, multiply: formula, divide: formula,
      },
      required: ['selector', 'stat'],
      additionalProperties: false,
    };
    properties.guard = { type: 'string', minLength: 1 };
    return {
      type: 'object',
      minProperties: 1,
      properties,
      additionalProperties: false,
      allOf: [{
        if: { required: ['guard'] },
        then: {
          required: ['effects'],
          propertyNames: { enum: ['guard', 'effects'] },
          properties: { effects: { type: 'array', minItems: 1, maxItems: 256,
            items: { type: 'object', minProperties: 1 } } },
        },
      }],
    };
  }

  const cardRuleFields = createCardRuleFieldOutline();
  const PASSIVE_EFFECT_OUTLINE: Record<string, any> = {
    type: 'object',
    properties: {
      modify: { enum: ['damage', 'damage_taken', 'lust', 'lust_taken', 'heal', 'block', 'summon_capacity', 'draw_per_turn'] },
    },
    // An empty property schema constrains no values. A name whitelist is
    // equivalent to those empty entries plus additionalProperties:false, but
    // avoids repeating a second field table at each passive array location.
    propertyNames: { enum: ['modify', 'add', 'subtract', 'multiply', 'divide', 'set', ...Object.keys(cardRuleFields.properties)] },
    anyOf: [{ required: ['modify'] }, { required: ['card_rule'] }],
    not: { required: ['modify', 'card_rule'] },
    allOf: [cardRuleFields.constraint],
  };

  const passiveEffectListOutline = (): Record<string, any> => {
    return {
      anyOf: [
        PASSIVE_EFFECT_OUTLINE,
        { type: 'array', minItems: 1, maxItems: 64, items: PASSIVE_EFFECT_OUTLINE },
      ],
    };
  };

  // Status definitions can appear below every reward candidate. Expanding the
  // complete passive selector vocabulary at each of those positions exceeds
  // SillyTavern's safe provider-schema budget, so the status-local projection
  // keeps the language boundary and authoritative per-rule field relations.
  // Filters/formulas remain described once in the prompt and fully validated
  // by the runtime parser; forbidden rule fields must not be advertised here.
  const compactPassiveEffectListOutline = (): Record<string, any> => {
    const item = {
      type: 'object',
      properties: {
        modify: { enum: ['damage', 'damage_taken', 'lust', 'lust_taken', 'heal', 'block', 'summon_capacity', 'draw_per_turn'] },
        card_rule: {},
      },
      anyOf: [{ required: ['modify'] }, { required: ['card_rule'] }],
      not: { required: ['modify', 'card_rule'] },
      allOf: [cardRuleFields.constraint],
    };
    return {
      anyOf: [
        item,
        { type: 'array', minItems: 1, maxItems: 64, items: item },
      ],
    };
  };

  const triggerOutline = (name = 'mwgAbilityTrigger'): Record<string, any> => {
    const isCard = name === 'mwgCardTrigger';
    const allowsPassive = name !== 'mwgSummonAbilityTrigger';
    const triggers = (isCard ? REGISTERABLE_EFFECT_TRIGGERS : ABILITY_TRIGGERS)
      .filter(trigger => trigger !== 'passive');
    const nonPassive = {
      type: 'object',
      description: 'trigger 根部禁止 when；条件写入具体 effects 项。',
      properties: {
        on: { enum: triggers },
        effects: eventEffectListOutline(),
        scope: { enum: ['turn', 'combat', 'run', 'card_instance', 'team'] },
        ordinal: {
          enum: ['first', 'nth', 'every_n'],
          description: 'first 无 n；nth/every_n 必须有正整数 n。',
        },
        n: { type: 'integer', minimum: 1 },
        event: {}, phase: {}, reason: {}, source_kind: {}, source_id: {},
        damage_type: {}, card_type: {}, template_id: {}, card_instance_id: {}, actor_id: {}, target_id: {},
      },
      required: ['on', 'effects'],
      additionalProperties: false,
    };
    if (!allowsPassive) return nonPassive;
    return {
      oneOf: [
        nonPassive,
        {
          type: 'object',
          properties: {
            on: { const: 'passive' },
            effects: compactPassiveEffectListOutline(),
          },
          required: ['on', 'effects'],
          additionalProperties: false,
        },
      ],
    };
  };

  const effectItemOutline = (): Record<string, any> => ({ type: 'object', minProperties: 1 });

  /**
   * Preserve only a composite operation's public field names and immediate
   * primitive/container kinds. The model authors the compact card DSL; the
   * backend remains responsible for compiling effectProgram/steps and other
   * runtime-only fields. Expanding nested runtime structure here would both
   * duplicate that responsibility and exceed SillyTavern's schema budget.
   */
  const shallowCompositeOperationOutline = (
    value: unknown,
    includeProperties = true,
  ): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const source = value as Record<string, any>;
    const result: Record<string, any> = {};
    for (const key of ['type', 'const', 'enum']) {
      if (source[key] !== undefined) result[key] = structuredClone(source[key]);
    }
    if (includeProperties && source.properties && typeof source.properties === 'object') {
      result.properties = Object.fromEntries(
        Object.entries(source.properties).map(([key, entry]) => {
          const child = shallowCompositeOperationOutline(entry, false);
          if (child.type === 'array' && (entry as any)?.items) {
            child.items = shallowCompositeOperationOutline((entry as any).items, false);
          }
          return [key, child];
        }),
      );
    }
    if (Array.isArray(source.required)) result.required = structuredClone(source.required);
    if (source.additionalProperties === false && result.properties) result.additionalProperties = false;
    return result;
  };

  const finiteInitialRepairEffectOutline = (name: string): Record<string, any> => {
    const branches = collectEffectOutlineBranches(definitions[name]).map(branch => ({
      type: 'object',
      properties: Object.fromEntries(Object.entries(branch.properties).filter(([key]) => key !== 'on')
        .map(([key, value]) => [key, shallowCompositeOperationOutline(value)])),
      required: [...new Set(branch.required.filter(key => key !== 'on'))],
      additionalProperties: false,
    }));
    return branches.length === 1 ? branches[0] : branches.length ? { oneOf: branches } : {};
  };
  const authoredEffectItemOutline = (): Record<string, any> => {
    const outline = publicEffectOutline();
    const summon = outline.properties?.spawn_summon;
    const shallow = summon ? shallowCompositeOperationOutline(summon) : null;
    if (shallow) {
      shallow.description = '禁用 hp/power/根 trigger/on_destroyed；生命写 max_hp，行动/能力写数组。普通召唤省略 slot/on_existing/on_defeated；固定槽生命周期才写 slot 和至少一个公开枚举。';
      for (const key of ['modifiers', 'intercept', 'capabilities']) {
        if (summon.properties?.[key]) shallow.properties[key] = key === 'capabilities' ? structuredClone(summon.properties[key]) : shallowCompositeOperationOutline(summon.properties[key]);
      }
      shallow.oneOf = [
        { not: { anyOf: ['slot', 'on_existing', 'on_defeated'].map(key => ({ required: [key] })) } },
        { required: ['slot'], anyOf: [{ required: ['on_existing'] }, { required: ['on_defeated'] }] },
      ];
    }
    return {
      type: 'object', minProperties: 1,
      properties: {
        hits: { type: 'integer', minimum: 1 }, when: { type: 'string', minLength: 1 },
        to: outline.properties.to, from: outline.properties.from, pick: outline.properties.pick,
        ...(shallow ? { spawn_summon: shallow } : {}),
      },
      not: { anyOf: ['trigger', 'operation', 'target', 'value', 'source', 'amount', 'hit', 'add_status', 'modify', 'card_rule', 'on'].map(key => ({ required: [key] })) },
    };
  };
  const eventEffectItemOutline = (): Record<string, any> => ({
    type: 'object', minProperties: 1,
    properties: { modify: false, card_rule: false, on: false, trigger: false, guard: { type: 'string', minLength: 1 } },
    allOf: [{ if: { required: ['guard'] }, then: {
      required: ['effects'], propertyNames: { enum: ['guard', 'effects'] },
      properties: { effects: { type: 'array', minItems: 1, maxItems: 256, items: effectItemOutline() } },
    } }],
  });
  let usesEffectListOutline = false;
  const effectListOutline = (name: string): Record<string, any> => {
    usesEffectListOutline = true;
    const item = ['effectList', 'mwgCardEffectList', 'mwgPowerImmediateEffectList', 'mwgPowerStatusEffectList', 'mwgEventEffectList', 'mwgEnemyEffectList', 'mwgSummonEffectList', 'mwgThresholdExecuteEffectList'].includes(name) && definitions.mwgPublicEffect
      ? eventEffectItemOutline() : effectItemOutline();
    return { anyOf: [item, { type: 'array', minItems: 1, items: item }] };
  };
  const authoredEffectListOutline = (): Record<string, any> => ({
    anyOf: [authoredEffectItemOutline(), { type: 'array', minItems: 1, items: authoredEffectItemOutline() }],
  });
  const eventEffectListOutline = (): Record<string, any> => ({
    
    anyOf: [eventEffectItemOutline(), { type: 'array', minItems: 1, maxItems: 256, items: eventEffectItemOutline() }],
  });
  let usesStatusOutline = false;
  const statusDefinitionOutline = (): Record<string, any> => {
    usesStatusOutline = true;
    return {
      type: 'object', properties: {
        id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
        name: { type: 'string', minLength: 1 }, emoji: { type: 'string', minLength: 1 },
        description: { type: 'string' }, type: { enum: ['buff', 'debuff', 'neutral'] },
        stacks_change: { anyOf: [{ type: 'number' }, { enum: ['keep', 'reset'] }, { type: 'string', pattern: '^x(?:\\d+(?:\\.\\d+)?|\\.\\d+)$' }] },
        maxStacks: { type: 'integer', minimum: 1, maximum: 999 }, stun: { type: 'boolean' }, character_emoji: CHARACTER_EMOJI_SCHEMA, protection: protectionOutline(), tick_timing: { enum: ['before_action', 'after_action'] },
        triggers: { type: 'object', properties: { hold: compactPassiveEffectListOutline() }, additionalProperties: eventEffectListOutline() },
      }, required: ['id', 'name', 'emoji', 'type', 'triggers'], additionalProperties: false,
    };
  };
  function outlineReference(name: string, trail: ReadonlySet<string> = new Set()): Record<string, any> {
    if (name === 'damageProtection' || name === 'mwgDamageProtection') return protectionOutline();
    if (triggerDefinitions.has(name)) return triggerOutline(name);
    if (/trigger/i.test(name)) return triggerOutline();
    if (name === 'mwgPassiveEffectList') return passiveEffectListOutline();
    if (/effectlist/i.test(name) || name === 'effectList') return effectListOutline(name);
    if (name === 'mwgStatusDefinition') return statusDefinitionOutline();
    if (inputName === 'mwg_tower_initial_slot_repair' && initialRepairEffectDefinitions.has(name)) return finiteInitialRepairEffectOutline(name);
    if ((!structuralDefinitions.has(name) && !shallowValueDefinitions.has(name)) || trail.has(name)) return {};
    const source = definitions[name];
    return !source || typeof source !== 'object' || Array.isArray(source) ? {} : outlineDefinition(source, 0, new Set([...trail, name]));
  }
  function outlineDefinition(value: unknown, depth: number, trail: ReadonlySet<string>): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const source = value as Record<string, any>;
    if (typeof source.$ref === 'string') return outlineReference(source.$ref.split('/').at(-1) || '', trail);
    const result: Record<string, any> = {};
    for (const key of ['type', 'const', 'enum', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'uniqueItems']) {
      if (source[key] !== undefined) result[key] = structuredClone(source[key]);
    }
    if (depth < 4 && source.properties && typeof source.properties === 'object') {
      const authoredCardEffectOwner = [...trail].some(name => name === 'mwgCard');
      const rewardCandidateOwner = [...trail].some(name => ['mwgRewardCard', 'mwgRewardArtifact', 'mwgRewardItem'].includes(name));
      result.properties = Object.fromEntries(
        Object.entries(source.properties).map(([key, entry]) => {
          if (
            key === 'creates' && entry && typeof entry === 'object' && !Array.isArray(entry) &&
            (entry as Record<string, any>).type === 'array'
          ) {
            const creates = entry as Record<string, any>;
            return [key, {
              type: 'array',
              ...(creates.maxItems === undefined ? {} : { maxItems: creates.maxItems }),
              // The authoritative prompt explains complete generated-card
              // templates once. Expanding that template under every owner
              // duplicates card/status/trigger branches many times in the
              // provider-only outline and pushes the actual instructions out
              // of focus for JSON-mode providers.
              items: { type: 'object', minProperties: 1 },
            }];
          }
          if (key === 'effects' && authoredCardEffectOwner) {
            return [key, authoredEffectListOutline()];
          }
          if (rewardCandidateOwner && key === 'status') {
            return [key, { type: 'object', description: '兼容单个状态定义；完整字段与同级 statuses 数组元素一致。' }];
          }
          if (
            rewardCandidateOwner && key === 'statuses' && entry && typeof entry === 'object' &&
            !Array.isArray(entry) && (entry as Record<string, any>).type === 'array'
          ) {
            const statuses = entry as Record<string, any>;
            return [key, {
              type: 'array',
              ...(statuses.minItems === undefined ? {} : { minItems: statuses.minItems }),
              ...(statuses.maxItems === undefined ? {} : { maxItems: statuses.maxItems }),
              items: statusDefinitionOutline(),
            }];
          }
          return [key, outlineDefinition(entry, depth + 1, trail)];
        }),
      );
      if ([...trail].some(name => name === 'mwgCard')) {
        // A Power without a root trigger is legal only when every immediate
        // effect applies a registered persistent status. This compact provider
        // condition mirrors the authoritative mwgPowerStatusEffectList without
        // expanding the recursive gameplay grammar.
        const appliesStatus = { type: 'object', required: ['apply_status'] };
        result.allOf = [{
          if: { properties: { type: { const: 'Power' } }, required: ['type'] },
          then: {
            anyOf: [
              { required: ['trigger'] },
              {
                required: ['effects'],
                properties: {
                  effects: {
                    anyOf: [
                      appliesStatus,
                      { type: 'array', minItems: 1, items: appliesStatus },
                    ],
                  },
                },
              },
            ],
          },
        }];
      }
    }
    if (depth < 4 && source.items !== undefined) {
      result.items = outlineDefinition(source.items, depth + 1, trail);
    }
    if (depth < 3) {
      for (const key of ['oneOf', 'anyOf']) {
        if (!Array.isArray(source[key])) continue;
        result[key] = source[key].map((entry: unknown) => outlineDefinition(entry, depth + 1, trail));
      }
    }
    if (Array.isArray(source.required)) result.required = structuredClone(source.required);
    if (source.additionalProperties === false && result.properties) result.additionalProperties = false;
    return result;
  }

  function mergeTowerNodeAlternatives(value: unknown): Record<string, any> | null {
    if (!Array.isArray(value) || value.length < 2) return null;
    const entries = value.filter((entry): entry is Record<string, any> => (
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    ));
    if (entries.length !== value.length || entries.some(entry => (
      entry.properties?.spec?.const !== 'mwg.tower-node-result/v1' ||
      typeof entry.properties?.node_id?.const !== 'string' ||
      typeof entry.properties?.request_id?.const !== 'string'
    ))) return null;

    const first = entries[0];
    const properties = structuredClone(first.properties || {});
    for (const key of ['node_id', 'request_id', 'kind'] as const) {
      const values = [...new Set(entries.map(entry => entry.properties?.[key]?.const).filter(value => value !== undefined))];
      properties[key] = {
        type: key === 'kind' || key.endsWith('_id') ? 'string' : undefined,
        enum: values,
      };
      if (properties[key].type === undefined) delete properties[key].type;
    }
    const payloads = [...new Map(entries.map(entry => [JSON.stringify(entry.properties?.payload || {}), entry.properties?.payload || {}])).values()];
    // Encounter roster sizes can differ by node identity. Share the complete
    // payload shape while retaining the union of allowed roster lengths.
    const rosterGroups = new Map<string, { payload: Record<string, any>; bounds: Record<string, any>[] }>();
    for (const payload of payloads) {
      const shape = structuredClone(payload);
      const roster = shape.properties?.battle?.properties?.enemies;
      const bounds: Record<string, any> = {};
      if (roster) for (const key of ['minItems', 'maxItems']) {
        if (roster[key] !== undefined) { bounds[key] = roster[key]; delete roster[key]; }
      }
      const key = JSON.stringify(shape);
      const group = rosterGroups.get(key);
      if (group) group.bounds.push(bounds);
      else rosterGroups.set(key, { payload: shape, bounds: [bounds] });
    }
    const mergedPayloads = [...rosterGroups.values()].map(({ payload, bounds }) => {
      const roster = payload.properties?.battle?.properties?.enemies;
      if (roster) {
        const unique = [...new Map(bounds.map(bound => [JSON.stringify(bound), bound])).values()];
        if (unique.length === 1) Object.assign(roster, unique[0]);
        else roster.allOf = [...(roster.allOf || []), { anyOf: unique }];
      }
      return payload;
    });
    properties.payload = mergedPayloads.length === 1 ? mergedPayloads[0] : { anyOf: mergedPayloads };
    const rewards = [...new Map(entries.map(entry => [JSON.stringify(entry.properties?.reward || {}), entry.properties?.reward || {}])).values()];
    properties.reward = rewards.length === 1 ? rewards[0] : { type: 'object' };
    const required = Array.isArray(first.required)
      ? first.required.filter((key: string) => entries.every(entry => Array.isArray(entry.required) && entry.required.includes(key)))
      : undefined;
    return {
      type: 'object',
      properties,
      ...(required ? { required } : {}),
      additionalProperties: false,
    };
  }

  const compact = (value: unknown, depth = 0): unknown => {
    if (value === true || value === false) return value;
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return depth < PROVIDER_SCHEMA_MAX_DEPTH
        ? value.map(entry => compact(entry, depth + 1)).filter(entry => entry !== undefined)
        : undefined;
    }
    const source = value as Record<string, any>;

    // Never forward a reference or definitions table. SillyTavern resolves
    // those recursively before it reaches the provider-specific adapter.
    if (typeof source.$ref === 'string') {
      const definitionName = source.$ref.split('/').at(-1) || '';
      return outlineReference(definitionName);
    }
    const result: Record<string, any> = {};
    for (const key of [
      'type',
      'title',
      'const',
      'enum',
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'minLength',
      'maxLength',
      'pattern',
      'minItems',
      'maxItems',
      'minProperties',
      'maxProperties',
      'uniqueItems',
    ]) {
      if (source[key] !== undefined) result[key] = structuredClone(source[key]);
    }
    if (depth < PROVIDER_SCHEMA_MAX_DEPTH && source.properties && typeof source.properties === 'object') {
      result.properties = Object.fromEntries(
        Object.entries(source.properties).map(([key, entry]) => [key, compact(entry, depth + 1)]),
      );
      // New tower authoring uses the roster form even for one enemy. Keep the
      // legacy singular alias available but avoid duplicating a full 9 KB
      // enemy outline in every provider request.
      if (result.properties.enemy && result.properties.enemies) {
        result.properties.enemy = { type: 'object' };
      }
    }
    if (depth < PROVIDER_SCHEMA_MAX_DEPTH && source.items !== undefined) {
      result.items = compact(source.items, depth + 1);
    }
    if (depth < PROVIDER_SCHEMA_MAX_DEPTH - 1) {
      for (const key of ['oneOf', 'anyOf', 'allOf']) {
        if (!Array.isArray(source[key])) continue;
        result[key] = source[key]
          .map((entry: unknown) => compact(entry, depth + 1))
          .filter((entry: unknown) => entry !== undefined);
      }
    }
    if (Array.isArray(source.required)) result.required = structuredClone(source.required);
    if (source.additionalProperties === false && result.properties) result.additionalProperties = false;
    return mergeTowerNodeAlternatives(result.oneOf) ?? result;
  };

  const outlined = compact(input.value);
  if (!isRecord(outlined)) return undefined;
  // Acquisitions and individual defeat rewards repeat the same reward grammar
  // already exposed at the root. Keep public field names/container bounds here;
  // compilation and finite repair still use the unabridged authoritative schema.
  const boundNestedRewards = (schema: any): void => {
    if (!isRecord(schema)) return;
    for (const field of ['on_acquire', 'defeat_reward']) {
      const reward = schema.properties?.[field];
      if (!isRecord(reward?.properties)) continue;
      reward.properties = Object.fromEntries(Object.entries(reward.properties).map(([key, entry]) => {
        if (!isRecord(entry)) return [key, entry];
        const shallow = shallowCompositeOperationOutline(entry, false);
        for (const bound of ['minimum', 'maximum', 'minItems', 'maxItems']) {
          if (entry[bound] !== undefined) shallow[bound] = entry[bound];
        }
        // A shallow object has no advertised field whitelist. Keeping required
        // names is safe, but not additionalProperties:false without properties.
        if (entry.type === 'array') shallow.items = shallowCompositeOperationOutline(entry.items, false);
        return [key, shallow];
      }));
    }
    for (const key of ['properties', 'patternProperties']) {
      if (isRecord(schema[key])) Object.values(schema[key]).forEach(boundNestedRewards);
    }
    for (const key of ['oneOf', 'anyOf', 'allOf', 'prefixItems']) {
      if (Array.isArray(schema[key])) schema[key].forEach(boundNestedRewards);
    }
    for (const key of ['items', 'if', 'then', 'else', 'not', 'contains', 'additionalProperties']) {
      boundNestedRewards(schema[key]);
    }
  };
  boundNestedRewards(outlined);

  let value = outlined;
  if (usesStatusOutline) {
    // These identical notes used to be duplicated under every status/reward.
    // Keep them once so stronger field constraints fit the same prompt budget.
    value.description = `状态契约：triggers 键只允许 ${STATUS_TRIGGERS.join('/')}；hold 只写 modify/card_rule；其他键直接写浅层效果。stacks_change 是状态回合末层数变化：有限数字、keep、reset 或 x倍率；每回合减少1层写 -1，禁止 decrement/decay/subtract:1。`;
  }
  if (usesEffectListOutline) {
    const note = 'effects 契约：直接写浅层操作或数组；apply_status/remove_status 值是状态 id 字符串，card_rule/modify 值是字符串且只放 passive/hold；when/to 与操作同级，禁止嵌套 effects/trigger 与 operation/target/value/source 信封。targets 只选择对方战斗实体且不含 owner；选择己方/敌方召唤必须改用 summon 操作内部的 selector。x_resource.ID 仅当当前卡 cost 的同一 ID 为 all 时可用，否则读取资源当前值必须写 self.resource.ID.current。';
    value.description = [value.description, note].filter(Boolean).join('\n');
  }
  if (['mwg_initial_draft', 'mwg_initial_draft_registry_repair', 'mwg_initial_draft_template_repair'].includes(inputName)) {
    // Some finite effect/summon outlines are handwritten below the projected
    // $defs. They must not reintroduce canonical inline creates into a registry
    // draft after the authoritative schema has deliberately removed it.
    const projectRegistryPlacement = (schema: any): void => {
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
      if (schema.properties) delete schema.properties.creates;
      for (const key of ['properties', 'patternProperties']) {
        if (schema[key] && typeof schema[key] === 'object') Object.values(schema[key]).forEach(projectRegistryPlacement);
      }
      for (const key of ['oneOf', 'anyOf', 'allOf', 'prefixItems']) {
        if (Array.isArray(schema[key])) schema[key].forEach(projectRegistryPlacement);
      }
      for (const key of ['items', 'if', 'then', 'else', 'not', 'contains', 'additionalProperties']) projectRegistryPlacement(schema[key]);
    };
    projectRegistryPlacement(value);
  }
  if (input.name === 'mwg_tower_single_floor_initial_content') {
    const outcome = (value as Record<string, any>).properties?.opening?.properties
      ?.choices?.items?.properties?.outcome;
    if (outcome && typeof outcome === 'object') {
      outcome.description = '只含 hp/max_hp/lust/max_lust/gold/card_removals/reward；max_lust 是欲望上限的相对变化；禁止 status/statuses。新状态定义只能放在 reward 内具体 card/artifact/item 候选对象的 statuses。';
    }
  }
  if (inputName === 'mwg_tower_initial_root_repair') value = factorSchemaObjectProperties(value);

  return {
    ...structuredClone(input),
    strict: false,
    value,
    // This label is transport metadata, not part of the gameplay contract.
    // Keep it concise; the full prompt and runtime parser remain authoritative.
    description: String(input.description || 'Structured game content'),
  };
}

/** Production adapter for Tavern Helper 4.9.x plus SillyTavern's event bus. */
export function createGlobalTowerGenerationPorts(
  helper: TavernHelperGenerationApi | null | undefined = (globalThis as any).TavernHelper,
  context: typeof getSillyTavernContext = getSillyTavernContext,
  transportHost: GenerationFetchHost = globalThis,
  schemaCache = createSchemaCapabilityCache(),
): TowerGenerationPorts {
  const transport = createGenerationTransportBoundary(transportHost);
  // Keep the immediate cache; optional session evidence survives page reloads.
  // Only hashed, expiring negative capability evidence is persisted.
  let schemaCompatibilityRoute: string | undefined;
  const structuredInvocations = new Set<string>();
  const cancelledInvocations = new Set<string>();
  const structuredActive = new Set<string>();
  const auxiliaryDeliveries = new Set<string>();
  const customRoute = (): string | undefined => {
    const settings = context()?.chatCompletionSettings;
    return settings?.chat_completion_source === 'custom'
      && typeof settings.custom_model === 'string' && settings.custom_model.trim()
      && typeof settings.custom_url === 'string' && settings.custom_url.trim()
      ? JSON.stringify([settings.custom_model, settings.custom_url]) : undefined;
  };
  const narrativeInvocations = new Set<string>();
  const narrativeWire = new Map<string, import('./narrativeWireObservation').NarrativeWireMetadata>();
  const structuredThinkingCleanups = new Map<string, () => void>();
  // Recovery is another regular preset call, not a provider capability or a
  // request-body override. The queue owns its single additional-call budget.
  const canRecoverEmptyNarrative = (): boolean => typeof helper?.generate === 'function';
  const requireHelper = <K extends keyof TavernHelperGenerationApi>(name: K): NonNullable<TavernHelperGenerationApi[K]> => {
    const value = name === 'generateRaw' ? resolveRawGenerator(helper) : helper?.[name];
    if (typeof value !== 'function') {
      const label = name === 'generateRaw' ? 'generateRaw/generate' : String(name);
      throw new TowerGenerationHostError('missing_api', `Tavern Helper 接口缺失: ${label}`);
    }
    return value as NonNullable<TavernHelperGenerationApi[K]>;
  };

  const generateStructured = async (config: TowerGenerateConfig): Promise<string | Record<string, any>> => {
    const generationId = String(config.generation_id);
    const { empty_json_fallback, deepseek_thinking_mode, structured_delivery, on_transport_observed_failure, on_transport_progress, ...helperConfig } = config;
    const marker = `${TOWER_STRUCTURED_REQUEST_MARKER}:${generationId}`;
    const schema = createProviderSafeJsonSchema(config.json_schema);
    if (structured_delivery === 'text-json') {
      if (config.custom_api || Object.hasOwn(config, 'tools') || Object.hasOwn(config, 'tool_choice')) {
        throw new TowerGenerationHostError('invalid_response', '普通文本机制请求不能隐式覆盖显式工具或自定义API');
      }
      const contract = createSchemaCompatibilityMessage(schema);
      if (!contract) throw new TowerGenerationHostError('invalid_response', '普通文本机制请求缺少可用的输出契约');
      const { json_schema: _nativeSchema, ...plain } = helperConfig;
      structuredActive.add(generationId);
      try {
        return await transport.run({ generationId, role: 'system', content: marker,
          ...(on_transport_observed_failure ? { onTransportFailure: on_transport_observed_failure } : {}),
          ...(on_transport_progress ? { onTransportProgress: on_transport_progress } : {}) },
          () => requireHelper('generateRaw')({
            ...plain, max_chat_history: 0,
            ordered_prompts: [
              { role: 'system', content: marker },
              contract,
              ...(config.ordered_prompts || [
                { role: 'system' as const, content: '按既定剧情与本次契约创作完整机制数据，优先用单个JSON对象表达。普通文本交付，不要求原生JSON模式；不要续写剧情、输出思考过程或UpdateVariable。' },
                'user_input' as const,
              ]),
            ],
          }));
      } finally { structuredActive.delete(generationId); }
    }
    const sourceSettings = context()?.chatCompletionSettings;
    const source = sourceSettings?.chat_completion_source;
    const route = !config.custom_api && !Object.hasOwn(config, 'tools') ? customRoute() : undefined;
    const startChatId = context()?.chatId;
    const auxiliaryDecoder = route && typeof startChatId === 'string' && startChatId.trim() && config.should_stream === false
      ? createStructuredAuxiliaryDecoder(config.json_schema) : undefined;
    auxiliaryDeliveries.delete(generationId);
    const compatibilityMessage = route ? createSchemaCompatibilityMessage(schema) : null;
    const fingerprint = compatibilityMessage ? await schemaCache.fingerprint(sourceSettings) : undefined;
    if (cancelledInvocations.has(generationId)) throw new TowerGenerationCancelledError();
    if ((route && route !== customRoute()) || startChatId !== context()?.chatId) {
      throw new GenerationTransportError({ kind: 'route_changed', retryable: false, evidence: 'request_guard' });
    }
    const currentSettings = context()?.chatCompletionSettings;
    const cacheEligible = [undefined, ''].includes(currentSettings?.custom_include_body)
      && [undefined, ''].includes(currentSettings?.custom_exclude_body);
    const useCompatibility = !!compatibilityMessage && cacheEligible && (route === schemaCompatibilityRoute || schemaCache.has(fingerprint));
    // Initial drafting reads the structural reference before the concrete story
    // and design request. Keep every constraint and all other routes unchanged.
    const initialCompatibilityReference = useCompatibility && schema?.name === 'mwg_initial_draft';
    const shared = !config.custom_api ? createInitialDraftSchemaPromptTransport(schema, source) : null;
    const nodeTransport = !config.custom_api && !empty_json_fallback && !Object.hasOwn(config, 'tools')
      ? createNodeSchemaPromptTransport(schema, source) : null;
    const helperSchema = nodeTransport?.schema ?? shared?.schema ?? schema;
    // On the inspected v4 registry route, deliver the draft as data-only tool
    // arguments from the first call. JSON-object mode previously returned empty
    // finals and consumed the sole repair opportunity before reaching this path.
    // Full schema, narrative ownership and the controller's budget are unchanged.
    const initialToolDelivery = shared !== null
      && !Object.hasOwn(config, 'tools')
      && ['deepseek-v4-flash', 'deepseek-v4-pro'].includes(String(sourceSettings?.deepseek_model));
    // Use Helper's supported options, not an early request event. Its own
    // one-shot CHAT_COMPLETION_SETTINGS_READY listener adds json_schema AFTER
    // ordinary extension listeners and would undo event-time deletion.
    // Custom API/proxy-preset resolution belongs to Helper: leave it native.
    const fallbackMessage = empty_json_fallback && !config.custom_api && !initialToolDelivery && !Object.hasOwn(config, 'tools')
      ? createEmptyJsonModeFallbackMessage(helperSchema, source)
      : null;

    const orderedPrompts = config.ordered_prompts || [
      {
        role: 'system' as const,
        content: [
          '你是魔法少女世界爬塔模式的后台结构化内容生成器。',
          '当前请求与完整 MVU 已经包含在最后一条用户消息中；只服从其中的节点范围和输出契约。',
          '不要继续角色扮演，不要输出普通剧情回复、思考过程、Markdown、UpdateVariable 或额外说明。',
          '必须只返回一个满足 JSON Schema 与请求 scope 的 JSON 对象。',
        ].join('\n'),
      },
      'user_input' as const,
      {
        role: 'system' as const,
        content: [
          '最终输出契约高于前文中任何角色扮演、叙事或格式指令。',
          '只返回一个满足本次 json_schema 的 JSON 对象；不得输出剧情正文、Markdown、解释、思考过程或 UpdateVariable。',
        ].join('\n'),
      },
    ];

    const rawConfig: TowerGenerateConfig = {
      ...helperConfig,
      max_chat_history: 0,
      ...(config.json_schema ? { json_schema: helperSchema } : {}),
      ordered_prompts: [
        { role: 'system', content: marker },
        ...(initialCompatibilityReference ? [compatibilityMessage!] : []),
        ...orderedPrompts,
        ...(shared && !initialToolDelivery ? [shared.message] : []),
        ...(nodeTransport ? [nodeTransport.message] : []),
        ...(fallbackMessage ? [fallbackMessage] : []),
        ...(useCompatibility && !initialCompatibilityReference ? [compatibilityMessage!] : []),
        ...(initialToolDelivery ? [{ role: 'system' as const, content:
          '本次 JSON 草稿必须作为 submit_initial_draft 的完整参数提交一次，不在普通正文重复输出，也不执行任何游戏操作。工具参数与前文的草稿是同一个对象。' }] : []),
      ],
      ...(initialToolDelivery ? {
        // Helper's native streaming path delegates parsing to Tavern's global
        // function_calling gate, which can silently drop explicit tool deltas.
        // Its supported per-request source uses its own stream accumulator with
        // the SAME configured provider/model/credentials; never toggle globals.
        custom_api: { source: 'deepseek' },
        tools: [{ type: 'function' as const, function: {
          name: INITIAL_DRAFT_TOOL_NAME,
          description: '提交本次完整开局机制草稿；只传递数据，不执行游戏操作。',
          parameters: structuredClone(shared!.completeSchema),
        } }],
        // Actual thinking-mode endpoint rejects a forced function choice.
        tool_choice: 'auto' as const,
      } : {}),
    };
    if (fallbackMessage || initialToolDelivery || useCompatibility) delete rawConfig.json_schema;
    const invokeHelper = async () => {
      structuredActive.add(generationId);
      let result: string | Record<string, any>;
      try {
        result = await transport.run({ generationId, role: 'system', content: marker,
          ...(on_transport_observed_failure ? { onTransportFailure: on_transport_observed_failure } : {}),
          ...(on_transport_progress ? { onTransportProgress: on_transport_progress } : {}),
          ...(useCompatibility ? { schemaCompatibilityRoute: { model: sourceSettings!.custom_model!, url: sourceSettings!.custom_url! } } : {}),
          ...(auxiliaryDecoder ? { auxiliaryJson: {
            route: { model: sourceSettings!.custom_model!, url: sourceSettings!.custom_url! },
            read: auxiliaryDecoder,
            isCurrent: () => structuredActive.has(generationId) && route === customRoute() && startChatId === context()?.chatId,
            onRecovered: () => {
              auxiliaryDeliveries.add(generationId);
              if (auxiliaryDeliveries.size > 64) auxiliaryDeliveries.delete(auxiliaryDeliveries.values().next().value!);
            },
          } } : {}),
        },
          () => requireHelper('generateRaw')(rawConfig));
      } catch (error) {
        if (structuredActive.has(generationId) && compatibilityMessage && !useCompatibility
          && route === customRoute() && error instanceof GenerationTransportError && error.failure.unsupportedResponseFormat) {
          schemaCompatibilityRoute = route;
          if (startChatId === context()?.chatId && !cancelledInvocations.has(generationId)
            && [undefined, ''].includes(context()?.chatCompletionSettings?.custom_include_body)
            && [undefined, ''].includes(context()?.chatCompletionSettings?.custom_exclude_body)) schemaCache.remember(fingerprint);
          // Only the existing queue may retry. A maxAttempts=1 repair remains
          // one call, and an error after compatibility is never reclassified.
          throw new GenerationTransportError({ ...error.failure, retryable: true });
        }
        throw error;
      } finally { structuredActive.delete(generationId); }
      // A genuinely empty first result still uses the controller's existing
      // shared extra request. Never retry here, and never treat an invalid tool
      // envelope (wrong name/count/arguments) as an empty authoring result.
      if (initialToolDelivery && !empty_json_fallback && typeof result === 'string' && !result.trim()) return result;
      return initialToolDelivery ? readInitialDraftToolResult(result) : result;
    };
    // Some native v4 node requests stop after reasoning with an empty final.
    // The queue already grants a bounded empty-final fallback; repeating the
    // same thinking route spent that budget without producing authored data.
    // Change only that existing fallback's request-local mode, not the first
    // attempt, preset narrative, explicit tools/custom API or global settings.
    const nodeEmptyThinkingFallback = empty_json_fallback === true && !Object.hasOwn(config, 'tools')
      && ['deepseek-v4-flash', 'deepseek-v4-pro'].includes(String(sourceSettings?.deepseek_model))
      && /^mwg_tower_(?:node_batch|opening|battle|elite|boss|event|shop|treasure|rest)_result$/.test(String(schema?.name));
    const initialThinkingOverride = deepseek_thinking_mode === 'disabled'
      && ['mwg_initial_draft', 'mwg_initial_draft_registry_repair', 'mwg_initial_draft_template_repair', 'mwg_tower_initial_slot_repair'].includes(String(schema?.name));
    const controlThinking = !config.custom_api && source === 'deepseek'
      && (initialThinkingOverride || nodeEmptyThinkingFallback);
    const customThinking = typeof startChatId === 'string' && startChatId.trim()
      ? createCustomStructuredThinkingPolicy(sourceSettings, config) : undefined;
    if (customThinking) {
      const host = context();
      const events = host?.eventSource;
      const event = host?.eventTypes?.CHAT_COMPLETION_SETTINGS_READY || 'chat_completion_settings_ready';
      if (typeof events?.on !== 'function' || typeof events?.removeListener !== 'function') {
        throw new TowerGenerationHostError('missing_api', '机制请求思考模式控制缺少酒馆请求事件接口');
      }
      const apply = (payload: unknown): void => {
        if (!structuredActive.has(generationId) || startChatId !== context()?.chatId
          || !customThinking.isCurrent(context()?.chatCompletionSettings)) return;
        customThinking.apply(payload);
      };
      const removeListener = events.removeListener.bind(events);
      const cleanup = (): void => {
        removeListener(event, apply);
        if (structuredThinkingCleanups.get(generationId) === cleanup) structuredThinkingCleanups.delete(generationId);
      };
      events.on(event, apply);
      structuredThinkingCleanups.set(generationId, cleanup);
      try { return await invokeHelper(); }
      finally { cleanup(); }
    }
    if (!controlThinking) return invokeHelper();
    const host = context();
    const events = host?.eventSource;
    const event = host?.eventTypes?.CHAT_COMPLETION_SETTINGS_READY || 'chat_completion_settings_ready';
    if (typeof events?.on !== 'function' || typeof events?.removeListener !== 'function') {
      throw new TowerGenerationHostError('missing_api', '机制请求思考模式控制缺少酒馆请求事件接口');
    }
    // Tavern owns the provider-specific mapping to thinking.type. This scoped
    // listener edits ONLY our marked request; never mutate oai_settings or an
    // unrelated preset/MVU/custom request. Helper injects schema/tools later,
    // but does not overwrite include_reasoning in this installed adapter.
    const overrideThinking = (payload: unknown): void => {
      if (!isRecord(payload) || payload.chat_completion_source !== 'deepseek' || !Array.isArray(payload.messages)) return;
      if (!['deepseek-v4-flash', 'deepseek-v4-pro'].includes(String(payload.model))) return;
      if (!payload.messages.some(message => isRecord(message) && message.role === 'system' && message.content === marker)) return;
      payload.include_reasoning = false;
    };
    events.on(event, overrideThinking);
    try { return await invokeHelper(); }
    finally { events.removeListener(event, overrideThinking); }
  };

  return {
    takeStructuredResponseDelivery: generationId => {
      const recovered = auxiliaryDeliveries.delete(generationId);
      return recovered ? 'auxiliary_json' : undefined;
    },
    currentChatId: () => {
      const chatId = context()?.chatId;
      return chatId === null || chatId === undefined ? null : String(chatId);
    },
    createChatMessages: (messages, options) => requireHelper('createChatMessages')(messages, options),
    generate: async config => {
      const id = String(config.generation_id);
      // Reserve before any per-id state is touched, including direct ports
      // callers. Cancellation disables delivery but retains this reservation
      // until the underlying invocation settles, so late cleanup cannot affect
      // a replacement with the same id. Normal queue attempts have unique ids.
      if (structuredInvocations.has(id)) {
        throw new TowerGenerationHostError('invalid_response', '相同结构化请求已经在运行');
      }
      structuredInvocations.add(id);
      try { return await generateStructured(config); }
      finally { structuredInvocations.delete(id); cancelledInvocations.delete(id); }
    },
    canRecoverEmptyNarrative,
    observeNarrativeDelivery: id => {
      let observation: ReturnType<typeof observeNarrativeDelivery>;
      try { observation = observeNarrativeDelivery(context()?.eventSource, id); }
      catch { observation = observeNarrativeDelivery(undefined, id); }
      return {
        snapshot: () => ({ ...observation.snapshot(), ...(narrativeWire.has(id) ? { wire: narrativeWire.get(id)! } : {}) }),
        close: () => { observation.close(); narrativeWire.delete(id); },
      };
    },
    observeStructuredDelivery: id => {
      try { return observeNarrativeDelivery(context()?.eventSource, id); }
      catch { return observeNarrativeDelivery(undefined, id); }
    },
    generateNarrative: async config => {
      const { empty_narrative_fallback, ...forward } = config;
      const helperConfig: TowerGenerateConfig = {
        ...forward,
        user_input: `[${TOWER_NARRATIVE_REQUEST_MARKER}]\n${config.user_input}`,
        preset_name: 'in_use', should_silence: true, max_chat_history: 'all',
      };
      const invokeHelper = () => transport.run({ generationId: config.generation_id, role: 'user', content: helperConfig.user_input,
        onNarrativeWire: metadata => { narrativeWire.set(config.generation_id, metadata); } },
        () => requireHelper('generate')(helperConfig));
      if (narrativeInvocations.has(config.generation_id)) {
        throw new TowerGenerationHostError('invalid_response', '相同剧情请求已经在运行');
      }
      narrativeInvocations.add(config.generation_id);
      try { return await invokeHelper(); }
      finally { narrativeInvocations.delete(config.generation_id); if (narrativeWire.size > 32) narrativeWire.clear(); }
    },
    stopGenerationById: id => {
      if (structuredInvocations.has(id)) cancelledInvocations.add(id);
      structuredActive.delete(id);
      auxiliaryDeliveries.delete(id);
      transport.cancel(id);
      // Remove the request policy immediately, even if a cancelled Helper
      // promise settles late. A late payload must not inherit the override.
      structuredThinkingCleanups.get(id)?.();
      return requireHelper('stopGenerationById')(id);
    },
    emitInternalEvent: async (eventName, payload) => {
      const eventSource = context()?.eventSource as any;
      if (typeof eventSource?.emit !== 'function') {
        throw new TowerGenerationHostError('missing_api', 'SillyTavern eventSource.emit 接口缺失');
      }
      return eventSource.emit(eventName, payload);
    },
  };
}
