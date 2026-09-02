export type TowerGenerationQueuePhase =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TowerGenerationTaskKey {
  chatId: string;
  nodeId: string;
  requestId: string;
}

export interface TowerGenerationAttemptContext {
  signal: AbortSignal;
  attempt: number;
}

export interface TowerGenerationTask<T> extends TowerGenerationTaskKey {
  execute(context: TowerGenerationAttemptContext): Promise<T>;
  /** Higher values run first among queued jobs; the active request is never preempted. */
  priority?: number;
  /** Total attempts, including the first one. */
  maxAttempts?: number;
  /** Optional watchdog. `null` disables time-based cancellation. */
  timeoutMs?: number | null;
  shouldRetry?(error: unknown, attempt: number): boolean;
}

export interface TowerGenerationQueueStatus extends TowerGenerationTaskKey {
  key: string;
  phase: TowerGenerationQueuePhase;
  attempt: number;
  maxAttempts: number;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: unknown;
}

export interface TowerGenerationQueueOptions {
  /** Optional default watchdog. Omitted/null means no hard timeout. */
  timeoutMs?: number | null;
  maxAttempts?: number;
  onStatus?(status: TowerGenerationQueueStatus): void;
}

export class TowerGenerationCancelledError extends Error {
  public readonly code = 'cancelled' as const;

  public constructor(message = '爬塔后台生成已取消') {
    super(message);
    this.name = 'TowerGenerationCancelledError';
  }
}

export class TowerGenerationTimeoutError extends Error {
  public readonly code = 'timeout' as const;

  public constructor(public readonly timeoutMs: number) {
    super(`爬塔后台生成超过 ${timeoutMs}ms`);
    this.name = 'TowerGenerationTimeoutError';
  }
}

interface QueueJob<T> {
  task: TowerGenerationTask<T>;
  key: string;
  queuedAt: number;
  attempt: number;
  maxAttempts: number;
  timeoutMs: number | null;
  priority: number;
  controller: AbortController;
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  phase: TowerGenerationQueuePhase;
  startedAt?: number;
  finishedAt?: number;
}

const DEFAULT_MAX_ATTEMPTS = 2;

