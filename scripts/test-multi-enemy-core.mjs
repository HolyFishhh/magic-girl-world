import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const enemy = (id, hp, speed = 0, priority = 0) => ({
  id, name: id, currentHp: hp, maxHp: 20, speed, actionPriority: priority,
  actions: [{ name: `${id}-attack`, weight: 1 }], actionMode: 'random', nextAction: null,
});

let collection = core.createCombatantCollection([enemy('a', 10), enemy('b', 4), enemy('c', 18)], 'a');
assert.deepEqual(core.listCombatants(collection, { livingOnly: true }).map(value => value.id), ['a', 'b', 'c']);
assert.equal(core.getActiveCombatant(collection).id, 'a');
assert.equal(core.resolveEnemyTargets(collection, { mode: 'lowest_hp' }, core.createBattleRandomState(1)).targets[0].id, 'b');
assert.equal(core.resolveEnemyTargets(collection, { mode: 'highest_hp' }, core.createBattleRandomState(1)).targets[0].id, 'c');
assert.deepEqual(core.resolveEnemyTargets(collection, { mode: 'all' }, core.createBattleRandomState(1)).targets.map(value => value.id), ['a', 'b', 'c']);

const randomLockedA = core.resolveEnemyTargets(collection, { mode: 'random_n', count: 2 }, core.createBattleRandomState(77));
const randomLockedB = core.resolveEnemyTargets(collection, { mode: 'random_n', count: 2 }, core.createBattleRandomState(77));
assert.deepEqual(randomLockedA.targets.map(value => value.id), randomLockedB.targets.map(value => value.id));
assert.equal(new Set(randomLockedA.targets.map(value => value.id)).size, 2, 'random_n does not repeat by default');
const repeated = core.resolveEnemyTargets(collection, { mode: 'random_n', count: 8, allowRepeat: true }, core.createBattleRandomState(9));
assert.equal(repeated.targets.length, 8, 'random multi-hit may explicitly repeat targets');

collection = core.updateCombatant(collection, 'a', { currentHp: 0 });
assert.equal(core.getActiveCombatant(collection).id, 'b', 'active target advances immediately after death');
assert.equal(core.resolveEnemyTargets(collection, { mode: 'by_id', id: 'a' }, core.createBattleRandomState(1)).targets.length, 0);
const removed = core.removeDefeatedCombatants(collection);
assert.deepEqual(removed.removed.map(value => value.id), ['a']);
assert.deepEqual(removed.collection.order, ['b', 'c']);
assert.equal(core.validateCombatantCollection(JSON.parse(JSON.stringify(removed.collection))), true);

const planned = core.prepareEnemyActionQueue(
  [enemy('slow', 10, 1), enemy('fast', 10, 5), enemy('priority', 10, 0, 2)],
  core.createBattleRandomState(42),
);
assert.deepEqual(planned.entries.map(entry => entry.enemyId), ['priority', 'fast', 'slow']);
assert.equal(planned.enemies.every(value => value.nextAction), true);

const alive = new Set(['priority', 'slow']);
const actionOrder = [];
const run = await core.runEnemyActionQueue(planned.entries, {
  isAlive: id => alive.has(id),
  isTerminal: () => false,
  execute: entry => actionOrder.push(entry.enemyId),
});
assert.deepEqual(actionOrder, ['priority', 'slow']);
assert.deepEqual(run.skipped.map(entry => entry.enemyId), ['fast'], 'dead enemies are skipped at their action slot');

let terminal = false;
const stopped = await core.runEnemyActionQueue(planned.entries, {
  isAlive: () => true,
  isTerminal: () => terminal,
  execute: () => { terminal = true; },
});
assert.equal(stopped.executed.length, 1);
assert.equal(stopped.completed, false, 'player death stops the remaining enemy queue');

assert.throws(() => core.createCombatantCollection([enemy('same', 1), enemy('same', 2)]), /duplicate/);
console.log('Multi-enemy core covers identity, target modes, deterministic random hits, active fallback, death removal, speed, priority, and terminal queues.');
