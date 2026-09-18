import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/index.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
for (const actorId of ['player', 'summon:1', 'enemy-a']) {
  const state = core.createEmptyBattleState();
  state.currentTurn = 1;
  state.phase = 'player_turn';
  const store = new core.BattleStateStore(state);
  const executor = Object.create(UnifiedEffectExecutor.prototype);
  const received = [];
  executor.gameStateManager = store;
  executor.executionContext = { sourceIsPlayer: true };
  executor.pendingDeathDetails = new Map([['enemy-a', {
    actorId, source: { kind: 'card', id: 'feast' }, method: 'damage', fatal: true,
  }]]);
  executor.triggerHost = { processAbilitiesByTrigger: async (...args) => received.push(args) };
  executor.relicTriggerHost = { triggerRelics: async (...args) => received.push(args) };
  await executor.recordFinalizedDefeat('enemy-a');
  await executor.recordFinalizedDefeat('enemy-a');
  assert.equal(store.getGameState().eventJournal.events.filter(e => e.kind === 'entity_defeated').length, 1);
  assert.equal(received.length, actorId === 'player' ? 2 : 0, 'only actual player kills credit player listeners');
  if (actorId === 'player') {
    assert.equal(received[0][1], 'kill');
    assert.equal(received[0][2].targetId, 'enemy-a');
    assert.equal(received[0][2].sourceId, 'feast');
    assert.equal(received[0][2].phase, 'after');
    const query = require('../src/game-core/triggerInput.ts').resolveEventTriggerQueryInput({ on: 'kill', source_kind: 'card', source_id: 'feast' });
    assert.equal(core.battleEventMatches(store.getGameState().eventJournal.events[0], query.filter), true);
    assert.equal(core.battleEventMatches(store.getGameState().eventJournal.events[0], { ...query.filter, sourceId: 'other_card' }), false);
  }
}
assert.equal(core.abilityTriggerRecipientScope('kill'), 'source');
for (const type of ['damage', 'execute', 'kill']) {
  const state = core.createEmptyBattleState();
  state.phase = 'player_turn';
  state.currentTurn = 1;
  state.player.currentHp = state.player.maxHp = 30;
  state.enemy = { id: 'victim', name: '测试', emoji: 'E', currentHp: 3, maxHp: 3,
    currentLust: 0, maxLust: 10, block: 0, energy: 0, maxEnergy: 0, statusEffects: [],
    abilities: [], actions: [], nextAction: null, intent: { type: 'unknown', description: '', emoji: '' }, dialogue: '' };
  state.enemies = [state.enemy]; state.activeEnemyId = 'victim';
  const store = new core.BattleStateStore(state);
  const executor = Object.create(UnifiedEffectExecutor.prototype);
  executor.gameStateManager = store;
  executor.executionContext = { sourceIsPlayer: true, cardContext: { id: 'feast', type: 'Attack' } };
  executor.pendingDeaths = new Set(); executor.pendingDeathDetails = new Map();
  executor.presentation = new Proxy({}, { get: () => () => undefined });
  const order = [];
  executor.triggerHost = { processAbilitiesByTrigger: async (_side, trigger) => {
    order.push(trigger);
    if (trigger === 'kill') await executor.executePersistentGrowth({ type: 'persistent_growth', stat: 'max_hp', operator: 'add', value: 4 }, true);
  } };
  executor.relicTriggerHost = { triggerRelics: async () => {} };
  const variables = { stat_data: { battle: { core: { hp: 30, max_hp: 30, lust: 0, max_lust: 100 } } } };
  executor.completeBattleEnd = async () => {
    order.push('settlement');
    require('../src/runtime/battleSettlementAdapter.ts').settleTavernBattleVariables(variables, {
      result: 'victory', player: store.getPlayer(), persistentGrowth: store.getGameState().persistentGrowth,
    });
  };
  executor.battleEffectRuntime = new core.BattleEffectRuntime(store, {
    readModifierSources: () => [], recordResolvedEvent: event => executor.recordResolvedBattleEffectEvent(event),
    dispatchTriggers: async () => {}, handleLustOverflow: async () => {}, present: () => {},
  });
  await executor.executeModernBattleCommand(type === 'damage'
    ? { type, target: 'opponent', amount: 3, damageKind: 'attack' }
    : { type, target: 'opponent', threshold: 100 }, true);
  await executor.processPendingDeaths();
  assert.equal(order.filter(entry => entry === 'kill').length, 1, `${type} credits one kill`);
  assert.ok(order.indexOf('kill') < order.indexOf('settlement'), 'growth hooks run before battle settlement');
  assert.equal(variables.stat_data.battle.core.max_hp, 34, 'actual lethal command reaches persistent max-HP settlement');
}
assert.equal(require('../src/game-core/triggerEventContract.ts').impliedTriggerEventFilter('kill').kind, 'entity_defeated');
console.log('kill trigger attribution, source identity and duplicate-death tests passed');
