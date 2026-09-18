import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const { GameStateManager } = require(resolve('src/fish/core/gameStateManager.ts'));
const { BattleSessionHost } = require(resolve('src/fish/core/battleSessionHost.ts'));

const store = GameStateManager.getInstance();
const initial = core.createEmptyBattleState();
initial.player.currentHp = initial.player.maxHp = 30;
initial.random = core.createBattleRandomState(814);
store.replaceState(initial);

const observed = [];
const host = BattleSessionHost.getInstance();
const ports = {
  ...host.triggerTransactionPorts(),
  onRecoveredFailure: failure => {
    observed.push({
      scope: failure.scope,
      error: failure.error,
      restored: structuredClone(store.getGameState()),
    });
  },
};

for (const scope of ['status_tick_player_poison', 'relic_turn_start_lantern', 'card_after_play_echo']) {
  const before = structuredClone(store.getGameState());
  const result = await core.runTriggerTransaction(
    scope,
    ports,
    () => {
      store.updatePlayer({ currentHp: before.player.currentHp - 7 });
      store.nextRandom();
      throw new Error(`${scope} failed`);
    },
    'recover-and-continue',
  );

  assert.equal(result.status, 'rolled_back', `${scope} must recover through the production session host`);
  assert.deepEqual(store.getGameState(), before, `${scope} must restore all battle state and the RNG cursor`);
  const recovery = observed.at(-1);
  assert.equal(recovery.scope, scope);
  assert.equal(recovery.error, result.cause);
  assert.deepEqual(recovery.restored, before, 'the observer is notified only after rollback has restored state');
}

const beforeLegalTrigger = structuredClone(store.getGameState());
const legal = await core.runTriggerTransaction('status_tick_player_legal', ports, () => {
  store.updatePlayer({ currentHp: beforeLegalTrigger.player.currentHp - 1 });
  store.nextRandom();
  return 'continued';
}, 'recover-and-continue');

assert.deepEqual(legal, { status: 'completed', value: 'continued' });
assert.equal(store.getPlayer().currentHp, beforeLegalTrigger.player.currentHp - 1);
assert.notDeepEqual(store.getGameState().random, beforeLegalTrigger.random, 'a following legal trigger can commit a fresh RNG draw');
assert.equal(observed.length, 3, 'successful triggers must not be reported as recovered failures');

console.log('Production BattleSessionHost reports recovered status/relic/card triggers after state and RNG rollback, then commits the next legal trigger.');