function requiredId(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} 不能为空`);
  return normalized;
}

export function towerGenerationTaskKey(key: TowerGenerationTaskKey): string {
  // Length prefixes avoid collisions even if caller-provided IDs contain a separator.
  return [key.chatId, key.nodeId, key.requestId]
    .map(value => `${value.length}:${value}`)
    .join('|');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.max(1, Math.floor(Number(value)))
    : fallback;
}

function optionalTimeout(value: number | null | undefined, fallback: number | null): number | null {
  if (value === null) return null;
  if (value === undefined) return fallback;
  return Number.isFinite(value) && Number(value) > 0
    ? Math.max(1, Math.floor(Number(value)))
    : fallback;
}

function cancelledFromSignal(signal: AbortSignal): TowerGenerationCancelledError {
  return signal.reason instanceof TowerGenerationCancelledError
    ? signal.reason
    : new TowerGenerationCancelledError(
      typeof signal.reason === 'string' && signal.reason.trim()
        ? signal.reason
        : undefined,
    );
}

/**
 * A single-lane, chat-scoped queue for pre-generating tower content.
 *
 * The complete job promise is retained as the idempotency record until its
 * chat is retired or `forgetSettled` is called. Re-submitting the same
 * chat/node/request tuple therefore never performs a second model request.
 */
export class TowerGenerationQueue {
  private readonly jobs = new Map<string, QueueJob<unknown>>();
  private readonly pending: QueueJob<unknown>[] = [];
  private activeChatId: string | null = null;
  private pumping = false;

  public constructor(private readonly options: TowerGenerationQueueOptions = {}) {}

  public enqueue<T>(input: TowerGenerationTask<T>): Promise<T> {
    const task: TowerGenerationTask<T> = {
      ...input,
      chatId: requiredId(input.chatId, 'chatId'),
      nodeId: requiredId(input.nodeId, 'nodeId'),
      requestId: requiredId(input.requestId, 'requestId'),
    };
    this.activateChat(task.chatId);

    const key = towerGenerationTaskKey(task);
    const duplicate = this.jobs.get(key) as QueueJob<T> | undefined;
    if (duplicate) return duplicate.promise;

    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const job: QueueJob<T> = {
      task,
      key,
      queuedAt: Date.now(),
      attempt: 0,
      maxAttempts: positiveInteger(task.maxAttempts, positiveInteger(this.options.maxAttempts, DEFAULT_MAX_ATTEMPTS)),
      timeoutMs: optionalTimeout(task.timeoutMs, optionalTimeout(this.options.timeoutMs, null)),
      priority: Number.isFinite(task.priority) ? Number(task.priority) : 0,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
      phase: 'queued',
    };
    this.jobs.set(key, job as QueueJob<unknown>);
    this.pending.push(job as QueueJob<unknown>);
    this.pending.sort((left, right) => right.priority - left.priority || left.queuedAt - right.queuedAt);
    this.emit(job);
    void this.pump();
    return promise;
  }

  /** Cancels queued/running jobs from every previous chat and releases their dedupe records. */
  public activateChat(chatId: string): void {
    const normalized = requiredId(chatId, 'chatId');
    if (this.activeChatId === normalized) return;
    this.activeChatId = normalized;
    for (const job of [...this.jobs.values()]) {
      if (job.task.chatId === normalized) continue;
      this.cancelJob(job, '聊天已切换，旧聊天的后台生成已取消');
      // The running object remains owned by the pump until it observes abort;
      // removing only the lookup record is safe and prevents old-chat dedupe
      // state from accumulating across a long Tavern session.
      this.jobs.delete(job.key);
    }
  }

  public cancelChat(chatId: string, reason = '该聊天的后台生成已取消'): void {
    for (const job of this.jobs.values()) {
      if (job.task.chatId === chatId) this.cancelJob(job, reason);
    }
  }

  public cancelRequest(key: TowerGenerationTaskKey, reason = '该节点的后台生成已取消'): boolean {
    const job = this.jobs.get(towerGenerationTaskKey(key));
    if (!job) return false;
    return this.cancelJob(job, reason);
  }

  public forgetSettled(chatId?: string): void {
    for (const job of this.jobs.values()) {
      if (chatId !== undefined && job.task.chatId !== chatId) continue;
      if (job.phase === 'completed' || job.phase === 'failed' || job.phase === 'cancelled') {
        this.jobs.delete(job.key);
      }
    }
  }

  /** Release one terminal dedupe entry after its result is durable elsewhere. */
  public forgetSettledRequest(key: TowerGenerationTaskKey): boolean {
    const fingerprint = towerGenerationTaskKey(key);
    const job = this.jobs.get(fingerprint);
    if (!job || !['completed', 'failed', 'cancelled'].includes(job.phase)) return false;
    return this.jobs.delete(fingerprint);
  }

  public getStatus(key: TowerGenerationTaskKey): TowerGenerationQueueStatus | null {
    const job = this.jobs.get(towerGenerationTaskKey(key));
    return job ? this.snapshot(job) : null;
  }

  private cancelJob(job: QueueJob<unknown>, reason: string): boolean {
    if (job.phase === 'completed' || job.phase === 'failed' || job.phase === 'cancelled') return false;
    const error = new TowerGenerationCancelledError(reason);
    job.controller.abort(error);
    if (job.phase === 'queued') {
      job.phase = 'cancelled';
      job.finishedAt = Date.now();
      job.reject(error);
      this.emit(job, error);
    }
    return true;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift()!;
        if (job.phase !== 'queued') continue;
        await this.runJob(job);
      }
    } finally {
      this.pumping = false;
      // A task can enqueue synchronously while the final loop is unwinding.
      if (this.pending.some(job => job.phase === 'queued')) void this.pump();
    }
  }

  private async runJob(job: QueueJob<unknown>): Promise<void> {
    job.startedAt = Date.now();
    while (job.attempt < job.maxAttempts) {
      if (job.controller.signal.aborted) {
        this.finishCancelled(job, cancelledFromSignal(job.controller.signal));
        return;
      }

      job.attempt += 1;
      job.phase = job.attempt === 1 ? 'running' : 'retrying';
      this.emit(job);
      try {
        const value = await this.runAttempt(job);
        if (job.controller.signal.aborted) {
          this.finishCancelled(job, cancelledFromSignal(job.controller.signal));
          return;
        }
        job.phase = 'completed';
        job.finishedAt = Date.now();
        job.resolve(value);
        this.emit(job);
        return;
      } catch (error) {
        if (job.controller.signal.aborted || error instanceof TowerGenerationCancelledError) {
          const cancellation = error instanceof TowerGenerationCancelledError
            ? error
            : cancelledFromSignal(job.controller.signal);
          this.finishCancelled(job, cancellation);
          return;
        }
        const retry = job.attempt < job.maxAttempts
          && (job.task.shouldRetry?.(error, job.attempt) ?? true);
        if (retry) continue;
        job.phase = 'failed';
        job.finishedAt = Date.now();
        job.reject(error);
        this.emit(job, error);
        return;
      }
    }
  }

  private runAttempt(job: QueueJob<unknown>): Promise<unknown> {
    const attemptController = new AbortController();
    const cancelAttempt = (): void => attemptController.abort(cancelledFromSignal(job.controller.signal));
    job.controller.signal.addEventListener('abort', cancelAttempt, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCancellation: ((error: TowerGenerationCancelledError) => void) | null = null;
    const rejectWhenCancelled = (): void => {
      rejectCancellation?.(cancelledFromSignal(job.controller.signal));
    };
    const cancelled = new Promise<never>((_resolve, reject) => {
      if (job.controller.signal.aborted) {
        reject(cancelledFromSignal(job.controller.signal));
        return;
      }
      rejectCancellation = reject;
      job.controller.signal.addEventListener('abort', rejectWhenCancelled, { once: true });
    });
    const execution = Promise.resolve().then(() => job.task.execute({
      signal: attemptController.signal,
      attempt: job.attempt,
    }));
    const racers: Promise<unknown>[] = [execution, cancelled];
    if (job.timeoutMs !== null) {
      racers.push(new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new TowerGenerationTimeoutError(job.timeoutMs!);
          attemptController.abort(error);
          reject(error);
        }, job.timeoutMs!);
      }));
    }
    return Promise.race(racers).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
      job.controller.signal.removeEventListener('abort', cancelAttempt);
      job.controller.signal.removeEventListener('abort', rejectWhenCancelled);
    });
  }

  private finishCancelled(job: QueueJob<unknown>, error: TowerGenerationCancelledError): void {
    if (job.phase === 'cancelled') return;
    job.phase = 'cancelled';
    job.finishedAt = Date.now();
    job.reject(error);
    this.emit(job, error);
  }

  private snapshot(job: QueueJob<unknown>, error?: unknown): TowerGenerationQueueStatus {
    return {
      chatId: job.task.chatId,
      nodeId: job.task.nodeId,
      requestId: job.task.requestId,
      key: job.key,
      phase: job.phase,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      queuedAt: job.queuedAt,
      ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
      ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
      ...(error === undefined ? {} : { error }),
    };
  }

  private emit(job: QueueJob<unknown>, error?: unknown): void {
    try {
      this.options.onStatus?.(this.snapshot(job, error));
    } catch (statusError) {
      console.warn('[MWG TowerGenerationQueue] 状态回调失败', statusError);
    }
  }
}
