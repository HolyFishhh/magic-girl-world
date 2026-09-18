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
const { summonIntentBadges } = require(resolve('src/fish/ui/summonIntentDisplay.ts'));

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
executor.triggerHost = {
  processSummonStatusEffectsAtActionTiming: async () => {},
};
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

// Weighted summon behaviour is selected at spawn, survives a snapshot, and
// the activation consumes that persisted selection rather than drawing again.
const plannedStore = new core.BattleStateStore(core.createEmptyBattleState());
plannedStore.setRandomState(core.createBattleRandomState(7));
const planned = plannedStore.spawnSummons('player', {
  id: 'planned_actor', name: '预定行动者', emoji: 'P', maxHp: 5,
  actions: [
    { id: 'guard', name: '预定格挡', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] } },
    { id: 'strike', name: '预定攻击', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 9 }] } },
  ],
}, 1).spawned[0];
assert.ok(planned.plannedActionIds?.[0], 'spawning plans the next weighted action');
const restoredPlannedStore = new core.BattleStateStore(structuredClone(plannedStore.getGameState()));
assert.deepEqual(restoredPlannedStore.getSummonById(planned.instanceId).plannedActionIds, planned.plannedActionIds, 'planned actions persist through a battle snapshot restore');
const plannedExecutor = Object.create(UnifiedEffectExecutor.prototype);
plannedExecutor.gameStateManager = restoredPlannedStore;
plannedExecutor.executionContext = { sourceIsPlayer: true };
plannedExecutor.triggerHost = { processSummonStatusEffectsAtActionTiming: async () => {} };
const plannedActions = [];
plannedExecutor.presentation = { addLog: () => {}, showSummonAction: (_unit, action) => plannedActions.push(action.id) };
plannedExecutor.executeEffectProgram = async () => {};
await plannedExecutor.processSummonActions('player');
assert.deepEqual(plannedActions, [planned.plannedActionIds[0]], 'execution uses the persisted planned action identity');
assert.ok(restoredPlannedStore.getSummonById(planned.instanceId).plannedActionIds?.[0], 'the following activation is replanned after execution');

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
  processSummonStatusEffectsAtActionTiming: async () => {},
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
assert.equal(
  overflowTriggers.filter(([, trigger]) => trigger === 'ability_gain').length,
  11,
  'every newly created summon receives its authored ability-gain lifecycle once',
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
  processSummonStatusEffectsAtActionTiming: async () => {},
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
  [copiedRuntime.instanceId, 'ability_gain', 'copy'],
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
holderExecutor.triggerHost = {
  dispatch: async () => {},
  processAbilitiesByTrigger: async () => {},
};
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

const shuffleGrower = integratedStore.spawnSummons('player', {
  id: 'shuffle_grower', name: 'Shuffle Grower', emoji: 'G', maxHp: 10,
  abilities: [{ id: 'shuffle_growth', name: 'Shuffle Growth', trigger: 'on_shuffle',
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'modify_summons',
      selector: { owner: 'self', pick: 'source' }, stat: 'max_hp', operator: 'add', value: 2 }] } }],
}, 1).spawned[0];
await integratedExecutor.triggerHost.processAbilitiesByTrigger('player', 'on_shuffle');
await integratedExecutor.triggerHost.processAbilitiesByTrigger('player', 'on_shuffle');
assert.equal(integratedStore.getSummonById(shuffleGrower.instanceId).maxHp, 14, 'each shuffle strengthens the triggering summon');
assert.equal(integratedStore.getSummonById(abilityBystander.instanceId).maxHp, 10, 'bystanders do not inherit source growth');
assert.equal((await integratedExecutor.selectSummons({ owner: 'self', pick: 'source' }, 'player', true)).length, 0, 'no source context must not pick a random summon');

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

// Compile the public modifier syntax and exercise the real executor, including
// recipient-local mitigation, persisted state and journal amounts.
const vulnerabilityProgram = core.compileCompactEffectList({ modify: 'damage_taken', multiply: 1.5 });
assert.equal(vulnerabilityProgram.ok, true);
integratedStore.updatePlayer({ currentHp: 40, block: 9, modifiers: { damage_taken_modifier: -7 },
  abilities: [{ id: 'owner_vulnerability', name: '易伤', trigger: 'passive', effectProgram: vulnerabilityProgram.value }] });
