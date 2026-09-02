import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const content = require('../src/game-core/towerContentState.ts');

let store = content.createTowerContentStore([
  { id: 'start', kind: 'battle' },
  { id: 'left', kind: 'event' },
  { id: 'right', kind: 'elite' },
]);
assert.equal(content.validateTowerContentStore(store), true);

const queued = content.queueTowerNodeContent(store, 'start', 4);
assert.equal(queued.envelope.phase, 'queued');
store = queued.store;
assert.equal(content.queueTowerNodeContent(store, 'start', 4).changed, false, 'same revision must be idempotent');

const claimed = content.claimTowerGeneration(store, 'start', queued.envelope.requestId);
store = claimed.store;
const committed = content.commitTowerGeneration(store, {
  nodeId: 'start',
  requestId: claimed.envelope.requestId,
  basedOnRevision: 4,
  content: { enemy: 'test' },
  reward: { cards: 3 },
});
store = committed.store;
assert.equal(content.isTowerNodeContentReady(store.start, { rewardRequired: true }), true);
assert.equal(content.commitTowerGeneration(store, {
  nodeId: 'start',
  requestId: claimed.envelope.requestId,
  basedOnRevision: 4,
  content: { enemy: 'ignored duplicate' },
}).changed, false, 'duplicate responses must not reapply content');
assert.throws(() => content.commitTowerGeneration(store, {
  nodeId: 'left',
  requestId: 'stale',
  basedOnRevision: 4,
  content: {},
}), /not generating/);

store = content.queueTowerNodeContent(store, 'left', 5).store;
store = content.claimTowerGeneration(store, 'left').store;
const recovered = content.recoverInterruptedTowerContent(store);
assert.equal(recovered.left.phase, 'failed');
const retried = content.queueTowerNodeContent(recovered, 'left', 6);
assert.notEqual(retried.envelope.requestId, store.left.requestId);

const abandoned = content.abandonTowerContent(retried.store, ['left', 'right']);
assert.equal(abandoned.left.phase, 'abandoned');
assert.equal(abandoned.right.phase, 'abandoned');
assert.equal(content.queueTowerNodeContent(abandoned, 'left', 7).changed, false);

assert.deepEqual(
  content.collectReachableTowerNodeIds({ start: ['left', 'right'], left: ['deep'], right: ['deep'], deep: ['boss'] }, ['start'], 2),
  ['start', 'left', 'right', 'deep'],
);
assert.deepEqual(
  content.collectReachableTowerNodeIds({ start: ['left'], left: ['deep'], deep: ['boss'] }, ['start'], 1),
  ['start', 'left'],
);

console.log('tower content state tests passed');
