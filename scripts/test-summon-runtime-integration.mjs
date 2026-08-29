import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));
const { GameStateManager } = require(resolve('src/fish/core/gameStateManager.ts'));
const { DynamicStatusManager } = require(resolve('src/fish/combat/dynamicStatusManager.ts'));

const state = core.createEmptyBattleState();
const store = new core.BattleStateStore(state);
const actionProgram = { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 1 }] };
const spawnedFirst = store.spawnSummons('player', {
  id: 'first_actor', name: '先行者', emoji: '⚡', maxHp: 8,
  actionProgram, actionPriority: 3, speed: 2,
}, 1).spawned[0];
const spawnedVictim = store.spawnSummons('player', {
  id: 'late_actor', name: '后行者', emoji: '🌙', maxHp: 5,
  actionProgram, actionPriority: 1, speed: 9,
}, 1).spawned[0];

const executor = Object.create(UnifiedEffectExecutor.prototype);
executor.gameStateManager = store;
executor.executionContext = { sourceIsPlayer: true };
const summonAnimations = [];
executor.presentation = {
  addLog: () => {},
  showSummonAction: (unit, action) => summonAnimations.push([unit.instanceId, action.id]),
};
const executed = [];
executor.executeEffectProgram = async (_program, sourceIsPlayer, context) => {
  executed.push([context.summonContext.instanceId, sourceIsPlayer]);
  if (context.summonContext.instanceId === spawnedFirst.instanceId) {
    store.damageSummons([spawnedVictim.instanceId], 99);
  }
};

await executor.processSummonActions('player');
assert.deepEqual(executed, [[spawnedFirst.instanceId, true]], 'a summon killed before its queue entry never acts');
assert.deepEqual(summonAnimations, [[spawnedFirst.instanceId, 'first_actor_action']], 'summon actions animate from their own stable identity');
assert.deepEqual(
  store.getGameState().eventJournal.events.filter(event => event.kind === 'summon_acted').map(event => event.summonId),
  [spawnedFirst.instanceId],
  'the journal records only actions that actually began resolving',
);

const enemySummon = store.spawnSummons('enemy', {
  id: 'enemy_actor', name: '敌方召唤', emoji: '👁️', maxHp: 6,
  actionProgram, actionPriority: 2, speed: 2,
}, 1).spawned[0];
executor.executeEffectProgram = async (_program, sourceIsPlayer, context) => {
  executed.push([context.summonContext.instanceId, sourceIsPlayer]);
};
await executor.processSummonActions('enemy');
assert.deepEqual(executed.at(-1), [enemySummon.instanceId, false], 'enemy-owned summons preserve enemy targeting perspective');

store.writeSummons({
  ...store.readSummons(),
  living: store.readSummons().living.map(unit => ({ ...unit, interceptionsThisTurn: 2 })),
});
store.resetSummonsForTurn('player');
assert.equal(store.getSummonById(spawnedFirst.instanceId).interceptionsThisTurn, 0);
assert.equal(store.getSummonById(enemySummon.instanceId).interceptionsThisTurn, 2, 'turn reset is owner-local');

const overflowStore = new core.BattleStateStore(core.createEmptyBattleState());
const overflowExecutor = Object.create(UnifiedEffectExecutor.prototype);
overflowExecutor.gameStateManager = overflowStore;
overflowExecutor.executionContext = { sourceIsPlayer: true };
const overflowTriggers = [];
overflowExecutor.triggerHost = {
  processSummonUnitAbilities: async (summon, trigger, context) => {
    overflowTriggers.push([summon.instanceId, trigger, context.reason || '']);
  },
};
overflowExecutor.presentation = {
  addLog: () => {},
};
await overflowExecutor.executeSummonCommand({
  type: 'spawn_summon',
  target: 'self',
  summon: {
    id: 'overflow_actor', name: 'Overflow Actor', emoji: 'O', maxHp: 3,
    abilities: [{
      id: 'last_echo', name: 'Last Echo', trigger: 'defeated',
      effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'opponent', amount: 1 }] },
    }],
  },
  count: 11,
  capacity: 10,
  overflow: 'replace_oldest',
}, true);
assert.equal(overflowStore.getSummons('player').length, 10, 'runtime keeps ten living summons after overflow');
assert.equal(overflowStore.getSummons('player', false).filter(unit => unit.currentHp <= 0).length, 1);
assert.deepEqual(
  overflowTriggers.filter(([, trigger]) => trigger === 'defeated'),
  [['overflow_actor__summon__1', 'defeated', 'overflow']],
  'the displaced oldest summon resolves its defeated trigger before leaving play',
);
assert.equal(
  overflowStore.getGameState().eventJournal.events.some(event =>
    event.kind === 'summon_defeated' && event.summonId === 'overflow_actor__summon__1' && event.reason === 'replace'
  ),
  true,
  'overflow replacement is journaled as a summon defeat',
);
assert.equal(
  overflowStore.getGameState().eventJournal.events.filter(event => event.kind === 'summon_spawned').length,
  11,
  'the replacement summon enters normally after the displaced unit is defeated',
);

