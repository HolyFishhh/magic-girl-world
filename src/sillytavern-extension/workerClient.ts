import { DesignAssistantEngine } from './designEngine';
import type {
  DesignAssistantChatState,
  DesignAssistantSettings,
  MvuDesignSnapshot,
} from './types';

interface CalibrationReply {
  changed: boolean;
  state: DesignAssistantChatState;
  snapshot: MvuDesignSnapshot | null;
  variables: unknown;
}

interface PendingRequest {
  resolve(value: any): void;
  reject(reason: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function designWorkerUrl(): URL {
  return new URL('/scripts/extensions/third-party/magic-girl-design-assistant/design-worker.js', location.origin);
}

/** Runs expensive seeded simulations away from SillyTavern's rendering thread. */
export class DesignWorkerClient {
  private readonly worker: Worker | null;
  private readonly pending = new Map<number, PendingRequest>();
  private sequence = 0;
  private workerFailed = false;

  constructor(private readonly fallback: DesignAssistantEngine) {
    try {
      this.worker = typeof Worker === 'undefined'
        ? null
        : new Worker(designWorkerUrl(), { type: 'module', name: 'mwg-design-simulator' });
      if (this.worker) {
        this.worker.onmessage = event => this.receive(event.data);
        this.worker.onerror = event => this.disableWorker(new Error(event.message || '设计模拟 Worker 运行失败'));
      }
    } catch {
      this.worker = null;
    }
  }

  get threaded(): boolean {
    return Boolean(this.worker) && !this.workerFailed;
  }

  private disableWorker(error: Error): void {
    if (this.workerFailed) return;
    this.workerFailed = true;
    this.rejectAll(error);
    this.worker?.terminate();
  }

  private receive(message: any): void {
    const request = this.pending.get(Number(message?.id));
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(Number(message.id));
    if (message.ok) request.resolve(message);
    else request.reject(new Error(String(message.error || '设计模拟 Worker 返回失败')));
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private request(operation: 'snapshot' | 'calibrate', variables: unknown, state: unknown, settings: unknown): Promise<any> {
    if (!this.threaded) return Promise.reject(new Error('worker-unavailable'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('设计模拟 Worker 超时'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, operation, variables, state, settings });
    });
  }

  async createSnapshot(
    variables: unknown,
    state: unknown,
    settings: DesignAssistantSettings,
  ): Promise<MvuDesignSnapshot | null> {
    if (this.threaded) {
      try {
        const reply = await this.request('snapshot', variables, state, settings);
        return reply.snapshot || null;
      } catch (error) {
        this.disableWorker(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return this.fallback.createSnapshot(variables, state, settings);
  }

  async calibrate(
    variables: unknown,
    state: unknown,
    settings: DesignAssistantSettings,
  ): Promise<CalibrationReply> {
    if (this.threaded) {
      try {
        const reply = await this.request('calibrate', variables, state, settings);
        return { ...reply.result, variables: reply.variables };
      } catch (error) {
        this.disableWorker(error instanceof Error ? error : new Error(String(error)));
      }
    }
    const copiedVariables = clone(variables);
    const result = this.fallback.calibrateGeneratedEnemy(copiedVariables, state, settings);
    return { ...result, variables: copiedVariables };
  }

  dispose(): void {
    this.disableWorker(new Error('设计模拟 Worker 已停止'));
  }
}
