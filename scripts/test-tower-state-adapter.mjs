import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const runCore = require('../src/game-core/runState.ts');
const contentCore = require('../src/game-core/towerContentState.ts');
const adapter = require('../src/runtime/towerStateAdapter.ts');

function towerStat(seed = 20260830) {
  return {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    run: runCore.createRunState({ seed }),
  };
}

function adjacencyReachable(run, roots) {
  const adjacency = adapter.buildTowerAdjacency(run);
  const reached = new Set();
  const queue = [...roots];
  while (queue.length) {
    const current = queue.shift();
    if (reached.has(current)) continue;
    reached.add(current);
    queue.push(...(adjacency[current] ?? []));
  }
  return reached;
}

// The initial prefetch is a bounded nearest-node window, never the whole act.
const initial = towerStat();
const initialRunReference = initial.run;
const lookahead = adapter.collectTowerLookahead(initial.run);
assert.ok(lookahead.length >= 1 && lookahead.length <= 3);
assert.equal(lookahead.length, 3);
assert.deepEqual([...new Set(lookahead.map(node => node.depth))], [1, 2]);
assert.equal(lookahead.filter(node => node.depth === 1).length, 1, 'the unique reward start is the only depth-one node');
assert.ok(lookahead.every(node => node.act === 1 && node.floor >= 1 && node.floor <= 3));
assert.ok(lookahead.every(node => node.difficultyMultiplier === 1));
assert.ok(initial.run.map.nodes.filter(node => node.act === 1).length > lookahead.length);
const queued = adapter.queueTowerLookaheadInStat(initial);
assert.equal(queued.previous, initialRunReference);
assert.notEqual(initial.run, initialRunReference, 'a mutation atomically replaces run instead of editing it');
assert.equal(queued.queued.length, lookahead.length);
assert.equal(queued.abandonedNodeIds.length, 0);
assert.equal(queued.expiredNodeIds.length, 0);
assert.equal(Object.values(initial.run.nodeContent).filter(envelope => envelope.phase === 'queued').length, 3);
for (const request of queued.queued) {
  assert.equal(typeof request.contentSeed, 'number');
  assert.equal(typeof request.rewardSeed, 'number');
  assert.notEqual(request.contentSeed, request.rewardSeed);
  assert.equal(request.revision, 0);
}

// Requeueing is deduplicated, and batch claims return complete worker metadata.
const afterFirstQueue = initial.run;
const duplicateQueue = adapter.queueTowerLookaheadInStat(initial);
assert.equal(duplicateQueue.changed, false);
assert.equal(duplicateQueue.queued.length, 0);
assert.equal(initial.run, afterFirstQueue);
const batch = adapter.claimQueuedTowerGenerationsInStat(initial, 2);
assert.equal(batch.requests.length, 2);
assert.ok(batch.requests.every(request => request.nodeId && request.requestId && request.kind));
assert.ok(batch.requests.every(request => request.act === 1 && request.floor <= 3));

// Old saves that queued most of an act are narrowed back to the same stable
// three-node window. A running request outside the window becomes stale before
// any late result can commit.
const oversized = towerStat(20260831);
let oversizedStore = oversized.run.nodeContent;
const oversizedNodes = oversized.run.map.nodes.filter(node => node.act === 1 && node.floor <= 3);
for (const node of oversizedNodes) {
  oversizedStore = contentCore.queueTowerNodeContent(oversizedStore, node.id, oversized.run.stateRevision).store;
}
const allowedIds = new Set(adapter.collectTowerLookahead(oversized.run).map(node => node.nodeId));
const staleNode = oversizedNodes.find(node => !allowedIds.has(node.id));
assert.ok(staleNode);
const staleRequest = {
  nodeId: staleNode.id,
  requestId: oversizedStore[staleNode.id].requestId,
  revision: oversizedStore[staleNode.id].basedOnRevision,
};
oversizedStore = contentCore.claimTowerGeneration(
  oversizedStore,
  staleNode.id,
  oversizedStore[staleNode.id].requestId,
).store;
oversized.run = { ...oversized.run, nodeContent: oversizedStore };
const narrowed = adapter.queueTowerLookaheadInStat(oversized);
assert.ok(narrowed.expiredNodeIds.includes(staleNode.id));
assert.equal(oversized.run.nodeContent[staleNode.id].phase, 'idle');
assert.throws(
  () => adapter.commitTowerGenerationInStat(oversized, { ...staleRequest, content: { stale: true } }),
  /not generating|stale/,
  'a late result from an oversized legacy queue is discarded',
);
assert.equal(Object.values(oversized.run.nodeContent)
  .filter(envelope => envelope.phase === 'queued' || envelope.phase === 'generating').length, 3);