const copyStore = new core.BattleStateStore(core.createEmptyBattleState());
const copySource = copyStore.spawnSummons('player', {
  id: 'copy_source', name: 'Copy Source', emoji: 'C', maxHp: 9,
  resources: { charge: { id: 'charge', name: 'Charge', emoji: 'E', current: 2, max: 5, refresh: 'retain' } },
  actions: [{
    id: 'copy_strike', name: 'Copy Strike', fixed: false,
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 4 }] },
  }],
  abilities: [{
    id: 'copy_departure', name: 'Copy Departure', trigger: 'defeated', fixed: false,
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 3 }] },
  }],
}, 1, 1).spawned[0];
copyStore.applyStatusToSummons([copySource.instanceId], {
  id: 'copy_mark', name: 'Copy Mark', emoji: 'M', description: 'retained', type: 'buff',
}, 2);
copyStore.modifySummonEffects([copySource.instanceId], 'damage', 'add', 2);
const copyExecutor = Object.create(UnifiedEffectExecutor.prototype);
copyExecutor.gameStateManager = copyStore;
copyExecutor.executionContext = { sourceIsPlayer: true };
copyExecutor.resolveSummonCapacity = (_owner, capacity) => capacity;
copyExecutor.currentEffectSource = () => ({ kind: 'card', id: 'copy_test' });
copyExecutor.combatantJournalId = owner => owner;
copyExecutor.summonJournalOwner = owner => owner;
copyExecutor.recordSummonDefeat = () => {};
copyExecutor.presentation = { addLog: () => {} };
const copyTriggers = [];
copyExecutor.triggerHost = {
  processSummonUnitAbilities: async (summon, trigger, context) => {
    copyTriggers.push([summon.instanceId, trigger, context.reason || '']);
  },
};
await copyExecutor.executeSummonCommand({
  type: 'copy_summons', selector: { owner: 'self', pick: 'left' }, targetOwner: 'self',
  capacity: 1, overflow: 'replace_oldest',
}, true);
const copiedRuntime = copyStore.getSummons('player')[0];
assert.notEqual(copiedRuntime.instanceId, copySource.instanceId);
assert.equal(copiedRuntime.statusEffects[0].stacks, 2, 'runtime copy retains current summon statuses');
assert.equal(copiedRuntime.resources.charge.current, 2, 'runtime copy retains current summon resources');
assert.equal(copiedRuntime.actions[0].effectProgram.steps[0].amount, 6, 'runtime copy retains transformed action values');
assert.deepEqual(copyTriggers, [
  [copySource.instanceId, 'defeated', 'copy_overflow'],
  [copiedRuntime.instanceId, 'battle_start', 'copy'],
]);
await copyExecutor.executeSummonCommand({
  type: 'dismiss_summons', selector: { owner: 'self', pick: 'right' }, retainCorpse: false,
}, true);
assert.equal(copyStore.getSummons('player').length, 0);
assert.deepEqual(copyTriggers.at(-1), [copiedRuntime.instanceId, 'defeated', 'dismiss'], 'explicit removal resolves summon departure abilities');

copyStore.spawnSummons('enemy', { id: 'enemy_choice', name: 'Enemy Choice', emoji: 'E', maxHp: 2 }, 2, 3);
const enemyManualChoice = await copyExecutor.selectSummons(
  { owner: 'self', pick: 'choose', count: 1 }, 'enemy', false,
);
assert.equal(enemyManualChoice.length, 1);
assert.equal(enemyManualChoice[0].createdSequence, copyStore.getSummons('enemy')[0].createdSequence, 'enemy choose selectors resolve deterministically without asking the player');

