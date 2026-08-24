import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { ReferenceBattleRuntimeHost } = require(resolve('src/adapters/referenceBattleRuntimeHost.ts'));

const host = new ReferenceBattleRuntimeHost({
  ...core.createEmptyBattleState(),
  phase: 'player_turn',
  currentTurn: 1,
  random: core.createBattleRandomState(72),
});

const outer = host.beginTransaction('end_turn');
host.updatePlayer({ currentHp: 33 });
host.incrementTurn();
const nested = host.beginScopedTransaction('status_tick');
host.updatePlayer({ currentHp: 1 });
host.rollbackTransaction(nested);
assert.equal(host.getPlayer().currentHp, 33);
assert.equal(host.getGameState().currentTurn, 2);
host.commitTransaction(outer);

const beforeFailure = host.getGameState();
await assert.rejects(
  core.runBattleSessionAtomicAction(
    'use_item',
    { ...host.transactionPorts(), canRun: () => true, isTerminal: () => host.isGameOver() },
    async () => {
      host.updatePlayer({ currentHp: 2 });
      throw new Error('fixture failure');
    },
  ),
  /fixture failure/,
);
assert.deepEqual(host.getGameState(), beforeFailure);

const trigger = host.beginScopedTransaction('relic');
host.nextRandom();
host.rollbackTransaction(trigger);
assert.deepEqual(host.getGameState().random, beforeFailure.random, 'random cursor must roll back with state');

host.setEnemy({
  id: 'portable_enemy',
  name: 'Portable Enemy',
  maxHp: 20,
  currentHp: 20,
  maxLust: 100,
  currentLust: 0,
  energy: 0,
  maxEnergy: 0,
  block: 2,
  statusEffects: [],
  intent: { type: 'attack', description: '', emoji: '' },
  emoji: '',
  actions: [],
  nextAction: null,
  dialogue: '',
});
const battleEffects = host.createBattleEffectRuntime({
  readModifierSources: () => [],
  dispatchTriggers: async () => {},
  handleLustOverflow: async () => {},
});
await battleEffects.execute({ type: 'damage', target: 'opponent', amount: 5 }, { source: 'player' });
assert.equal(host.getEnemy().block, 0);
assert.equal(host.getEnemy().currentHp, 17);

assert.throws(() => host.commitTransaction('missing'), /unknown battle transaction/);
assert.throws(() => host.rollbackTransaction('missing'), /unknown battle transaction/);

console.log('Reference battle runtime provides portable state, effects, and nested transactions without Tavern.');