integratedStore.dismissSummons([actionInterceptor.instanceId], false);
const mitigatingGuard = integratedStore.spawnSummons('player', {
  id: 'mitigating_guard', name: '减伤守卫', emoji: 'G', maxHp: 30,
  modifiers: { damage_taken_modifier: -2 },
}, 1).spawned[0];
integratedStore.replaceState(JSON.parse(JSON.stringify(integratedStore.getGameState())));
await integratedExecutor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 10 }] }, false,
  { battleContext: { enemyId: 'test_enemy', intent: { id: 'mitigation_test', name: '攻击' } } });
assert.equal(integratedStore.getSummonById(mitigatingGuard.instanceId).currentHp, 22, 'the original player vulnerability does not transfer to a summon interceptor');
assert.equal(integratedStore.getPlayer().currentHp, 40);
assert.equal(integratedStore.getPlayer().block, 9);
const interceptedJournal = integratedStore.getGameState().eventJournal.events.filter(event => event.kind === 'damage_resolved' && event.targetId === mitigatingGuard.instanceId).at(-1);
assert.ok(interceptedJournal, 'interception must retain a valid damage journal event');
assert.equal(interceptedJournal.requested, 10);
assert.equal(interceptedJournal.modified, 8);
assert.equal(interceptedJournal.hpLost, 8);

integratedStore.updatePlayer({ currentHp: 40, block: 0, modifiers: {}, abilities: [] });
integratedStore.dismissSummons([mitigatingGuard.instanceId], false);
const fragileGuard = integratedStore.spawnSummons('player', {
  id: 'fragile_guard', name: '脆弱守卫', emoji: 'G', maxHp: 1,
  modifiers: { damage_taken_modifier: 10 },
}, 1).spawned[0];
await integratedExecutor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 10 }] }, false,
  { battleContext: { enemyId: 'test_enemy', intent: { id: 'amplified_test', name: '攻击' } } });
assert.equal(integratedStore.getSummons('player').length, 0);
assert.equal(integratedStore.getPlayer().currentHp, 21);
const amplifiedJournal = integratedStore.getGameState().eventJournal.events.filter(event => event.kind === 'damage_resolved' && event.targetId === fragileGuard.instanceId).at(-1);
assert.ok(amplifiedJournal, 'amplified spillover must not produce a negative, rejected damage event');
assert.equal(amplifiedJournal.requested, 10);
assert.equal(amplifiedJournal.modified, 20);
assert.equal(amplifiedJournal.hpLost, 1);

