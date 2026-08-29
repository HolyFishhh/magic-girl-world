import { DesignAssistantEngine } from './designEngine';

const engine = new DesignAssistantEngine();

type WorkerRequest = {
  id: number;
  operation: 'snapshot' | 'calibrate';
  variables: unknown;
  state: unknown;
  settings: unknown;
};

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(value: unknown): void;
};

workerScope.onmessage = event => {
  const request = event.data;
  try {
    if (request.operation === 'snapshot') {
      const snapshot = engine.createSnapshot(request.variables, request.state, request.settings);
      workerScope.postMessage({ id: request.id, ok: true, snapshot });
      return;
    }
    const variables = structuredClone(request.variables);
    const result = engine.calibrateGeneratedEnemy(variables, request.state, request.settings);
    workerScope.postMessage({ id: request.id, ok: true, result, variables });
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

