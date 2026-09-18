import { measureTowerBuild, balanceTowerWithRuntime } from '../runtime/towerRuntimeBalance';
// One worker realm owns one production runtime. Serial processing prevents snapshot cross-talk.
const realm = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(value: unknown): void };
let queue = Promise.resolve();
realm.onmessage = event => {
  const { id, operation, input } = event.data || {};
  queue = queue.then(async () => {
    try {
      const value = operation === 'measure' ? await measureTowerBuild(input.battle, input.seeds)
        : operation === 'balance' ? await balanceTowerWithRuntime(input) : (() => { throw new Error('Unknown encounter worker operation'); })();
      realm.postMessage({ id, ok: true, value });
    } catch (error) {
      realm.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
