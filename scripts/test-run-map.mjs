import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const runMap = require(resolve('src/game-core/runMap.ts'));

const first = runMap.generateRunMap({ seed: 'tower-regression-seed' });
const replay = runMap.generateRunMap({ seed: 'tower-regression-seed' });
const alternate = runMap.generateRunMap({ seed: 'tower-regression-seed-2' });

assert.deepEqual(replay, first, 'the same seed must reproduce the complete three-act map');
assert.notDeepEqual(
  alternate.acts.map(act => ({ nodes: act.nodes.map(node => [node.id, node.kind]), edges: act.edges })),
  first.acts.map(act => ({ nodes: act.nodes.map(node => [node.id, node.kind]), edges: act.edges })),
  'a different seed should change topology or room assignment',
);
assert.equal(first.acts.length, 3);
assert.deepEqual(
  first.acts.map(act => act.difficultyMultiplier),
  [1, 1.07, 1.14],
);
assert.equal(
  new Set(Object.values(first.seeds)).size,
  4,
  'topology, room, content, and reward streams are independent',
);
assert.equal(first.validation.ok, true, first.validation.errors.join('\n'));

const flattenedRisk = structuredClone(first);
for (const act of flattenedRisk.acts) {
  for (const node of act.nodes) {
    if (node.kind === 'elite') node.kind = 'battle';
  }
}
const flattenedRiskValidation = runMap.validateRunMap(flattenedRisk);
assert.ok(
  flattenedRiskValidation.errors.some(error => error.includes('high-risk route')),
  'validation should reject a map without an elite-heavy route',
);
assert.ok(
  flattenedRiskValidation.errors.some(error => error.includes('elite route spread')),
  'validation should reject a map without route risk separation',
);

const longEdgeMap = structuredClone(first);
const longEdgeAct = longEdgeMap.acts[0];
const longEdgeNodes = new Map(longEdgeAct.nodes.map(node => [node.id, node]));
const longEdge = longEdgeAct.edges.find(edge => {
  const from = longEdgeNodes.get(edge.from);
  const to = longEdgeNodes.get(edge.to);
  return to.kind !== 'boss' && from.column <= 1;
});
longEdgeNodes.get(longEdge.to).column = 6;
assert.ok(
  runMap.validateRunMap(longEdgeMap).errors.some(error => error.includes('moves more than one column')),
  'validation should reject a non-boss edge that jumps across columns',
);

