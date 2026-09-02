import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const run = require(resolve('src/game-core/runState.ts'));

const first = run.createRunState({ seed: 42, actCount: 2, floorsPerAct: 5, startingGold: 99 });
assert.equal(first.phase, 'awaiting_choice');
assert.deepEqual(first.choices.map(choice => choice.kind), ['battle']);
assert.deepEqual(run.createRunState({ seed: 42, actCount: 2, floorsPerAct: 5 }), first);

let state = run.enterRunNode(first, first.choices[0].id);
assert.equal(state.phase, 'in_node');
state = run.completeRunNode(state, { outcome: 'cleared', goldDelta: 12 });
assert.equal(state.floor, 1);
assert.equal(state.gold, 111);
assert.equal(state.nodeCounts.battle, 1);
assert.equal(state.choices.length, 2);
assert.equal(new Set(state.choices.map(choice => choice.kind)).size, state.choices.length);

const replay = run.completeRunNode(run.enterRunNode(first, first.choices[0].id), {
  outcome: 'cleared',
  goldDelta: 12,
});
assert.deepEqual(replay, state, 'same seed and decisions must reproduce the same route choices');

const escapedChoice = state.choices[0];
const escaped = run.completeRunNode(run.enterRunNode(state, escapedChoice.id), { outcome: 'escaped' });
assert.equal(escaped.floor, 1);
assert.equal(escaped.phase, 'awaiting_choice');
assert.ok(escaped.choices.length >= 2);

assert.throws(() => run.enterRunNode(state, 'missing'), /unknown run choice/);
assert.throws(() => run.spendRunGold(state, 1000), /not enough/);
assert.equal(run.spendRunGold(state, 20).gold, 91);

while (state.choices[0].kind !== 'boss') {
  state = run.completeRunNode(run.enterRunNode(state, state.choices[0].id), { outcome: 'cleared' });
}
state = run.completeRunNode(run.enterRunNode(state, state.choices[0].id), { outcome: 'cleared' });
assert.equal(state.act, 2);
assert.equal(state.floor, 0);
assert.deepEqual(state.choices.map(choice => choice.kind), ['battle']);

while (state.choices[0].kind !== 'boss') {
  state = run.completeRunNode(run.enterRunNode(state, state.choices[0].id), { outcome: 'cleared' });
}
state = run.completeRunNode(run.enterRunNode(state, state.choices[0].id), { outcome: 'cleared' });
assert.equal(state.phase, 'won');
assert.equal(state.nodeCounts.boss, 2);
assert.equal(state.choices.length, 0);
assert.equal(run.validateRunState(state).ok, true);

const legacyV1 = { ...structuredClone(first), schemaVersion: 1 };
const migratedV1 = run.validateRunState(legacyV1);
assert.equal(migratedV1.ok, true, 'valid schema v1 saves are migrated during restore');
assert.equal(migratedV1.value.schemaVersion, 3);
assert.equal(migratedV1.value.routeMode, 'legacy-window');
assert.equal(legacyV1.schemaVersion, 1, 'migration does not mutate the saved snapshot');

const corrupted = structuredClone(state);
corrupted.seed = -1;
assert.deepEqual(run.validateRunState(corrupted), { ok: false, message: 'run seed is invalid' });

const inconsistent = structuredClone(first);
inconsistent.choices[0].floor = 4;
assert.deepEqual(run.validateRunState(inconsistent), { ok: false, message: 'run choice is stale' });

const missingChoice = structuredClone(first);
missingChoice.choices = [];
assert.deepEqual(run.validateRunState(missingChoice), { ok: false, message: 'run choice phase is inconsistent' });

const failed = run.completeRunNode(run.enterRunNode(first, first.choices[0].id), { outcome: 'failed' });
assert.equal(failed.phase, 'lost');

const mapped = run.createRunState({ seed: 20260830 });
assert.equal(mapped.schemaVersion, 3);
assert.equal(mapped.routeMode, 'map');
assert.equal(mapped.actCount, 3);
assert.equal(mapped.floorsPerAct, 16);
assert.equal(mapped.opening.phase, 'pending');
assert.equal(mapped.choices.length, 6);
assert.deepEqual(
  mapped.choices.map(choice => choice.id).sort(),
  [...mapped.map.startNodeIds[1]].sort(),
);
assert.equal(run.validateRunState(mapped).ok, true);

let mappedProgress = mapped;
for (let act = 1; act <= 3; act += 1) {
  for (let floor = 1; floor <= 16; floor += 1) {
    const choice = mappedProgress.choices[0];
    assert.equal(choice.act, act);
    assert.equal(choice.floor, floor);
    const beforeRevision = mappedProgress.stateRevision;
    mappedProgress = run.enterRunNode(mappedProgress, choice.id);
    assert.equal(mappedProgress.stateRevision, beforeRevision + 1);
    mappedProgress = run.completeRunNode(mappedProgress, { outcome: 'cleared' });
    assert.equal(mappedProgress.stateRevision, beforeRevision + 2);
    assert.equal(mappedProgress.visitedNodeIds.includes(choice.id), true);
    assert.equal(run.validateRunState(mappedProgress).ok, true);
  }
}
assert.equal(mappedProgress.phase, 'won');
assert.equal(mappedProgress.nodeCounts.treasure, 3);
assert.equal(mappedProgress.nodeCounts.boss, 3);

const tamperedMapChoice = structuredClone(mapped);
tamperedMapChoice.choices[0].id = mapped.map.acts[0].bossNodeId;
assert.match(run.validateRunState(tamperedMapChoice).message, /map choice/);

const escapedMapStart = run.completeRunNode(run.enterRunNode(mapped, mapped.choices[0].id), { outcome: 'escaped' });
assert.deepEqual(
  escapedMapStart.choices.map(choice => choice.id).sort(),
  mapped.choices.map(choice => choice.id).sort(),
  'escaping before clearing a node restores the same reachable route choices',
);

console.log('Portable seeded run progression, route windows, outcomes, and strict restore validation passed.');
