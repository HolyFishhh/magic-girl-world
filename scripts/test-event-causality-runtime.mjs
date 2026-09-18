import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

function combatState(enemyHp = 20) {
  const state = core.createEmptyBattleState();
  state.phase = 'player_turn';
  state.currentTurn = 1;
  state.player.currentHp = 30;
  state.player.maxHp = 30;
  state.enemy = {
    id: 'enemy-a', name: '测试敌人', emoji: 'E', maxHp: 20, currentHp: enemyHp,
    maxLust: 10, currentLust: 0, energy: 0, maxEnergy: 0, block: 0,
    statusEffects: [], abilities: [], actions: [], nextAction: null,
    intent: { type: 'unknown', description: '', emoji: '' }, dialogue: '',
  };
  state.enemies = [state.enemy];
  state.activeEnemyId = 'enemy-a';
  return state;
}

function executorFor(store) {
  const executor = Object.create(UnifiedEffectExecutor.prototype);
  executor.gameStateManager = store;
  executor.executionContext = {
    sourceIsPlayer: true,
    cardContext: { id: 'causal_test', name: '因果测试', type: 'Attack' },
  };
  executor.currentResolvedEnemyId = null;
  executor.pendingDeaths = new Set();
  executor.pendingDeathDetails = new Map();
  executor.presentation = new Proxy({}, { get: () => () => undefined });
  executor.triggerHost = { processAbilitiesByTrigger: async () => {} };
  executor.completeBattleEnd = async () => {};
  return executor;
}

// A damage event must exist before its nested take-damage reaction. If that
// reaction heals the target, no finalized death event may be fabricated.
{
  const store = new core.BattleStateStore(combatState(3));
  const executor = executorFor(store);
  let runtime;
  const dispatchedEventIds = [];
  let healed = false;
  runtime = new core.BattleEffectRuntime(store, {
    readModifierSources: () => [],
    recordResolvedEvent: event => executor.recordResolvedBattleEffectEvent(event),
    dispatchTriggers: async dispatches => {
      dispatchedEventIds.push(...dispatches.map(entry => entry.context.eventId).filter(Boolean));
      if (!healed && dispatches.some(entry => entry.trigger === 'take_damage')) {
        healed = true;
        await runtime.execute(
          { type: 'heal', target: 'self', amount: 2 },
          { source: 'enemy', sourceEnemyId: 'enemy-a', targetEnemyId: 'enemy-a' },
        );
      }
    },
    handleLustOverflow: async () => {},
    present: () => {},
  });
  executor.battleEffectRuntime = runtime;
  await executor.executeModernBattleCommand(
    { type: 'damage', target: 'opponent', amount: 3, damageKind: 'attack' },
    true,
  );
  await executor.processPendingDeaths();
  const journal = store.getGameState().eventJournal;
  assert.deepEqual(journal.events.map(event => event.kind), ['damage_resolved', 'heal_resolved']);
  assert.equal(journal.events[0].id, 'event:1');
  assert.equal(journal.events[1].cause.rootEventId, 'event:2');
  assert.ok(dispatchedEventIds.includes('event:1'), 'damage reactions bind to the already persisted event');
  assert.equal(store.getEnemy().currentHp, 2);
  assert.equal(journal.events.some(event => event.kind === 'entity_defeated'), false);
}

// Status ownership, its apply effect, successful trigger completion and
// removal are all persisted in causal order. Ownership filters receive the
// exact status event rather than predicting a future one.
{
  const store = new core.BattleStateStore(combatState(20));
  const executor = executorFor(store);
  executor.currentResolvedEnemyId = 'enemy-a';
  const ownershipContexts = [];
  const definitions = new Map([
    ['marked', {
      id: 'marked', name: '标记', emoji: '◆', description: '测试状态', type: 'debuff', maxStacks: 9,
      triggers: {},
    }],
  ]);
  const lifecycle = new core.StatusLifecycleRuntime({
    state: store,
    definitions: {
      get: id => definitions.get(id),
      getTriggerEffects: (_id, trigger) => ['apply', 'remove'].includes(trigger) ? [{ marker: trigger }] : [],
    },
    transactions: {
      beginTransaction: async () => store.getGameState(),
      commitTransaction: async () => {},
      rollbackTransaction: async snapshot => store.replaceState(snapshot),
    },
    execute: async (effect, target, context) => {
      store.recordBattleEvent({
        turn: 1, phase: 'resolve', kind: 'resource_changed',
        actorId: target === 'player' ? 'player' : 'enemy-a', targetId: target === 'player' ? 'player' : 'enemy-a',
        resource: `marker_${effect.marker}`, previousValue: 0, nextValue: 1, change: 'gain',
        cause: { source: { kind: 'status', id: context.statusContext.id } },
      });
    },
    dispatch: async dispatches => ownershipContexts.push(...dispatches.map(entry => entry.context)),
    record: event => executor.recordCombatantStatusEvent(event),
    present: () => {},
  });
  await lifecycle.apply('enemy', 'marked', 2);
  await lifecycle.remove('enemy', 'marked');
  const journal = store.getGameState().eventJournal;
  assert.deepEqual(journal.events.map(event => event.kind), [
    'status_applied', 'resource_changed', 'status_triggered',
    'status_removed', 'resource_changed', 'status_triggered',
  ]);
  assert.equal(ownershipContexts[0].eventId, 'event:1');
  assert.equal(ownershipContexts.at(-1).eventId, 'event:4');
  assert.equal(journal.events[0].targetId, 'enemy-a');
  assert.equal(journal.events[3].targetId, 'enemy-a');
}

console.log('Attribute and combatant-status journals preserve causal order, exact trigger identity, and revival truth.');