// Entity-local triggers must follow the exact actor/holder. A side is not an
// identity: player, summon A, and summon B share ownership but never impersonate
// one another for deal/take/block/status events.
integratedStore.resetGame();
integratedStore.updatePlayer({ currentHp: 40, maxHp: 40, block: 0, abilities: [{
  id: 'player_deal_guard', name: 'Player Deal Guard', trigger: 'deal_damage',
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] },
}] });
integratedStore.setEnemies([{
  id: 'causality_enemy', name: 'Causality Enemy', emoji: 'E', maxHp: 100, currentHp: 100,
  maxLust: 100, currentLust: 0, energy: 0, maxEnergy: 0, block: 0,
  statusEffects: [], intent: { type: 'attack', description: '', emoji: '' },
  actions: [], nextAction: null, dialogue: '',
}], 'causality_enemy');
const ownerBlockAbility = (id, trigger, amount) => ({
  id, name: id, trigger,
  effectProgram: {
    spec: 'mwg.effect/v1',
    steps: [{
      op: 'summoner_effects',
      effects: [{ op: 'gain_block', target: 'self', amount }],
    }],
  },
});
const causalityA = integratedStore.spawnSummons('player', {
  id: 'causality_a', name: 'Causality A', emoji: 'A', maxHp: 20,
  actions: [{
    id: 'causality_strike', name: 'Causality Strike',
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 2 }] },
  }],
  abilities: [
    ownerBlockAbility('a_deal', 'deal_damage', 10),
    ownerBlockAbility('a_take', 'take_damage', 7),
    ownerBlockAbility('a_buff', 'gain_buff', 5),
    ownerBlockAbility('a_block', 'gain_block', 3),
  ],
}, 1).spawned[0];
const causalityB = integratedStore.spawnSummons('player', {
  id: 'causality_b', name: 'Causality B', emoji: 'B', maxHp: 20,
  abilities: [
    ownerBlockAbility('b_deal', 'deal_damage', 100),
    ownerBlockAbility('b_take', 'take_damage', 70),
    ownerBlockAbility('b_buff', 'gain_buff', 50),
    ownerBlockAbility('b_block', 'gain_block', 30),
  ],
}, 1).spawned[0];
await integratedExecutor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 2 }],
}, true);
assert.equal(integratedStore.getPlayer().block, 1, 'player damage triggers only the player source ability');
assert.equal(integratedStore.getSummonById(causalityA.instanceId).block, 0);
assert.equal(integratedStore.getSummonById(causalityB.instanceId).block, 0);
await integratedExecutor.executeEffectProgram(causalityA.actions[0].effectProgram, true, {
  triggerType: 'summon_action', summonContext: causalityA, abilityContext: causalityA.actions[0],
});
assert.equal(
  integratedStore.getPlayer().block,
  11,
  'summon A damage triggers A only; neither the player nor summon B impersonates the source',
);
await integratedExecutor.executeEffectProgram(core.compileCompactEffectList([{
  damage_summon: {
    selector: { owner: 'self', pick: 'by_id', id: causalityA.instanceId }, amount: 2,
  },
}]).value, true);
assert.equal(
  integratedStore.getPlayer().block,
  19,
  'damaging summon A triggers the player source once and summon A receiver once',
);
assert.equal(integratedStore.getSummonById(causalityB.instanceId).currentHp, 20, 'summon B is not a false receiver');

