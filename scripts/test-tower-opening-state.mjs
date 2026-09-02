import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const opening = require('../src/game-core/towerOpeningState.ts');

let state = { phase: 'pending', requestId: null, basedOnRevision: 0, attempts: 0 };
const queued = opening.queueTowerOpening(state, 42, 0);
state = queued.opening;
assert.equal(queued.changed, true);
assert.equal(opening.queueTowerOpening(state, 42, 0).changed, false);
state = opening.claimTowerOpening(state).opening;
assert.equal(state.phase, 'generating');
const recovered = opening.recoverInterruptedTowerOpening(state);
assert.equal(recovered.phase, 'failed');
const retry = opening.queueTowerOpening(recovered, 42, 1);
assert.notEqual(retry.opening.requestId, state.requestId);
state = opening.claimTowerOpening(retry.opening).opening;
state = opening.commitTowerOpening(state, {
  requestId: state.requestId,
  basedOnRevision: 1,
  content: { title: '开局事件' },
}).opening;
assert.equal(state.phase, 'ready');
assert.equal(state.narrativePhase, 'pending');
assert.equal(state.narrativeRequestId, `${state.requestId}__narrative`);
assert.equal(opening.commitTowerOpening(state, {
  requestId: state.requestId,
  basedOnRevision: 1,
  content: { title: '重复结果' },
}).changed, false);
state = opening.consumeTowerOpening(state).opening;
assert.equal(state.phase, 'consumed');

console.log('tower opening lifecycle is retryable and idempotent');
