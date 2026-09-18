import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/runState.ts');
const adapter = require('../src/runtime/towerStateAdapter.ts');
const { runMapContentKind } = require('../src/game-core/runMap.ts');
const contentState = require('../src/game-core/towerContentState.ts');

const isCombat = kind => ['battle', 'elite', 'boss'].includes(kind);
const ids = window => window.map(node => node.nodeId);

function scenario(layers, readyIds = []) {
  const template = core.createRunState({ seed: 941 });
  const nodeById = new Map();
  const edges = [];
  layers.forEach((layer, index) => {
    layer.forEach((entry, column) => {
      const node = {
        id: entry.id,
        act: 1,
        floor: index + 1,
        column,
        kind: entry.kind,
        contentSeed: 10_000 + index * 100 + column,
        rewardSeed: 20_000 + index * 100 + column,
        ...(entry.mystery ? { mystery: entry.mystery } : {}),
      };
      nodeById.set(node.id, node);
      for (const childId of entry.children || []) edges.push({ from: node.id, to: childId });
    });
  });
  const nodes = [...nodeById.values()];
  const act = {
    ...template.map.acts[0],
    act: 1,
    nodes,
    edges,
    paths: [nodes.map(node => node.id)],
    startNodeIds: layers[0].map(entry => entry.id),
    bossNodeId: nodes.at(-1).id,
  };
  const nodeContent = { ...template.nodeContent };
  for (const nodeId of readyIds) nodeContent[nodeId] = { phase: 'ready', nodeId, content: { retained: true } };
  return {
    ...template,
    act: 1,
    routeMode: 'map',
    phase: 'awaiting_choice',
    currentNode: null,
    choices: layers[0].map((entry, index) => ({ ...template.choices[0], id: entry.id, kind: entry.kind, floor: 1, index })),
    map: { ...template.map, nodes, edges, acts: [act] },
    nodeContent,
  };
}

// A combat in one first-layer branch stops all deeper branches, even when another
// first-layer branch is non-combat and has a reachable child.
let run = scenario([
  [{ id: 'left', kind: 'event', children: ['left-child'] }, { id: 'right', kind: 'battle', children: ['right-child'] }],
  [{ id: 'left-child', kind: 'shop' }, { id: 'right-child', kind: 'event' }],
]);
assert.deepEqual(ids(adapter.collectTowerPreparationWindow(run)), ['left', 'right']);

// The same global stop applies to a mixed second layer rather than following the
// non-combat branch alone into a third layer.
run = scenario([
  [{ id: 'a', kind: 'rest', children: ['c'] }, { id: 'b', kind: 'shop', children: ['d'] }],
  [{ id: 'c', kind: 'event', children: ['e'] }, { id: 'd', kind: 'elite', children: ['f'] }],
  [{ id: 'e', kind: 'treasure' }, { id: 'f', kind: 'event' }],
]);
assert.deepEqual(ids(adapter.collectTowerPreparationWindow(run)), ['a', 'b', 'c', 'd']);

// There is no inherited 3-node/3-depth cap: every entirely non-combat layer is
// prepared until the complete next frontier contains its first combat node.
run = scenario([
  [{ id: 'n1', kind: 'rest', children: ['n2'] }],
  [{ id: 'n2', kind: 'shop', children: ['n3'] }],
  [{ id: 'n3', kind: 'event', children: ['n4'] }],
  [{ id: 'n4', kind: 'treasure', children: ['n5'] }],
  [{ id: 'n5', kind: 'boss' }],
]);
assert.deepEqual(ids(adapter.collectTowerPreparationWindow(run)), ['n1', 'n2', 'n3', 'n4', 'n5']);
assert.deepEqual(adapter.collectTowerPreparationWindow(run).map(node => node.depth), [1, 2, 3, 4, 5]);

// A one-node combat frontier is not padded with later nodes to fill the three
// generation slots. Existing ready content does not permit expansion beyond it.
run = scenario([
  [{ id: 'prepared-battle', kind: 'battle', children: ['must-not-queue'] }],
  [{ id: 'must-not-queue', kind: 'event' }],
], ['prepared-battle']);
assert.deepEqual(ids(adapter.collectTowerPreparationWindow(run)), ['prepared-battle']);

// Map markers can remain event while their actual generated content is a hidden
// battle; runMapContentKind must be the global-stop predicate.
run = scenario([
  [{ id: 'hidden-battle', kind: 'event', mystery: { kind: 'battle' }, children: ['hidden-child'] }],
  [{ id: 'hidden-child', kind: 'shop' }],
]);
const hiddenWindow = adapter.collectTowerPreparationWindow(run);
assert.deepEqual(ids(hiddenWindow), ['hidden-battle']);
assert.equal(hiddenWindow[0].kind, 'battle');

// Window reconciliation must preserve authored ready content outside the new
// global horizon, while an obsolete queued request is reset and cannot be claimed.
const retentionState = core.createRunState({ seed: 1 });
const retentionExpectedIds = new Set(expectedGlobalWindow(retentionState).map(({ node }) => node.id));
const retentionOutsideIds = retentionState.map.nodes
  .filter(node => node.act === retentionState.act && !retentionExpectedIds.has(node.id))
  .map(node => node.id);
