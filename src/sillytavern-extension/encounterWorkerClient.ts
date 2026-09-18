import type { TowerBuildMeasurement } from '../game-core/towerEncounterBudget';
import type { RuntimeBalanceInput, RuntimeBalanceResult } from '../runtime/towerRuntimeBalance';
import { towerEncounterPlayerReference } from '../runtime/towerEncounterPlayer';

/** No main-document fallback: loading the battle singleton there would share player state. */
export class EncounterWorkerClient {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private measurements = new Map<string, Promise<TowerBuildMeasurement>>();
  private request<T>(operation: 'measure' | 'balance', input: unknown): Promise<T> {
    if (!this.worker) {
      if (typeof Worker === 'undefined') return Promise.reject(new Error('独立战斗评估 Worker 不可用'));
      this.worker = new Worker(new URL('/scripts/extensions/third-party/magic-girl-design-assistant/encounter-worker.js', location.origin),
        { type: 'module', name: 'mwg-encounter-evaluator' });
      this.worker.onmessage = event => {
        const reply = this.pending.get(event.data?.id);
        if (!reply) return;
        clearTimeout(reply.timer); this.pending.delete(event.data.id);
        if (event.data.ok) reply.resolve(event.data.value); else reply.reject(new Error(event.data.error));
      };
      this.worker.onerror = () => this.close(new Error('战斗评估 Worker 运行失败'));
    }
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('战斗评估达到时间预算，结果未确定')), 120000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, operation, input: structuredClone(input) });
    });
  }
  clearMeasurementCache(): void { this.measurements.clear(); }
  measure(battle: Record<string, any>): Promise<TowerBuildMeasurement> {
    const player = towerEncounterPlayerReference(battle);
    const key = JSON.stringify(player);
    const cached = this.measurements.get(key);
    if (cached) return cached;
    const measurement = this.request<TowerBuildMeasurement>('measure', { battle: player, seeds: 2 });
    if (this.measurements.size >= 8) this.measurements.delete(this.measurements.keys().next().value!);
    this.measurements.set(key, measurement);
    measurement.catch(() => { if (this.measurements.get(key) === measurement) this.measurements.delete(key); });
    return measurement;
  }
  balance(input: RuntimeBalanceInput): Promise<RuntimeBalanceResult> { return this.request('balance', input); }
  close(error = new Error('战斗评估已停止')): void {
    this.worker?.terminate(); this.worker = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.measurements.clear();
  }
}
