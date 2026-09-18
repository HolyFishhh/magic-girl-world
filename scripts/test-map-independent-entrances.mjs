import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const mapCore = require(resolve('src/game-core/runMap.ts'));
const runCore = require(resolve('src/game-core/runState.ts'));

const clone = value => JSON.parse(JSON.stringify(value));

function mapChoice(node) {
  const danger = { event: 0, rest: 0, treasure: 0, battle: 1, elite: 2, boss: 3 }[node.kind];
  return { id: node.id, kind: node.kind, act: node.act, floor: node.floor, danger, column: node.column };
}

/** Turn each generated act into a retained pre-three-entrance save shape. */
function makeLegacySingleEntranceState(state) {
  const legacy = clone(state);
  for (const act of legacy.map.acts) {
    const firstFloor = act.nodes.filter(node => node.floor === 1);
    assert.equal(firstFloor.length, 3, `fixture act ${act.act} must begin with three entrances`);
    const centre = firstFloor.find(node => node.column === 2);
    assert.ok(centre, `fixture act ${act.act} must have a central entrance`);

    // Existing pre-migration saves used one opening-treasure node. Keep the
    // central node identity so historical paths and persisted node content
    // retain a stable key while the two side entrances disappear.
    centre.kind = 'treasure';
    const firstFloorIds = new Set(firstFloor.map(node => node.id));
    const removed = new Set(firstFloor.filter(node => node.id !== centre.id).map(node => node.id));
    act.nodes = act.nodes.filter(node => !removed.has(node.id));
    act.startNodeIds = [centre.id];
    act.edges = act.edges.filter(edge => !firstFloorIds.has(edge.from) && !removed.has(edge.to));

    const secondFloor = act.nodes.filter(node => node.floor === 2).sort((left, right) => left.column - right.column);
    assert.equal(secondFloor.length, 3, `fixture act ${act.act} must retain three second-floor columns`);
    act.edges.push(...secondFloor.map(node => ({ from: centre.id, to: node.id })));
    act.paths = act.paths.map(path => [centre.id, ...path.slice(1)]);
    act.bossNodeId = act.nodes.find(node => node.kind === 'boss').id;
  }
  legacy.map.nodes = legacy.map.acts.flatMap(act => act.nodes);
  legacy.map.edges = legacy.map.acts.flatMap(act => act.edges);
  legacy.map.startNodeIds = Object.fromEntries(legacy.map.acts.map(act => [act.act, [...act.startNodeIds]]));
  legacy.map.bossNodeIds = Object.fromEntries(legacy.map.acts.map(act => [act.act, act.bossNodeId]));

  for (const id of Object.keys(legacy.nodeContent)) {
    if (!legacy.map.nodes.some(node => node.id === id)) delete legacy.nodeContent[id];
  }
  for (const act of legacy.map.acts) {
    const centre = act.nodes.find(node => node.id === act.startNodeIds[0]);
    legacy.nodeContent[centre.id] = { ...legacy.nodeContent[centre.id], kind: 'treasure' };
  }
  const firstActStart = legacy.map.acts[0].nodes.find(node => node.id === legacy.map.acts[0].startNodeIds[0]);
  legacy.choices = [mapChoice(firstActStart)];
  return legacy;
}

for (const seed of [1, 20260914, 4294967295]) {
  const state = runCore.createRunState({ seed });
  assert.equal(state.routeMode, 'map');
  assert.equal(state.choices.length, 3, `seed ${seed} exposes all three first-act entrances`);
  assert.equal(new Set(state.choices.map(choice => choice.id)).size, 3, `seed ${seed} has independent initial choices`);
  assert.deepEqual(
    state.choices.map(choice => choice.id).sort(),
    [...state.map.startNodeIds[1]].sort(),
    `seed ${seed} maps every entrance to an immediately selectable choice`,
  );
  for (const act of state.map.acts) {
    assert.equal(act.startNodeIds.length, 3, `seed ${seed} act ${act.act} retains three entrances`);
    const starts = new Set(act.startNodeIds);
    assert.equal(act.nodes.filter(node => node.floor === 1).length, 3, `seed ${seed} act ${act.act} has three bottom nodes`);
    assert.ok(act.edges.every(edge => !starts.has(edge.to)), `seed ${seed} act ${act.act} entrances have no predecessor`);
  }

  const selected = state.choices[1];
  const unselected = state.choices.filter(choice => choice.id !== selected.id).map(choice => choice.id);
  const entered = runCore.enterRunNode(state, selected.id);
  assert.equal(entered.currentNode.id, selected.id);
  assert.equal(entered.choices.length, 0, 'entering one entrance closes the other entrance choices');
  const continued = runCore.completeRunNode(entered, { outcome: 'cleared' });
  assert.ok(continued.choices.length > 0, 'the selected entrance continues into its own route');
  assert.ok(continued.choices.every(choice => !unselected.includes(choice.id)), 'unselected entrances cannot be chosen after a route starts');
  assert.equal(runCore.validateRunState(continued).ok, true, `seed ${seed} preserves a valid selected route`);

  const saved = clone(state);
  const restored = runCore.validateRunState(saved);
  assert.equal(restored.ok, true, `seed ${seed} serialized map restores`);
  assert.deepEqual(restored.value.map, saved.map, `seed ${seed} restore retains the exact generated map`);
}

const legacy = makeLegacySingleEntranceState(runCore.createRunState({ seed: 20260915 }));
const legacyMapValidation = mapCore.validateRunMap(legacy.map);
assert.equal(legacyMapValidation.ok, true, legacyMapValidation.errors.join('; '));
assert.equal(legacy.map.acts[0].startNodeIds.length, 1);
assert.equal(legacy.choices.length, 1);
assert.equal(legacy.choices[0].kind, 'treasure', 'the old opening treasure stays compatible');
assert.equal(runCore.getOpeningTreasureNode(legacy)?.id, legacy.choices[0].id, 'legacy opening treasure remains discoverable');

const legacySaved = clone(legacy);
const legacyRestored = runCore.validateRunState(legacySaved);
assert.equal(legacyRestored.ok, true, legacyRestored.message);
assert.deepEqual(legacyRestored.value.map, legacySaved.map, 'restoring an old map never regenerates its topology');
assert.deepEqual(legacyRestored.value.choices, legacySaved.choices, 'restoring an old map retains its single opening choice');

console.log('Independent map entrances, route lock-in, serialized restore, and legacy single-entrance compatibility passed.');
