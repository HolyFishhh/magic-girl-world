import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const core = require(resolve('src/game-core/index.ts'));
const { GameStateManager } = require(resolve('src/fish/core/gameStateManager.ts'));
const { CardSystem } = require(resolve('src/fish/combat/cardSystem.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));
const { inspectBattleDataContract } = require(resolve('src/fish/core/battleDataContract.ts'));
const store = GameStateManager.getInstance();
const system = CardSystem.getInstance();
const quiet = new Proxy({}, { get: () => async () => undefined });
system.presentation = quiet;
UnifiedEffectExecutor.getInstance().presentation = quiet;
let variables;
globalThis.getCurrentMessageId = globalThis.getLastMessageId = () => 0;
globalThis.getVariables = () => structuredClone(variables);
globalThis.updateVariablesWith = async updater => (variables = await updater(structuredClone(variables)));
globalThis.replaceVariables = globalThis.insertOrAssignVariables = () => { throw new Error('unexpected write'); };

const raw = (id, effects, run = `${id}:run`) => ({
  id, templateId: id, runInstanceId: run, quantity: 1, origin: 'deck',
  name: id, emoji: '🃏', type: 'Skill', rarity: 'Common', cost: 0, description: '', effects,
});
const authored = [
  raw('trim', [{ discard: 1, from: 'hand', pick: 'choose' }, { block: 2 }]),
  raw('guard', [{ block: 1 }]),
  raw('guard', [{ block: 1 }], 'guard:second'),
];
function runtime(card, index) {
  const result = core.compileCompactEffectList(card.effects);
  assert.equal(result.ok, true);
  return core.ensureCardIdentity({ ...card, id: `${card.id}__${index}`, originalId: card.id, effectProgram: result.value }, {
    templateId: card.id, runInstanceId: card.runInstanceId, combatInstanceId: `${card.id}__${index}`, origin: 'deck',
  });
}
function reset() {
  store.resetGame();
  const stats = { emoji: '◇', hp: 40, max_hp: 40, lust: 0, max_lust: 100 };
  variables = { stat_data: { battle: { core: stats, enemy: { ...stats, id: 'dummy', name: 'Dummy' }, cards: structuredClone(authored) } } };
  assert.equal(inspectBattleDataContract(variables).ok, true);
  const state = core.createEmptyBattleState();
  state.phase = 'player_turn'; state.currentTurn = 1;
  state.enemy = { ...structuredClone(state.player), id: 'dummy', name: 'Dummy', actions: [] };
  state.enemies = [state.enemy]; state.activeEnemyId = 'dummy';
  state.player.hand = authored.map(runtime);
  store.replaceState(state);
}
const zones = () => structuredClone(store.readCardZoneState());
const owned = () => Object.values(zones()).flat();
const ids = () => owned().map(card => card.runInstanceId).sort();
const originalIds = authored.map(card => card.runInstanceId).sort();
const errors = [];
const originalError = console.error;
console.error = (...args) => errors.push(args.map(String).join(' '));

try {
  // Only replace the UI surface. Real CardSystem, selection host, transaction,
  // zone-plan snapshot/commit and MVU synchronization remain in the call chain.
  reset();
  assert.equal(system.previewCardPlay('trim__0').ok, true);
  system.cardSelectionHost.presentation = { selectCards: async candidates => {
    const pending = zones();
    await new Promise(done => setTimeout(done, 40)); // live render debounce is 30ms
    store.syncNewCardsFromMVU();
    store.syncNewCardsFromMVU();
    assert.deepEqual(zones(), pending, 'render-time MVU sync must not reinsert the card being resolved');
    return [candidates[0].id];
  } };
  assert.equal(await system.playCard('trim__0'), true, errors.join('\n'));
  assert.equal(store.getPlayer().block, 2);
  assert.equal(store.getPlayer().discardPile.length, 2);
  store.syncNewCardsFromMVU();
  assert.deepEqual(ids(), originalIds, 'committed cards keep each persistent instance exactly once');

  // A real MVU addition during a choice still invalidates the plan. Do not
  // turn STALE_PLAN into a success or silently apply the obsolete selection.
  reset();
  const beforeConflict = structuredClone(store.getGameState());
  system.cardSelectionHost.presentation = { selectCards: async candidates => {
    variables.stat_data.battle.cards.push(raw('new_reward', [{ block: 3 }]));
    store.syncNewCardsFromMVU();
    return [candidates[0].id];
  } };
  assert.equal(await system.playCard('trim__0'), false);
  assert.match(errors.at(-1), /STALE_PLAN/);
  assert.deepEqual(store.getGameState(), beforeConflict, 'obsolete choice rolls back the entire play');
  store.syncNewCardsFromMVU();
  assert.deepEqual(ids(), [...originalIds, 'new_reward:run'].sort(), 'after rollback, real additions are reconciled once');

  // Required root selections cannot be cancelled to skip a mandatory cost.
  reset();
  const beforeCancel = structuredClone(store.getGameState());
  system.cardSelectionHost.presentation = { selectCards: async () => { store.syncNewCardsFromMVU(); return null; } };
  assert.equal(await system.playCard('trim__0'), false);
  assert.deepEqual(store.getGameState(), beforeCancel, 'invalid cancellation rolls back effects and card transit');
  store.syncNewCardsFromMVU();
  assert.deepEqual(ids(), originalIds);

  // Nested auto-play can reserve two concrete cards from one template.
  reset();
  const first = store.getPlayer().hand[1], second = store.getPlayer().hand[2];
  store.beginCardTransit(first); store.beginCardTransit(first); store.beginCardTransit(second);
  store.updatePlayer({ hand: store.getPlayer().hand.filter(card => card.id !== first.id && card.id !== second.id) });
  store.endCardTransit({ ...first });
  store.syncNewCardsFromMVU();
  assert.equal(owned().length, 1, 'reference-counted exact reservations survive nested completion and cloned cards');
  store.endCardTransit(first);
  store.syncNewCardsFromMVU();
  assert.deepEqual(ids(), ['guard:run', 'trim:run'].sort(), 'another copy of the same template remains reserved');
  store.endCardTransit(second); store.endCardTransit(second);
  store.syncNewCardsFromMVU(); store.syncNewCardsFromMVU();
  assert.deepEqual(ids(), originalIds);
  store.beginCardTransit(first);
  store.resetGame();
  store.syncNewCardsFromMVU();
  assert.deepEqual(ids(), originalIds, 'new battle clears all transient ownership');

  reset();
  const launcher = raw('launcher', [{ auto_play: 1, from: 'draw', pick: 'top', free: true }]);
  variables.stat_data.battle.cards.push(launcher);
  const current = store.getPlayer();
  store.updatePlayer({ hand: [...current.hand.slice(1), runtime(launcher, 3)], drawPile: [current.hand[0]] });
  system.cardSelectionHost.presentation = { selectCards: async candidates => {
    const pending = zones();
    await new Promise(done => setTimeout(done, 40));
    store.syncNewCardsFromMVU();
    assert.deepEqual(zones(), pending, 'real nested auto-play reserves both the launcher and resolving child');
    return [candidates[0].id];
  } };
  assert.equal(await system.playCard('launcher__3'), true, errors.join('\n'));
  store.syncNewCardsFromMVU();
  assert.deepEqual(ids(), [...originalIds, 'launcher:run'].sort());
  assert.equal(store.getPlayer().block, 2);
} finally {
  console.error = originalError;
}
console.log('PASS MVU exact-instance ownership during real interactive card play; rollback preserves true stale-plan protection; cancellation, nested same-template reservations and reset reconcile exactly once.');
