import { getSillyTavernContext } from './sillyTavernHost';
import {
  TowerGenerationCancelledError,
  TowerGenerationQueue,
  TowerGenerationTimeoutError,
  towerGenerationTaskKey,
  type TowerGenerationQueueOptions,
  type TowerGenerationTaskKey,
} from './towerGenerationQueue';

export const TOWER_GENERATION_COMPLETED_EVENT = 'mwg_tower_generation_completed';

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
  json_schema?: Record<string, any>;
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
  stopGenerationById(generationId: string): boolean;
  emitInternalEvent(eventName: string, payload: TowerGenerationCompletedPayload): Promise<unknown>;
}

export interface TowerGenerationRequest extends TowerGenerationTaskKey {
  prompt: string;
  /** Program-authored node location used by reward/schema validation. */
  act?: number;
  floor?: number;
  /** Program-authored act multiplier used by tower-only post-generation balance. */
  difficultyMultiplier?: number;
  timeoutMs?: number;
  maxAttempts?: number;
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
}

export interface TowerGenerationResult {
  response: string;
  generationId: string;
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
}

interface RequestProgress {
  response: string | null;
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
  return `mwg-tower-${stableHash(`${request.chatId}\u0000${request.nodeId}\u0000${request.requestId}`)}-${attempt}`;
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

  public constructor(
    private readonly ports: TowerGenerationPorts,
    options: TowerGenerationHostOptions = {},
  ) {
    this.queue = options.queue || new TowerGenerationQueue(options.queueOptions);
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

    return this.queue.enqueue<TowerGenerationResult>({
      chatId: request.chatId,
      nodeId: request.nodeId,
      requestId: request.requestId,
      timeoutMs: request.timeoutMs,
      maxAttempts: request.maxAttempts,
      shouldRetry: error => !(
        error instanceof TowerGenerationTimeoutError
        || (error instanceof TowerGenerationHostError && error.code === 'chat_changed')
      ),
      execute: context => this.executeRequest(record!, context.signal, context.attempt),
    });
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
    return this.queue.enqueue<TowerGenerationResult>({
      chatId: request.chatId,
      nodeId: request.nodeId,
      requestId: request.requestId,
      priority: 100,
      timeoutMs: request.timeoutMs,
      maxAttempts: request.maxAttempts,
      shouldRetry: error => !(
        error instanceof TowerGenerationTimeoutError
        || (error instanceof TowerGenerationHostError && error.code === 'chat_changed')
      ),
      execute: context => this.executeNarrativeRequest(record!, context.signal, context.attempt),
    });
  }

  public activateChat(chatId: string): void {
    this.queue.activateChat(chatId);
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
      let generationStarted = false;
      const stop = (): void => {
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
        const generated = await this.ports.generate({
          ...(request.generation || {}),
          generation_id: currentGenerationId,
          // No chat message is created during active play. Feed the complete
          // request directly to Tavern Helper's silent generation API.
          user_input: request.prompt,
          should_stream: false,
          should_silence: true,
        });
        this.assertCurrentChat(request.chatId, signal);
        if (typeof generated !== 'string' || !generated.trim()) {
          throw new TowerGenerationHostError('invalid_response', '后台模型没有返回可写入的文本');
        }
        progress.response = generated;
      } finally {
        signal.removeEventListener('abort', stop);
      }
    }

    this.assertCurrentChat(request.chatId, signal);
    return {
      response: progress.response,
      generationId: progress.generationId || generationId(request, attempt),
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
      const currentGenerationId = `${generationId(request, attempt)}-story`;
      progress.generationId = currentGenerationId;
      let generationStarted = false;
      const stop = (): void => {
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
        });
        this.assertCurrentChat(request.chatId, signal);
        if (typeof generated !== 'string' || !generated.trim()) {
          throw new TowerGenerationHostError('invalid_response', '剧情模型没有返回可显示正文');
        }
        progress.response = generated;
      } finally {
        signal.removeEventListener('abort', stop);
      }
    }
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

/** Production adapter for Tavern Helper 4.9.x plus SillyTavern's event bus. */
export function createGlobalTowerGenerationPorts(
  helper: TavernHelperGenerationApi | null | undefined = (globalThis as any).TavernHelper,
  context: typeof getSillyTavernContext = getSillyTavernContext,
): TowerGenerationPorts {
  const requireHelper = <K extends keyof TavernHelperGenerationApi>(name: K): NonNullable<TavernHelperGenerationApi[K]> => {
    const value = helper?.[name];
    if (typeof value !== 'function') {
      throw new TowerGenerationHostError('missing_api', `Tavern Helper 接口缺失: ${String(name)}`);
    }
    return value as NonNullable<TavernHelperGenerationApi[K]>;
  };

  return {
    currentChatId: () => {
      const chatId = context()?.chatId;
      return chatId === null || chatId === undefined ? null : String(chatId);
    },
    createChatMessages: (messages, options) => requireHelper('createChatMessages')(messages, options),
    generate: config => requireHelper('generateRaw')({
      ...config,
      max_chat_history: 0,
      ordered_prompts: config.ordered_prompts || [
        {
          role: 'system',
          content: [
            '你是魔法少女世界爬塔模式的后台结构化内容生成器。',
            '当前请求与完整 MVU 已经包含在最后一条用户消息中；只服从其中的节点范围和输出契约。',
            '不要继续角色扮演，不要输出普通剧情回复、思考过程、Markdown、UpdateVariable 或额外说明。',
            '必须只返回一个满足 JSON Schema 与请求 scope 的 JSON 对象。',
          ].join('\n'),
        },
        'user_input',
        {
          role: 'system',
          content: [
            '最终输出契约高于前文中任何角色扮演、叙事或格式指令。',
            '只返回一个满足本次 json_schema 的 JSON 对象；不得输出剧情正文、Markdown、解释、思考过程或 UpdateVariable。',
          ].join('\n'),
        },
      ],
    }),
    generateNarrative: config => requireHelper('generate')({
      ...config,
      preset_name: 'in_use',
      should_silence: true,
      max_chat_history: 'all',
    }),
    stopGenerationById: id => requireHelper('stopGenerationById')(id),
    emitInternalEvent: async (eventName, payload) => {
      const eventSource = context()?.eventSource as any;
      if (typeof eventSource?.emit !== 'function') {
        throw new TowerGenerationHostError('missing_api', 'SillyTavern eventSource.emit 接口缺失');
      }
      return eventSource.emit(eventName, payload);
    },
  };
}