const holderStore = new core.BattleStateStore(core.createEmptyBattleState());
const holderA = holderStore.spawnSummons('player', {
  id: 'status_holder', name: 'Status Holder', emoji: 'A', maxHp: 10, block: 1,
}, 1).spawned[0];
const holderB = holderStore.spawnSummons('player', {
  id: 'status_bystander', name: 'Status Bystander', emoji: 'B', maxHp: 10, block: 1,
}, 1).spawned[0];
const holderExecutor = Object.create(UnifiedEffectExecutor.prototype);
holderExecutor.gameStateManager = holderStore;
holderExecutor.executionContext = {
  sourceIsPlayer: true,
  summonContext: holderA,
  summonStatusContext: { summonId: holderA.instanceId },
  statusContext: { id: 'holder_status', stacks: 1 },
};
holderExecutor.dynamicStatusManager = { getStatusDefinition: () => undefined };
holderExecutor.recordSummonDefeat = () => {};
await holderExecutor.executeModernBattleCommand({
  type: 'gain_block', target: 'self', amount: 4,
}, true);
assert.equal(holderStore.getSummonById(holderA.instanceId).block, 5);
assert.equal(
  holderStore.getSummonById(holderB.instanceId).block,
  1,
  'ordinary self in a summon status trigger rebinds to one exact holder, not every allied summon',
);
await holderExecutor.executeModernBattleCommand({
  type: 'damage', target: 'self', amount: 99, bypassBlock: true,
}, true);
await holderExecutor.executeModernBattleCommand({
  type: 'gain_block', target: 'self', amount: 99,
}, true);
assert.equal(holderStore.getPlayer().block, 0, 'a defeated status holder never redirects later self steps to its owner');
assert.equal(holderStore.getSummonById(holderB.instanceId).block, 1);

const integratedStore = GameStateManager.getInstance();
integratedStore.resetGame();
const integratedExecutor = UnifiedEffectExecutor.getInstance();
integratedExecutor.presentation = {
  addLog: () => {},
  logStatusEffect: () => {},
  showSummonAction: () => {},
  showHealthChange: () => {},
  showBlockAbsorption: () => {},
  showBlockChange: () => {},
  showEnergyChange: () => {},
  showLustChange: () => {},
  showResourceChange: () => {},
  refreshPlayerEnergy: () => {},
};
const abilityHolder = integratedStore.spawnSummons('player', {
  id: 'ability_holder', name: 'Ability Holder', emoji: 'T', maxHp: 10,
  abilities: [{
    id: 'turn_guard', name: 'Turn Guard', trigger: 'turn_start',
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] },
  }],
  actions: [{
    id: 'self_guard', name: 'Self Guard',
    effectProgram: {
      spec: 'mwg.effect/v1',
      steps: [
        { op: 'gain_block', target: 'self', amount: 3 },
        {
          op: 'summoner_effects',
          effects: [
            { op: 'gain_block', target: 'self', amount: 4 },
            { op: 'gain_energy', target: 'self', amount: 1 },
          ],
        },
      ],
    },
  }],
}, 1).spawned[0];
const abilityBystander = integratedStore.spawnSummons('player', {
  id: 'ability_bystander', name: 'Ability Bystander', emoji: 'B', maxHp: 10,
}, 1).spawned[0];
await integratedExecutor.triggerHost.processAbilitiesByTrigger('player', 'turn_start');
assert.equal(integratedStore.getSummonById(abilityHolder.instanceId).block, 2);
assert.equal(integratedStore.getSummonById(abilityBystander.instanceId).block, 0);
assert.equal(integratedStore.getPlayer().block, 0, 'summon ability self resolves on the summon rather than its owner');
await integratedExecutor.processSummonActions('player');
assert.equal(integratedStore.getSummonById(abilityHolder.instanceId).block, 5);
assert.equal(integratedStore.getSummonById(abilityBystander.instanceId).block, 0);
assert.equal(integratedStore.getPlayer().block, 4, 'summoner_effects routes self to the owning combatant');
assert.equal(integratedStore.getPlayer().energy, 4, 'summoner effects may grant ordinary owner resources');