assert.ok(adapter.claimQueuedTowerGenerationsInStat(oversized, 10).requests
  .every(request => allowedIds.has(request.nodeId)));

// Claiming the same in-flight request and committing its response are both idempotent.
const firstClaim = batch.requests[0];
const repeatedClaim = adapter.claimTowerGenerationInStat(initial, firstClaim.nodeId, firstClaim.requestId);
assert.equal(repeatedClaim.changed, false);
const response = {
  ...firstClaim,
  content: { opaque: { encounter: 'kept only in node content' } },
  reward: { opaque: ['reward'] },
};
const committed = adapter.commitTowerGenerationInStat(initial, response);
assert.equal(committed.changed, true);
assert.deepEqual(initial.run.nodeContent[firstClaim.nodeId].content, response.content);
assert.equal(initial.battle, undefined, 'adapter must not copy generated data into battle');
assert.equal(initial.reward, undefined, 'adapter must not copy generated data into reward');
assert.equal(adapter.commitTowerGenerationInStat(initial, response).changed, false);

// A reload recovers interrupted jobs, retries once, and rejects the old response.
const refreshStat = towerStat(73);
const refreshQueue = adapter.queueTowerLookaheadInStat(refreshStat);
const oldRequest = refreshQueue.queued[0];
adapter.claimTowerGenerationInStat(refreshStat, oldRequest.nodeId, oldRequest.requestId);
const restored = structuredClone(refreshStat);
const recovered = adapter.recoverTowerGenerationsInStat(restored);
assert.equal(recovered.changed, true);
assert.equal(restored.run.nodeContent[oldRequest.nodeId].phase, 'failed');
const retryQueue = adapter.queueTowerLookaheadInStat(restored);
const retry = retryQueue.queued.find(request => request.nodeId === oldRequest.nodeId);
assert.ok(retry);
assert.notEqual(retry.requestId, oldRequest.requestId);
assert.throws(
  () => adapter.commitTowerGenerationInStat(restored, { ...oldRequest, content: { stale: true } }),
  /not generating|stale/,
);
adapter.claimTowerGenerationInStat(restored, retry.nodeId, retry.requestId);
assert.equal(adapter.failTowerGenerationInStat(restored, { ...retry, error: 'network interrupted' }).changed, true);
assert.equal(
  adapter.failTowerGenerationInStat(restored, { ...retry, error: 'duplicate callback' }).changed,
  false,
  'duplicate failures must not mutate the run twice',
);
const untouchedQueued = Object.values(restored.run.nodeContent).find(
  envelope => envelope.nodeId !== retry.nodeId && envelope.phase === 'queued',
);
const untouchedReference = untouchedQueued ? restored.run.nodeContent[untouchedQueued.nodeId] : null;
const targetedRetry = adapter.retryTowerNodeGenerationInStat(restored, retry.nodeId);
assert.equal(targetedRetry.request.nodeId, retry.nodeId);
assert.notEqual(targetedRetry.request.requestId, retry.requestId);
assert.equal(restored.run.nodeContent[retry.nodeId].phase, 'queued');
if (untouchedQueued) {
  assert.equal(
    restored.run.nodeContent[untouchedQueued.nodeId],
    untouchedReference,
    'targeted retry must not wake or replace unrelated envelopes',
  );
}
assert.throws(() => adapter.retryTowerNodeGenerationInStat(restored, retry.nodeId), /no failed generation/);

