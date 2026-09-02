import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { createRunState } = require('../src/game-core/runState.ts');
const adapter = require('../src/runtime/towerOpeningAdapter.ts');

const stat = {
  game_mode_lock: { schemaVersion: 1, mode: 'tower' },
  run: createRunState({ seed: 619 }),
};
const queued = adapter.queueTowerOpeningInStat(stat);
assert.equal(queued.run.opening.phase, 'pending');
assert.equal(queued.request.nodeId, 'tower-opening');
const duplicateQueue = adapter.queueTowerOpeningInStat(stat);
assert.equal(duplicateQueue.changed, false);
assert.equal(duplicateQueue.request.requestId, queued.request.requestId);

const claimed = adapter.claimTowerOpeningInStat(stat, queued.request.requestId);
assert.equal(claimed.run.opening.phase, 'generating');
assert.equal(adapter.claimTowerOpeningInStat(stat, queued.request.requestId).changed, false);

const result = {
  spec: 'mwg.tower-opening-result/v1',
  request_id: queued.request.requestId,
  based_on_revision: queued.request.revision,
  title: '启程',
  narrative: '道路在选择之后展开。',
  choices: [
    { id: 'gift', label: '接受馈赠', outcome: {} },
    { id: 'trade', label: '承担代价', outcome: { hp: -5 } },
  ],
};
assert.equal(adapter.commitTowerOpeningInStat(stat, result).run.opening.phase, 'ready');
assert.equal(adapter.commitTowerOpeningInStat(stat, result).changed, false);

const interrupted = {
  game_mode_lock: { schemaVersion: 1, mode: 'tower' },
  run: createRunState({ seed: 620 }),
};
const interruptedRequest = adapter.queueTowerOpeningInStat(interrupted).request;
adapter.claimTowerOpeningInStat(interrupted, interruptedRequest.requestId);
assert.equal(adapter.recoverTowerOpeningInStat(interrupted).run.opening.phase, 'failed');
const retried = adapter.queueTowerOpeningInStat(interrupted);
assert.notEqual(retried.request.requestId, interruptedRequest.requestId);

const story = {
  game_mode_lock: { schemaVersion: 1, mode: 'story' },
  run: createRunState({ seed: 621 }),
};
assert.throws(() => adapter.queueTowerOpeningInStat(story), /story mode/);

console.log('tower opening MVU adapter is idempotent and recoverable');