integratedStore.resetGame();
integratedStore.updatePlayer({ currentHp: 40, maxHp: 40, block: 0 });
integratedStore.setEnemies([{
  id: 'test_enemy', name: 'Test Enemy', emoji: 'E', maxHp: 20, currentHp: 20,
  maxLust: 100, currentLust: 0, energy: 0, maxEnergy: 0, block: 0,
  statusEffects: [], intent: { type: 'attack', description: '', emoji: '' },
  actions: [], nextAction: null, dialogue: '',
}], 'test_enemy');
const actionInterceptor = integratedStore.spawnSummons('player', {
  id: 'action_interceptor', name: 'Action Interceptor', emoji: 'G', maxHp: 6,
}, 1).spawned[0];
await integratedExecutor.executeEffectProgram({
  spec: 'mwg.effect/v1',
  steps: [{ op: 'damage', target: 'opponent', amount: 4 }],
}, false, {
  battleContext: { enemyId: 'test_enemy', intent: { id: 'ordinary_strike', name: 'Ordinary Strike' } },
});
assert.equal(
  integratedStore.getPlayer().currentHp,
  40,
  'ordinary enemy action damage defaults to attack damage and is intercepted before reaching the player',
);
assert.equal(integratedStore.getSummonById(actionInterceptor.instanceId).currentHp, 2);
await integratedExecutor.executeEffectProgram({
  spec: 'mwg.effect/v1',
  steps: [{ op: 'damage', target: 'opponent', amount: 2, damageKind: 'effect' }],
}, false, {
  battleContext: { enemyId: 'test_enemy', intent: { id: 'explicit_effect', name: 'Explicit Effect' } },
});
assert.equal(
  integratedStore.getPlayer().currentHp,
  38,
  'an explicitly declared non-attack enemy effect still bypasses summon interception',
);
assert.equal(integratedStore.getSummonById(actionInterceptor.instanceId).currentHp, 2);

integratedStore.resetGame();
const integratedA = integratedStore.spawnSummons('player', {
  id: 'integrated_holder', name: 'Integrated Holder', emoji: 'I', maxHp: 10,
}, 1).spawned[0];
const integratedB = integratedStore.spawnSummons('player', {
  id: 'integrated_bystander', name: 'Integrated Bystander', emoji: 'J', maxHp: 10,
}, 1).spawned[0];
const statusManager = DynamicStatusManager.getInstance();
const integratedDefinition = {
  id: 'integrated_focus', name: 'Integrated Focus', emoji: 'F', description: 'focus', type: 'buff',
  maxStacks: 4, stacks_change: -1, stun: false,
  triggers: {
    apply: [{ spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] }],
    tick: [{ spec: 'mwg.effect/v1', steps: [{ op: 'heal', target: 'self', amount: 1 }] }],
    remove: [{ spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] }],
  },
};
statusManager.registry.replace([]);
statusManager.registry.definitions.set(integratedDefinition.id, integratedDefinition);
integratedExecutor.presentation = {
  addLog: () => {},
  logStatusEffect: () => {},
  showSummonAction: () => {},
  showHealthChange: () => {},
  showBlockAbsorption: () => {},
  showBlockChange: () => {},
  showEnergyChange: () => {},
  showLustChange: () => {},
  showResourceChange: () => {},
  refreshPlayerEnergy: () => {},
};
await integratedExecutor.executeEffectProgram({
  spec: 'mwg.effect/v1',
  steps: [{
    op: 'apply_summon_status',
    selector: { owner: 'self', pick: 'by_id', id: integratedA.instanceId },
    status: integratedDefinition.id,
    stacks: 2,
  }],
}, true);
assert.equal(integratedStore.getSummonById(integratedA.instanceId).block, 2);
assert.equal(integratedStore.getSummonById(integratedB.instanceId).block, 0);
assert.deepEqual(
  integratedStore.getGameState().eventJournal.events
    .filter(event => event.kind.startsWith('summon_status_'))
    .map(event => event.kind),
  ['summon_status_applied', 'summon_status_triggered'],
  'successful summon status application and trigger completion enter the causal journal',
);
await integratedExecutor.processSummonStatusEffectsAtTurnEnd('player');
assert.equal(integratedStore.getSummonById(integratedA.instanceId).statusEffects[0].stacks, 1);
await integratedExecutor.executeEffectProgram({
  spec: 'mwg.effect/v1',
  steps: [{
    op: 'remove_summon_status',
    selector: { owner: 'self', pick: 'by_id', id: integratedA.instanceId },
    status: integratedDefinition.id,
  }],
}, true);
assert.equal(integratedStore.getSummonById(integratedA.instanceId).block, 3);
assert.deepEqual(
  integratedStore.getGameState().eventJournal.events
    .filter(event => event.kind.startsWith('summon_status_'))
    .map(event => event.kind),
  [
    'summon_status_applied', 'summon_status_triggered', 'summon_status_triggered',
    'summon_status_removed', 'summon_status_triggered',
  ],
  'tick, explicit remove, and remove completion are journaled in resolution order',
);

console.log('Summon runtime queues preserve priority, skip defeated entries, journal actions, and keep owner perspective isolated.');