assert.ok(retentionOutsideIds.length >= 2, 'fixture needs ready and queued nodes outside the preparation window');
const [retainedReadyId, expiredQueuedId] = retentionOutsideIds;
let retainedStore = contentState.queueTowerNodeContent(retentionState.nodeContent, retainedReadyId, retentionState.stateRevision).store;
const readyClaim = contentState.claimTowerGeneration(retainedStore, retainedReadyId).envelope;
retainedStore = contentState.claimTowerGeneration(retainedStore, retainedReadyId).store;
retainedStore = contentState.commitTowerGeneration(retainedStore, {
  nodeId: retainedReadyId,
  requestId: readyClaim.requestId,
  basedOnRevision: readyClaim.basedOnRevision,
  content: { retainedOutsideWindow: true },
}).store;
retainedStore = contentState.queueTowerNodeContent(retainedStore, expiredQueuedId, retentionState.stateRevision).store;
const retentionStat = {
  game_mode: 'tower',
  game_mode_lock: { schemaVersion: 1, mode: 'tower' },
  run: { ...retentionState, nodeContent: retainedStore },
};
assert.equal(core.validateRunState(retentionStat.run).ok, true, 'outside-window fixture remains a valid saved run');
const reconciledRetention = adapter.queueTowerLookaheadInStat(retentionStat, 3, { retryFailed: false });
assert.ok(reconciledRetention.expiredNodeIds.includes(expiredQueuedId));
assert.equal(retentionStat.run.nodeContent[retainedReadyId].phase, 'ready');
assert.deepEqual(retentionStat.run.nodeContent[retainedReadyId].content, { retainedOutsideWindow: true });
assert.equal(retentionStat.run.nodeContent[expiredQueuedId].phase, 'idle');
const postExpiryClaims = adapter.claimQueuedTowerGenerationsInStat(retentionStat, 3);
assert.ok(postExpiryClaims.requests.every(request => request.nodeId !== expiredQueuedId), 'expired queued content must never be claimed');

function expectedGlobalWindow(runState) {
  const adjacency = adapter.buildTowerAdjacency(runState);
  const nodes = new Map(runState.map.nodes.map(node => [node.id, node]));
  const expected = [];
  const visited = new Set();
  let frontier = [...new Set(runState.choices.map(choice => choice.id))];
  let depth = 1;
  while (frontier.length) {
    const layer = [];
    for (const nodeId of frontier) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const node = nodes.get(nodeId);
      if (node?.act === runState.act) layer.push(node);
    }
    if (!layer.length) break;
    expected.push(...layer.map(node => ({ node, depth })));
    if (layer.some(node => isCombat(runMapContentKind(node)))) break;
    frontier = [...new Set(layer.flatMap(node => adjacency[node.id] || []))];
    depth += 1;
  }
  return expected;
}

// Exercise the automatic default queue against valid saved runs: it retains the
// three-request concurrency limit, survives serialization, and never queues a
// node beyond the global combat frontier.
let checkedWindows = 0;
let hiddenBattleWindows = 0;
for (let seed = 1; seed <= 30; seed += 1) {
  let state = core.createRunState({ seed });
  for (const choiceId of state.map.acts[0].paths[0]) {
    const stat = { game_mode: 'tower', game_mode_lock: { schemaVersion: 1, mode: 'tower' }, run: state };
    const before = JSON.stringify({ choices: state.choices, revision: state.stateRevision, visited: state.visitedNodeIds });
    const expected = expectedGlobalWindow(state);
    const expectedIds = new Set(expected.map(({ node }) => node.id));
    const actual = adapter.collectTowerPreparationWindow(state);
    assert.deepEqual(new Set(ids(actual)), expectedIds);
    assert.deepEqual(actual.map(node => node.depth), expected.map(({ depth }) => depth));
    if (actual.some(node => node.kind === 'battle' && state.map.nodes.find(entry => entry.id === node.nodeId).kind === 'event')) hiddenBattleWindows += 1;

    let rounds = 0;
    while (true) {
      const queued = adapter.queueTowerLookaheadInStat(stat, 3, { retryFailed: false });
      assert.ok(queued.queued.length <= 3, 'automatic prefetch retains three-request concurrency');
      assert.deepEqual(new Set(queued.lookahead.map(node => node.nodeId)), expectedIds);
      const pending = Object.values(stat.run.nodeContent).filter(node => ['queued', 'generating'].includes(node.phase));
      assert.ok(pending.length <= 3);
      assert.equal(adapter.queueTowerLookaheadInStat(stat, 3, { retryFailed: false }).queued.length, 0);
      const claimed = adapter.claimQueuedTowerGenerationsInStat(stat, 3);
      if (!claimed.requests.length) break;
      for (const request of claimed.requests) {
        assert.ok(expectedIds.has(request.nodeId));
        adapter.commitTowerGenerationInStat(stat, { ...request, content: { fixture: request.kind } });
      }
      stat.run = JSON.parse(JSON.stringify(stat.run));
      assert.equal(core.validateRunState(stat.run).ok, true, 'prepared content remains save/restore valid');
      assert.ok(++rounds < 30, 'prefetch terminates without advancing the route');
    }
    for (const nodeId of expectedIds) assert.equal(stat.run.nodeContent[nodeId].phase, 'ready');
    for (const node of stat.run.map.nodes) {
      if (!expectedIds.has(node.id) && state.nodeContent[node.id].phase !== 'ready') assert.notEqual(stat.run.nodeContent[node.id].phase, 'ready');
    }
    assert.equal(JSON.stringify({ choices: stat.run.choices, revision: stat.run.stateRevision, visited: stat.run.visitedNodeIds }), before);
    checkedWindows += 1;
    state = core.completeRunNode(core.enterRunNode(state, choiceId), { outcome: 'cleared' });
  }
}
assert.ok(checkedWindows > 0);
console.log('PASS noncombat prefetch: complete-frontier global combat stop, hidden event battles, bounded automatic queue, retained ready content, and save/restore', { checkedWindows, hiddenBattleWindows });