// Choosing a branch abandons only nodes no longer reachable in this act.
const routeStat = towerStat(991);
routeStat.run = {
  ...routeStat.run,
  opening: { ...routeStat.run.opening, phase: 'skipped' },
};
routeStat.run = runCore.completeRunNode(
  runCore.enterRunNode(routeStat.run, routeStat.run.choices[0].id),
  { outcome: 'cleared' },
);
const routeQueue = adapter.queueTowerLookaheadInStat(routeStat);
const chosen = routeStat.run.choices[0];
const sibling = routeStat.run.choices.find(choice => choice.id !== chosen.id);
assert.ok(sibling);
const siblingRequest = routeQueue.queued.find(request => request.nodeId === sibling.id);
assert.ok(siblingRequest);
adapter.claimTowerGenerationInStat(routeStat, sibling.id, siblingRequest.requestId);

// Seed a future-act envelope to prove reconciliation does not touch it.
const future = routeStat.run.map.nodes.find(node => node.act === 2);
let futureStore = contentCore.queueTowerNodeContent(routeStat.run.nodeContent, future.id, 0).store;
futureStore = contentCore.claimTowerGeneration(futureStore, future.id).store;
routeStat.run = { ...routeStat.run, nodeContent: futureStore };
const futureBefore = routeStat.run.nodeContent[future.id];

const beforeRouteEntry = routeStat.run;
const entered = adapter.enterTowerRunNodeInStat(routeStat, chosen.id);
const reachableAfterChoice = adjacencyReachable(routeStat.run, [chosen.id]);
assert.equal(entered.previous, beforeRouteEntry);
assert.notEqual(routeStat.run, beforeRouteEntry);
assert.ok(entered.abandonedNodeIds.includes(sibling.id));
assert.equal(routeStat.run.nodeContent[sibling.id].phase, 'abandoned');
assert.equal(routeStat.run.nodeContent[future.id], futureBefore, 'future acts remain byte-for-byte untouched');
assert.equal(adapter.reconcileTowerRouteInStat(routeStat).changed, false, 'route reconciliation is idempotent');
for (const actOneNode of routeStat.run.map.nodes.filter(candidate => candidate.act === 1)) {
  if (reachableAfterChoice.has(actOneNode.id) || routeStat.run.visitedNodeIds.includes(actOneNode.id)) continue;
  assert.equal(routeStat.run.nodeContent[actOneNode.id].phase, 'abandoned');
}
assert.throws(
  () => adapter.commitTowerGenerationInStat(routeStat, { ...siblingRequest, content: { wrongRoute: true } }),
  /abandoned route|not generating/,
  'a late response from the discarded route must be rejected',
);
const routeLookahead = adapter.collectTowerLookahead(routeStat.run);
assert.ok(routeLookahead.length >= 1 && routeLookahead.length <= 3);
assert.ok(routeLookahead.every(node => node.floor > chosen.floor && node.floor <= chosen.floor + 3));
assert.ok(routeLookahead.every(node => reachableAfterChoice.has(node.nodeId)));

// Story and legacy-window modes cannot access the tower pre-generation adapter.
const story = towerStat(11);
story.game_mode = 'story';
story.game_mode_lock = { schemaVersion: 1, mode: 'story' };
assert.throws(() => adapter.queueTowerLookaheadInStat(story), /story mode/);
assert.throws(() => adapter.retryTowerNodeGenerationInStat(story, story.run.choices[0].id), /story mode/);
const legacy = towerStat(12);
legacy.run = runCore.createRunState({ seed: 12, floorsPerAct: 8 });
assert.equal(legacy.run.routeMode, 'legacy-window');
assert.throws(() => adapter.queueTowerLookaheadInStat(legacy), /legacy-window/);

console.log('Tower runtime lookahead, recovery, idempotency, reroute, and mode-boundary tests passed.');