const causalityStatus = {
  id: 'causality_focus', name: 'Causality Focus', emoji: 'F', description: 'focus', type: 'buff',
  maxStacks: 4, stacks_change: -1, stun: false, triggers: {},
};
DynamicStatusManager.getInstance().registry.replace([]);
DynamicStatusManager.getInstance().registry.definitions.set(causalityStatus.id, causalityStatus);
await integratedExecutor.executeEffectProgram(core.compileCompactEffectList([{
  apply_summon_status: {
    selector: { owner: 'self', pick: 'by_id', id: causalityA.instanceId },
    id: causalityStatus.id, stacks: 1,
  },
}], { knownStatusIds: new Set([causalityStatus.id]) }).value, true);
assert.equal(integratedStore.getPlayer().block, 24, 'summon status ownership triggers only its exact holder ability');
await integratedExecutor.executeEffectProgram(core.compileCompactEffectList([{
  modify_summon: {
    selector: { owner: 'self', pick: 'by_id', id: causalityA.instanceId },
    stat: 'block', add: 1,
  },
}]).value, true);
assert.equal(integratedStore.getPlayer().block, 27, 'summon block gain triggers only its exact holder ability');

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
    gain_block: [{ spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] }],
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
assert.equal(
  integratedStore.getSummonById(integratedA.instanceId).block,
  3,
  'the newly active status may observe a later gain_block emitted by its own apply program',
);
assert.equal(integratedStore.getSummonById(integratedB.instanceId).block, 0);
await integratedExecutor.executeEffectProgram(core.compileCompactEffectList({
  modify_summon: {
    selector: { owner: 'self', pick: 'by_id', id: integratedA.instanceId },
    stat: 'block', add: 1,
  },
}).value, true);
assert.equal(
  integratedStore.getSummonById(integratedA.instanceId).block,
  5,
  'a summon-held event status answers its exact holder once without recursive gain_block re-entry',
);
assert.equal(integratedStore.getSummonById(integratedB.instanceId).block, 0);
assert.deepEqual(
  integratedStore.getGameState().eventJournal.events
    .filter(event => ['status_applied', 'status_triggered', 'status_removed'].includes(event.kind))
    .filter(event => event.targetId === integratedA.instanceId)
    .map(event => event.kind),
  ['status_applied', 'status_triggered', 'status_triggered', 'status_triggered'],
  'summon apply, apply-produced event, and later event trigger completions enter the causal journal',
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
assert.equal(integratedStore.getSummonById(integratedA.instanceId).block, 6);
assert.deepEqual(
  integratedStore.getGameState().eventJournal.events
    .filter(event => ['status_applied', 'status_triggered', 'status_removed'].includes(event.kind))
    .filter(event => event.targetId === integratedA.instanceId)
    .map(event => event.kind),
  [
    'status_applied', 'status_triggered', 'status_triggered', 'status_triggered',
    'status_removed', 'status_triggered',
  ],
  'turn-end stack decay (without a turn-end tick), explicit remove, and remove completion are journaled in resolution order',
);

integratedStore.resetGame();
const compiledAuthoredSummon = core.compileCompactEffectList({
  spawn_summon: {
    id: 'authored_resource_holder', name: 'Authored Resource Holder', emoji: 'R', max_hp: 5,
    resources: {
      charge: {
        name: 'Charge', emoji: 'C', start: 9, max: 3, refresh: 'retain',
      },
    },
  },
});
assert.equal(compiledAuthoredSummon.ok, true, JSON.stringify(compiledAuthoredSummon.issues));
await integratedExecutor.executeEffectProgram(compiledAuthoredSummon.value, true);
const authoredResourceHolder = integratedStore.getSummons('player')[0];
assert.equal(authoredResourceHolder.resources.charge.id, 'charge');
assert.equal(authoredResourceHolder.resources.charge.current, 3, 'generated initial resources clamp to their declared cap');
integratedStore.createSnapshot('authored_summon_resource');
integratedStore.updateSummonResources([authoredResourceHolder.instanceId], 'charge', 0, 'set');
assert.equal(integratedStore.restoreSnapshot('authored_summon_resource'), true);
assert.equal(
  integratedStore.getSummonById(authoredResourceHolder.instanceId).resources.charge.current,
  3,
  'normalized summoned resources preserve identity and values across snapshot restore',
);
const contradictorySummonResource = core.compileCompactEffectList({
  spawn_summon: {
    id: 'contradictory_resource_holder', name: 'Contradictory Resource Holder', emoji: 'R', max_hp: 5,
    resources: {
      charge: { id: 'stale_generated_id', name: 'Charge', emoji: 'C', start: 1, max: 3, refresh: 'retain' },
    },
  },
});
assert.equal(contradictorySummonResource.ok, false, 'a duplicated resource id must not contradict its authoritative map key');

integratedStore.resetGame();
integratedStore.updatePlayer({ currentHp: 40, maxHp: 40 });
integratedStore.setEnemies([{
  id: 'presence_enemy', name: 'Presence Enemy', emoji: 'E', maxHp: 30, currentHp: 30,
  maxLust: 100, currentLust: 0, energy: 0, maxEnergy: 0, block: 0,
  statusEffects: [], intent: { type: 'attack', description: '', emoji: '' },
  actions: [], nextAction: null, dialogue: '',
}], 'presence_enemy');
integratedStore.spawnSummons('player', {
  id: 'presence_player_unit', name: 'Player Presence Unit', emoji: 'P', maxHp: 5,
}, 2);
integratedStore.spawnSummons('enemy', {
  id: 'presence_enemy_unit', name: 'Enemy Presence Unit', emoji: 'Q', maxHp: 5,
}, 1);
const playerPresenceState = integratedExecutor.createCoreEffectState(true);
assert.equal(playerPresenceState.self.summonCount, 2);
assert.equal(playerPresenceState.opponent.summonCount, 1);
assert.equal(playerPresenceState.self.allyCount, 0, 'the single player has no other non-summon ally');
assert.equal(playerPresenceState.opponent.allyCount, 0, 'a lone enemy has no other non-summon ally');
integratedStore.setEnemies([
  integratedStore.getEnemy(),
  {
    id: 'presence_enemy_ally', name: 'Presence Enemy Ally', emoji: 'A', maxHp: 20, currentHp: 20,
    maxLust: 100, currentLust: 0, energy: 0, maxEnergy: 0, block: 0,
    statusEffects: [], intent: { type: 'attack', description: '', emoji: '' },
    actions: [], nextAction: null, dialogue: '',
  },
], 'presence_enemy');
const enemyPresenceState = integratedExecutor.createCoreEffectState(false);
assert.equal(enemyPresenceState.self.summonCount, 1);
assert.equal(enemyPresenceState.opponent.summonCount, 2, 'enemy formulas see the player roster through opponent.summon_count');
assert.equal(enemyPresenceState.self.allyCount, 1, 'an enemy sees every other living non-summon enemy as an ally');
assert.equal(enemyPresenceState.opponent.allyCount, 0, 'the enemy sees no extra player-side non-summon ally');
const enemySummonPresenceState = integratedExecutor.createCoreEffectState(false, integratedStore.getSummons('enemy')[0]);
assert.equal(enemySummonPresenceState.self.allyCount, 2, 'enemy summons see all living non-summon enemies as allies');

integratedStore.resetGame();
const liveFormulaSummon = integratedStore.spawnSummons('player', {
  id: 'live_formula', name: 'Live Formula', emoji: 'F', maxHp: 10,
  actions: [{ id: 'half_hp', name: 'Half HP', effectProgram: { spec: 'mwg.effect/v1', steps: [{
    op: 'damage', target: 'opponent', amount: { op: 'divide', left: { op: 'var', path: 'self.hp' }, right: 2 },
  }] } }],
}, 1).spawned[0];
assert.equal(summonIntentBadges(liveFormulaSummon, integratedStore.getGameState())[0].value, '5', 'a planned formula action previews its live summon HP');
integratedStore.damageSummons([liveFormulaSummon.instanceId], 4, true);
assert.equal(summonIntentBadges(integratedStore.getSummonById(liveFormulaSummon.instanceId), integratedStore.getGameState())[0].value, '3', 'the planned formula preview refreshes from current summon state without replanning');

integratedStore.resetGame();
integratedStore.setEnemies([{
  id: 'command_target', name: 'Command Target', emoji: 'T', maxHp: 20, currentHp: 20,
  maxLust: 100, currentLust: 0, energy: 0, maxEnergy: 0, block: 0,
  statusEffects: [], intent: { type: 'attack', description: '', emoji: '' }, actions: [], nextAction: null, dialogue: '',
}], 'command_target');
const commandedSummon = integratedStore.spawnSummons('player', {
  id: 'commanded_unit', name: 'Commanded Unit', emoji: 'C', maxHp: 8,
}, 1).spawned[0];
const plannedBeforeCommand = structuredClone(commandedSummon.plannedActionIds);
const commandProgram = core.compileCompactEffectList([{
  activate_summon: {
    selector: { owner: 'self', pick: 'by_id', id: commandedSummon.instanceId },
    action: { id: 'ordered_blast', name: 'Ordered Blast', effects: { damage: 6 } },
  },
}]);
assert.equal(commandProgram.ok, true, JSON.stringify(commandProgram.issues));
await integratedExecutor.executeEffectProgram(commandProgram.value, true);
assert.equal(integratedStore.getEnemy().currentHp, 14, 'the supplied action executes once through the selected summon');
const commandedEvent = integratedStore.getGameState().eventJournal.events.filter(event => event.kind === 'summon_acted').at(-1);
assert.equal(commandedEvent.actorId, commandedSummon.instanceId, 'the supplied action is attributed to the summoned unit');
assert.equal(commandedEvent.summonId, commandedSummon.instanceId);
assert.deepEqual(integratedStore.getSummonById(commandedSummon.instanceId).plannedActionIds, plannedBeforeCommand, 'a supplied one-off action does not replace the unit\'s normal planned intent');

console.log('Summon runtime queues preserve priority, skip defeated entries, journal actions, and keep owner perspective isolated.');
