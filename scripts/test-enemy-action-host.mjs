import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { prepareNextEnemyAction } = require(resolve('src/fish/core/enemyActionHost.ts'));

const effectProgram = { version: 1, commands: [] };
let enemy = {
  id: 'test-enemy',
  name: 'Test Enemy',
  actionMode: 'sequence',
  actionConfig: { sequence: ['Guard', 'Strike'] },
  _sequenceIndex: 0,
  _sequenceDoneOnce: false,
  actions: [
    { name: 'Strike', description: 'Strike', effect: 'damage:6', weight: 1 },
    { name: 'Guard', description: 'Guard', effect: 'block:5', effectProgram, weight: 1 },
  ],
};
let randomDraws = 0;
const updates = [];
const port = {
  getEnemy: () => enemy,
  nextRandom: () => {
    randomDraws += 1;
    return 0.5;
  },
  updateEnemy(update) {
    updates.push(update);
    enemy = { ...enemy, ...update };
  },
};

const first = prepareNextEnemyAction(port);
assert.equal(first.name, 'Guard');
assert.equal(enemy.nextAction.name, 'Guard');
assert.equal(enemy.nextAction.effectProgram, effectProgram, 'portable effect programs must survive state persistence');
assert.equal(enemy._sequenceIndex, 1);
assert.equal(randomDraws, 0, 'a valid sequence must not consume the random source');

const second = prepareNextEnemyAction(port);
assert.equal(second.name, 'Strike');
assert.equal(enemy.nextAction.name, 'Strike');
assert.equal(enemy._sequenceIndex, 0);
assert.equal(updates.length, 2);

enemy = { ...enemy, actions: [] };
assert.equal(prepareNextEnemyAction(port), null);
assert.equal(updates.length, 2, 'empty action lists must not mutate persisted enemy state');

console.log('Enemy action host selects and persists actions without presentation dependencies.');