for (const act of first.acts) {
  assert.equal(act.paths.length, 5, `act ${act.act} should expose five branch tracks`);
  assert.equal(act.startNodeIds.length, 1, `act ${act.act} should have one reward start`);
  assert.equal(act.nodes.find(node => node.id === act.bossNodeId)?.kind, 'boss');
  assert.equal(new Set(Object.values(act.seeds)).size, 4, `act ${act.act} should retain independent random streams`);
  for (const node of act.nodes) {
    assert.notEqual(node.contentSeed, node.rewardSeed, `${node.id} content and reward seeds should be independent`);
  }

  const validationStats = first.validation.acts.find(stats => stats.act === act.act);
  const expectedRatios = { battle: 0.53, event: 0.22, rest: 0.12, elite: 0.08, shop: 0.05 };
  for (const [kind, expected] of Object.entries(expectedRatios)) {
    assert.ok(
      Math.abs(validationStats.randomRoomRatios[kind] - expected) <= 0.1,
      `act ${act.act} ${kind} quota should remain close to ${expected}`,
    );
  }

  const nodes = new Map(act.nodes.map(node => [node.id, node]));
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of act.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }

  for (const node of act.nodes) {
    if (node.floor === 1) assert.equal(node.kind, 'treasure');
    if (node.floor === 2) assert.equal(node.kind, 'battle');
    if (node.floor === 9) assert.equal(node.kind, 'treasure');
    if (node.floor === 15) assert.equal(node.kind, 'rest');
    if (node.floor === 16) assert.equal(node.kind, 'boss');
    if (node.floor <= 5) assert.ok(node.kind !== 'elite' && node.kind !== 'rest');
    if (node.floor === 14) assert.notEqual(node.kind, 'rest');
    if (node.id !== act.bossNodeId) assert.ok((outgoing.get(node.id)?.length ?? 0) > 0, `${node.id} is a dead end`);
  }

  for (const [parentId, children] of outgoing) {
    const parent = nodes.get(parentId);
    const forcedChildren = children.every(childId => [1, 2, 9, 15, 16].includes(nodes.get(childId).floor));
    if (!forcedChildren) {
      assert.equal(
        new Set(children.map(childId => nodes.get(childId).kind)).size,
        children.length,
        `${parentId} has duplicate sibling room kinds`,
      );
    }
    assert.ok(children.length <= (parent.floor === 1 ? 3 : 2), `${parentId} has too many branches`);
  }

  const startId = act.startNodeIds[0];
  assert.equal(outgoing.get(startId)?.length, 3, `act ${act.act} reward start should open three main routes`);

  const special = new Set(['elite', 'rest', 'shop', 'treasure']);
  for (const edge of act.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    assert.equal(to.floor, from.floor + 1);
    if (to.kind !== 'boss' && from.id !== startId) {
      assert.ok(Math.abs(to.column - from.column) <= 1, `${edge.from}>${edge.to} moves more than one column`);
    }
    assert.ok(!(from.kind === to.kind && special.has(from.kind)), `${from.kind} repeats along ${edge.from}>${edge.to}`);
  }

  for (let floor = 1; floor <= 15; floor += 1) {
    assert.ok(act.nodes.filter(node => node.floor === floor).length <= 5, `act ${act.act} floor ${floor} exceeds five branches`);
    const floorEdges = act.edges.filter(edge => nodes.get(edge.from).floor === floor);
    for (let left = 0; left < floorEdges.length; left += 1) {
      for (let right = left + 1; right < floorEdges.length; right += 1) {
        const leftFrom = nodes.get(floorEdges[left].from).column;
        const leftTo = nodes.get(floorEdges[left].to).column;
        const rightFrom = nodes.get(floorEdges[right].from).column;
        const rightTo = nodes.get(floorEdges[right].to).column;
        assert.ok(
          !((leftFrom < rightFrom && leftTo > rightTo) || (leftFrom > rightFrom && leftTo < rightTo)),
          `act ${act.act} has crossing edges after floor ${floor}`,
        );
      }
    }
  }

  const reachable = new Set(act.startNodeIds);
  const queue = [...act.startNodeIds];
  while (queue.length) {
    for (const next of outgoing.get(queue.shift()) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  assert.equal(reachable.size, act.nodes.length, `every act ${act.act} node should be reachable from a start`);

  const reachesBoss = new Set([act.bossNodeId]);
  const reverseQueue = [act.bossNodeId];
  while (reverseQueue.length) {
    for (const previous of incoming.get(reverseQueue.shift()) ?? []) {
      if (reachesBoss.has(previous)) continue;
      reachesBoss.add(previous);
      reverseQueue.push(previous);
    }
  }
  assert.equal(reachesBoss.size, act.nodes.length, `every act ${act.act} node should lead to its boss`);

  for (const path of act.paths) {
    assert.equal(path.length, 16);
    assert.equal(path.at(-1), act.bossNodeId);
  }
  const routeEliteCounts = act.paths.map(path => path.filter(id => nodes.get(id).kind === 'elite').length);
  assert.ok(Math.min(...routeEliteCounts) <= 1, `act ${act.act} should contain an elite-light safe route`);
  assert.ok(Math.max(...routeEliteCounts) >= 2, `act ${act.act} should contain an elite-heavy high-risk route`);
  assert.ok(
    Math.max(...routeEliteCounts) - Math.min(...routeEliteCounts) >= 1,
    `act ${act.act} should expose a meaningful elite-risk spread`,
  );
}

for (let seed = 0; seed < 1000; seed += 1) {
  const generated = runMap.generateRunMap(seed);
  assert.equal(generated.validation.ok, true, `seed ${seed}: ${generated.validation.errors.join('; ')}`);
  for (const stats of generated.validation.acts) {
    assert.ok(stats.minimumRouteElites <= 1, `seed ${seed} act ${stats.act} has no safe route`);
    assert.ok(stats.maximumRouteElites >= 2, `seed ${seed} act ${stats.act} has no high-risk route`);
    assert.ok(
      stats.maximumRouteElites - stats.minimumRouteElites >= 1,
      `seed ${seed} act ${stats.act} has no elite-risk spread`,
    );
  }
}

console.log('Seeded three-act map topology, room constraints, connectivity, and validation passed.');
