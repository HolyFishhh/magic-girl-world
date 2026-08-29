import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { inspectBattleDataContract } = require(resolve('src/fish/core/battleDataContract.ts'));
const { preflightBattleContent } = require(resolve('src/fish/core/battleContentPreflight.ts'));
const { convertMvuCards, convertMvuEnemies } = require(resolve('src/fish/core/mvuBattleAdapter.ts'));
const { GameStateManager } = require(resolve('src/fish/core/gameStateManager.ts'));
const { BattleManager } = require(resolve('src/fish/combat/battleManager.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

const mvuEnemy = (id, hp = 12, extra = {}) => ({
  id,
  name: `敌人${id}`,
  emoji: '👾',
  hp,
  max_hp: hp,
  lust: 0,
  max_lust: 100,
  actions: [{ name: '攻击', weight: 1, effects: { damage: 3 } }],
  abilities: [],
  status_effects: [],
  lust_effect: { name: '失控', effects: { damage: 2 } },
  action_mode: 'random',
  action_config: {},
  ...extra,
});

const battle = {
  core: { emoji: '🧙', hp: 30, max_hp: 30, lust: 0, max_lust: 100 },
  cards: [{ id: 'strike', name: '打击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 10, effects: { damage: 6 } }],
  artifacts: [],
  items: [],
  statuses: [],
  player_status_effects: [],
  player_abilities: [],
  player_lust_effect: { name: '反击', effects: { damage: 3 } },
  enemies: [
    mvuEnemy('front', 10, { action_priority: 2, speed: 1, tags: ['minion'] }),
    mvuEnemy('back', 14, { action_priority: 1, speed: 4 }),
  ],
};

const inspected = inspectBattleDataContract({ stat_data: { battle } });
assert.equal(inspected.ok, true, inspected.ok ? '' : JSON.stringify(inspected.issue));
const duplicate = structuredClone(battle);
duplicate.enemies[1].id = 'front';
const duplicateResult = inspectBattleDataContract({ stat_data: { battle: duplicate } });
assert.equal(duplicateResult.ok, false);
assert.equal(duplicateResult.issue.path, 'battle.enemies[1].id');

const missingRosterId = structuredClone(battle);
delete missingRosterId.enemies[1].id;
const missingRosterIdResult = inspectBattleDataContract({ stat_data: { battle: missingRosterId } });
assert.equal(missingRosterIdResult.ok, false);
assert.equal(missingRosterIdResult.issue.path, 'battle.enemies[1].id');
assert.equal(missingRosterIdResult.issue.code, 'MISSING_VALUE');

const invalidRosterId = structuredClone(battle);
invalidRosterId.enemies[1].id = '敌人二';
const invalidRosterIdResult = inspectBattleDataContract({ stat_data: { battle: invalidRosterId } });
assert.equal(invalidRosterIdResult.ok, false);
assert.equal(invalidRosterIdResult.issue.path, 'battle.enemies[1].id');

const legacySingleEnemy = structuredClone(battle);
legacySingleEnemy.enemy = { ...legacySingleEnemy.enemies[0] };
delete legacySingleEnemy.enemy.id;
delete legacySingleEnemy.enemies;
assert.equal(inspectBattleDataContract({ stat_data: { battle: legacySingleEnemy } }).ok, true);
assert.equal(convertMvuEnemies([legacySingleEnemy.enemy], () => 0)[0].id, 'enemy_1');

const invalidSecond = structuredClone(battle);
invalidSecond.enemies[1].actions[0].effects = { unsupported_effect: 3 };
const invalidSecondResult = preflightBattleContent(invalidSecond);
assert.equal(invalidSecondResult.ok, false);
assert.ok(
  invalidSecondResult.issues.some(issue => issue.path.startsWith('battle.enemies[1].actions[0]')),
  JSON.stringify(invalidSecondResult.issues),
);

const validPreflight = preflightBattleContent(battle);
assert.equal(validPreflight.ok, true, JSON.stringify(validPreflight.issues));
const invalidOrbBattle = structuredClone(battle);
invalidOrbBattle.enemies[1].orb_slots = 1;
invalidOrbBattle.enemies[1].orbs = [
  { id: 'first', name: '一', value: 1 },
  { id: 'second', name: '二', value: 2 },
];
const invalidOrbResult = preflightBattleContent(invalidOrbBattle);
assert.equal(invalidOrbResult.ok, false);
assert.equal(invalidOrbResult.issues.some(issue => issue.code === 'ORB_SLOT_OVERFLOW'), true);
const converted = convertMvuEnemies(battle.enemies, () => 0);
assert.deepEqual(converted.map(enemy => enemy.id), ['front', 'back']);
assert.equal(converted[0].actionPriority, 2);
assert.deepEqual(converted[0].tags, ['minion']);
assert.equal(converted[1].speed, 4);

const state = core.createEmptyBattleState();
state.player.currentHp = 30;
state.player.maxHp = 30;
const store = new core.BattleStateStore(state);
store.setEnemies(converted, 'front');

// Each enemy resolves continuous rules against its own active alias. Resetting
// block must preserve one enemy without leaking that rule into its neighbors.
store.updateEnemyById('front', { block: 7 });
store.updateEnemyById('back', { block: 9 });
const originalGetExecutor = UnifiedEffectExecutor.getInstance;
UnifiedEffectExecutor.getInstance = () => ({
  getCardPlayRules: target => target === 'enemy' && store.getEnemy()?.id === 'front'
    ? [{ type: 'card_play_rule', target: 'self', rule: 'retain_block', extra: 0, priority: 0 }]
    : [],
});
try {
  const manager = Object.create(BattleManager.prototype);
  manager.gameStateManager = store;
  await manager.executeTurnFlowStep('enemy_block_reset');
} finally {
  UnifiedEffectExecutor.getInstance = originalGetExecutor;
}
assert.equal(store.getEnemyById('front').block, 7);
assert.equal(store.getEnemyById('back').block, 0);
assert.equal(store.getEnemy().id, 'front', 'the active target is restored after per-enemy rule resolution');

// Reset resources independently for each living enemy. Retained resources keep
// their value, dead enemies are skipped, and every extra enemy cycle refreshes
// the survivors before their next action.
{
  const resourceState = core.createEmptyBattleState();
  const resetResource = (id, current, max, refresh) => ({
    id, name: id, emoji: id[0], current, max, refresh,
  });
  const resourceEnemies = [
    { ...converted[0], id: 'front', currentHp: 10, energy: 0, maxEnergy: 2, resources: {
      charge: resetResource('charge', 0, 3, 'reset'),
      focus: resetResource('focus', 1, 4, 'retain'),
    } },
    { ...converted[1], id: 'back', currentHp: 14, energy: 0, maxEnergy: 4, resources: {
      charge: resetResource('charge', 0, 5, 'reset'),
      focus: resetResource('focus', 2, 4, 'retain'),
    } },
    { ...converted[1], id: 'dead', currentHp: 0, energy: 0, maxEnergy: 9, resources: {
      charge: resetResource('charge', 0, 9, 'reset'),
    } },
  ];
  const resourceStore = new core.BattleStateStore(resourceState);
  resourceStore.setEnemies(resourceEnemies, 'front');
  const resourceManager = Object.create(BattleManager.prototype);
  resourceManager.gameStateManager = resourceStore;
  const observed = [];
  let enemyExtraTurns = 1;
  await core.runBattleTurnFlow({
    isTerminal: () => false,
    beginEnemyTurn: () => resourceStore.beginEnemyTurn(),
    consumeExtraTurn: actor => {
      if (actor !== 'enemy' || enemyExtraTurns <= 0) return false;
      enemyExtraTurns -= 1;
      return true;
    },
    execute: async step => {
      if (step === 'enemy_resources_reset') await resourceManager.executeTurnFlowStep(step);
      if (step !== 'enemy_action') return;
      observed.push(resourceStore.getEnemies().map(enemy => ({
        id: enemy.id,
        hp: enemy.currentHp,
        energy: enemy.energy,
        charge: enemy.resources?.charge?.current,
        focus: enemy.resources?.focus?.current,
      })));
      for (const enemy of resourceStore.getEnemies({ livingOnly: true })) {
        resourceStore.updateEnemyById(enemy.id, {
          energy: 0,
          resources: {
            ...enemy.resources,
            charge: { ...enemy.resources.charge, current: 0 },
          },
        });
      }
      if (observed.length === 1) resourceStore.updateEnemyById('front', { currentHp: 0 });
    },
  });
  assert.deepEqual(observed[0], [
    { id: 'front', hp: 10, energy: 2, charge: 3, focus: 1 },
    { id: 'back', hp: 14, energy: 4, charge: 5, focus: 2 },
    { id: 'dead', hp: 0, energy: 0, charge: 0, focus: undefined },
  ]);
  assert.deepEqual(observed[1], [
    { id: 'front', hp: 0, energy: 0, charge: 0, focus: 1 },
    { id: 'back', hp: 14, energy: 4, charge: 5, focus: 2 },
    { id: 'dead', hp: 0, energy: 0, charge: 0, focus: undefined },
  ]);
}

// Resource target writes carry a stable enemy ID through by-id, all, random_n,
// and per-hit retargeting. Deliberately moving the active alias inside the
// callback must not redirect a write, and the previous active target is restored.
{
  const targetState = core.createEmptyBattleState();
  const resource = current => ({
    charge: { id: 'charge', name: 'Charge', emoji: 'C', current, max: 99, refresh: 'retain' },
  });
  const targetStore = new core.BattleStateStore(targetState);
  targetStore.setEnemies([
    { ...converted[0], id: 'anchor', currentHp: 10, resources: resource(0) },
    { ...converted[0], id: 'left', currentHp: 10, resources: resource(0) },
    { ...converted[1], id: 'middle', currentHp: 10, resources: resource(0) },
    { ...converted[1], id: 'right', currentHp: 10, resources: resource(0) },
  ], 'anchor');
  const targetExecutor = Object.create(UnifiedEffectExecutor.prototype);
  targetExecutor.gameStateManager = targetStore;
  targetExecutor.executionContext = { sourceIsPlayer: true };
  targetExecutor.pendingDeaths = new Set();
  targetExecutor.currentResolvedEnemyId = null;
  targetExecutor.getCardPlayRules = () => [];
  const targetLogs = [];
  targetExecutor.presentation = { addLog: message => targetLogs.push(message) };
  targetExecutor.battleEffectRuntime = new core.BattleEffectRuntime(targetStore, {
    readModifierSources: () => [],
    dispatchTriggers: async () => {},
    handleLustOverflow: async () => {},
  });
  const gain = amount => ({ type: 'gain_resource', target: 'opponent', resource: 'charge', amount });
  const runTargets = (selector, amount, afterWrite) => targetExecutor.forEachEnemyTarget(selector, async enemyId => {
    targetStore.setActiveEnemy('anchor');
    await targetExecutor.executeModernBattleCommand(gain(amount), true, enemyId);
    afterWrite?.(enemyId);
  });

  await runTargets({ mode: 'by_id', id: 'right' }, 1);
  assert.deepEqual(targetStore.getEnemies().map(enemy => enemy.resources.charge.current), [0, 0, 0, 1]);
  assert.equal(targetStore.getEnemy().id, 'anchor');

  await runTargets({ mode: 'all' }, 2, enemyId => {
    if (enemyId === 'middle') targetStore.updateEnemyById(enemyId, { currentHp: 0 });
  });
  assert.deepEqual(targetStore.getEnemies().map(enemy => enemy.resources.charge.current), [2, 2, 2, 3]);
  assert.equal(targetStore.getEnemy().id, 'anchor', 'group writes restore the previous active target after a death');

  const beforeRandom = targetStore.getEnemies().reduce((sum, enemy) => sum + enemy.resources.charge.current, 0);
  await runTargets({ mode: 'random_n', count: 2 }, 3);
  const afterRandom = targetStore.getEnemies().reduce((sum, enemy) => sum + enemy.resources.charge.current, 0);
  assert.equal(afterRandom - beforeRandom, 6, 'locked random_n writes to exactly two living enemies');

  const eachHitTargets = [];
  const beforeEachHit = targetStore.getEnemies().reduce((sum, enemy) => sum + enemy.resources.charge.current, 0);
  await runTargets({ mode: 'random_n', count: 2, retarget: 'each_hit' }, 4, enemyId => {
    eachHitTargets.push(enemyId);
  });
  const afterEachHit = targetStore.getEnemies().reduce((sum, enemy) => sum + enemy.resources.charge.current, 0);
  assert.equal(afterEachHit - beforeEachHit, 8);
  assert.equal(new Set(eachHitTargets).size, 2, 'each_hit does not repeat unless allowRepeat is enabled');
  assert.equal(targetStore.getEnemy().id, 'anchor');

  await runTargets({ mode: 'random_n', count: 5 }, 0);
  assert.equal(
    targetLogs.some(message => message.includes('目标数量不足：需要 5，实际 3')),
    true,
    'runtime exposes a deterministic target-shortage diagnostic instead of silently shrinking random_n',
  );

  targetExecutor.executionContext = { sourceIsPlayer: false, battleContext: { enemyId: 'anchor' } };
  await targetExecutor.forEachEnemyTarget({ mode: 'all' }, async enemyId => {
    await targetExecutor.executeModernBattleCommand({ type: 'gain_block', target: 'self', amount: 2 }, false, enemyId);
  });
  assert.deepEqual(
    targetStore.getEnemies().map(enemy => enemy.block),
    [2, 2, 0, 2],
    'enemy self + targets:all applies ally support to every living enemy and skips defeated allies',
  );
  assert.equal(targetStore.getEnemy().id, 'anchor');
}

{
  store.setActiveEnemy('back');
  const manager = Object.create(BattleManager.prototype);
  manager.gameStateManager = store;
  const acted = [];
  manager.prepareCurrentEnemyQueue = () => [
    { enemyId: 'front', order: 0, action: null },
    { enemyId: 'back', order: 1, action: null },
  ];
  manager.executeEnemyQueueEntry = async entry => {
    acted.push(entry.enemyId);
    store.setActiveEnemy(entry.enemyId);
    store.requestForceEndTurn('enemy');
  };
  await manager.executeEnemyTurnAction();
  assert.deepEqual(acted, ['front'], 'force-ending the enemy turn cancels the remaining stable multi-enemy queue');
  assert.equal(store.isForceEndTurnRequested('enemy'), false, 'the one-shot force-end request is consumed by the queue');
  assert.equal(store.getEnemy().id, 'back', 'the enemy action queue restores the player-selected living target');
}
store.setActiveEnemy('front');

// Exercise the Tavern coordinator without DOM dependencies. A lethal hit makes
// the legacy active alias advance immediately, so the executor must retain the
// original enemy ID for death processing and the event journal.
const executor = Object.create(UnifiedEffectExecutor.prototype);
executor.gameStateManager = store;
executor.executionContext = {
  sourceIsPlayer: true,
  cardContext: { id: 'finisher', name: '终结', type: 'Attack' },
};
executor.pendingDeaths = new Set();
executor.currentResolvedEnemyId = null;
executor.triggerHost = { processAbilitiesByTrigger: async () => {} };
executor.presentation = {
  addLog: () => {},
  showBlockAbsorption: () => {},
  showHealthChange: () => {},
  showLustChange: () => {},
  refreshPlayerEnergy: () => {},
};
executor.executionContext = {
  sourceIsPlayer: true,
  abilityContext: { id: 'retaliation_guard', name: '反击护体' },
};
executor.currentResolvedEnemyId = 'back';
executor.presentBattleEffectRuntimeEvent({
  type: 'damage_resolved', source: 'player', target: 'enemy', damageKind: 'retaliation',
  requested: 3, modified: 3, blocked: 0, hpLost: 3,
});
assert.equal(store.getGameState().eventJournal.lastDamage.targetId, 'back');
assert.equal(store.getGameState().eventJournal.lastDamage.damageKind, 'retaliation');
assert.equal(store.getGameState().eventJournal.lastDamage.cause.source.kind, 'ability');
assert.equal(store.getGameState().eventJournal.lastDamage.cause.source.id, 'retaliation_guard');
executor.executionContext = {
  sourceIsPlayer: true,
  cardContext: { id: 'finisher', name: '终结', type: 'Attack' },
};
executor.currentResolvedEnemyId = null;
let defeated = null;
executor.completeBattleEnd = async result => { defeated = result; };
executor.triggerHost = { processAbilitiesByTrigger: async () => {} };
executor.battleEffectRuntime = {
  execute: async (_command, options) => {
    const victim = store.getEnemy();
    assert.ok(victim);
    store.updateEnemyById(victim.id, { currentHp: 0 });
    executor.presentBattleEffectRuntimeEvent({
      type: 'damage_resolved',
      source: options.source,
      target: 'enemy',
      damageKind: options.damageKind,
      requested: victim.currentHp,
      modified: victim.currentHp,
      blocked: 0,
      hpLost: victim.currentHp,
    });
    return { applied: true, target: 'enemy', pendingDeath: true };
  },
};

await executor.executeModernBattleCommand({ type: 'damage', target: 'opponent', amount: 99 }, true);
assert.deepEqual([...executor.pendingDeaths], ['front']);
assert.equal(store.getGameState().eventJournal.lastDamage.targetId, 'front');
assert.equal(store.getGameState().eventJournal.lastDamage.fatal, true);
await executor.processPendingDeaths();
assert.deepEqual(store.getEnemies().map(enemy => enemy.id), ['back']);
assert.equal(store.getEnemy().id, 'back');
assert.equal(defeated, null, 'the battle continues while another enemy lives');

await executor.executeModernBattleCommand({ type: 'damage', target: 'opponent', amount: 99 }, true);
assert.deepEqual([...executor.pendingDeaths], ['back']);
assert.equal(store.getGameState().eventJournal.lastDamage.targetId, 'back');
await executor.processPendingDeaths();
assert.equal(store.getEnemies().length, 0);
assert.equal(defeated, 'victory', 'only the last enemy death ends the battle');

// A defeated passive may create several fully independent enemies before the
// dead owner is removed. The new roster prevents premature victory and every
// child keeps its own action list, desire effect, passive list, and unique ID.
{
  const child = {
    id: 'split_child', name: '分裂子体', emoji: '🧩', max_hp: 8, hp: 8,
    max_lust: 30, lust: 0, block: 1,
    actions: [{ name: '啃咬', weight: 1, effects: { damage: 2 } }],
    abilities: [{ id: 'shell', name: '甲壳', trigger: 'turn_start', effects: { block: 1 } }],
    status_effects: [], lust_effect: { name: '躁动', effects: { damage: 1 } },
    action_mode: 'random', action_config: {}, count: 2, capacity: 6,
  };
  const parent = mvuEnemy('split_parent', 5, {
    abilities: [{
      id: 'split_on_defeat', name: '分裂', trigger: 'defeated',
      effects: { spawn_enemy: child },
    }],
  });
  const [convertedParent] = convertMvuEnemies([parent], () => 0);
  assert.equal(convertedParent.abilities.length, 1);
  assert.equal(convertedParent.abilities[0].effectProgram.steps[0].op, 'spawn_enemy');

  const splitState = core.createEmptyBattleState();
  const splitStore = new core.BattleStateStore(splitState);
  splitStore.setEnemies([{ ...convertedParent, currentHp: 0 }], 'split_parent');
  const splitExecutor = Object.create(UnifiedEffectExecutor.prototype);
  splitExecutor.gameStateManager = splitStore;
  splitExecutor.pendingDeaths = new Set(['split_parent']);
  splitExecutor.executionContext = { sourceIsPlayer: false, battleContext: { enemyId: 'split_parent' } };
  splitExecutor.presentation = { addLog: () => {} };
  let splitOutcome = null;
  splitExecutor.completeBattleEnd = async result => { splitOutcome = result; };
  splitExecutor.triggerHost = {
    processAbilitiesByTrigger: async (_target, trigger, context) => {
      assert.equal(trigger, 'defeated');
      assert.equal(context.enemyId, 'split_parent');
      const ability = splitStore.getEnemyById(context.enemyId).abilities[0];
      await core.runEffectCommandProgram(ability.effectProgram, { spentEnergy: 0 }, {
        readState: () => ({
          self: { hp: 0, maxHp: 5, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
          opponent: { hp: 30, maxHp: 30, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
          currentTurn: 1, cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0,
        }),
        execute: command => {
          assert.equal(command.type, 'spawn_enemy');
          return splitExecutor.executeEnemyCommand(command, false);
        },
      });
    },
  };
  await splitExecutor.processPendingDeaths();
  const children = splitStore.getEnemies({ livingOnly: true });
  assert.equal(splitOutcome, null, 'spawned children keep the encounter alive');
  assert.equal(children.length, 2);
  assert.equal(new Set(children.map(enemy => enemy.id)).size, 2);
  assert.equal(children.every(enemy => enemy.actions.length === 1), true);
  assert.equal(children.every(enemy => enemy.abilities.length === 1), true);
  assert.equal(children.every(enemy => enemy.lustEffect?.name === '躁动'), true);
  assert.equal(children.every(enemy => enemy.block === 1), true);
  assert.deepEqual(splitStore.getGameState().defeatedEnemies.map(enemy => enemy.id), ['split_parent']);
}

// Exercise the complete Tavern effect/trigger pipeline for a lethal attack on a
// parent that first reacts to damage and then splits on defeat. This guards the
// exact ordering used by the real iframe instead of stubbing defeated triggers.
{
  const child = {
    id: 'pipeline_child', name: 'Pipeline child', emoji: 'c', max_hp: 8, hp: 8,
    max_lust: 30, lust: 0,
    actions: [{ name: 'Bite', weight: 1, effects: { damage: 2 } }],
    abilities: [], status_effects: [],
    lust_effect: { name: 'Surge', effects: { damage: 3 } },
    action_mode: 'random', action_config: {}, count: 2, capacity: 6,
  };
  const [parent] = convertMvuEnemies([mvuEnemy('pipeline_parent', 5, {
    abilities: [
      { id: 'reactive_shell', name: 'Reactive shell', trigger: 'take_damage', effects: { block: 2 } },
      { id: 'pipeline_split', name: 'Pipeline split', trigger: 'defeated', effects: { spawn_enemy: child } },
    ],
  })], () => 0);
  const [finisher] = convertMvuCards([{
    id: 'pipeline_finisher', name: 'Pipeline finisher', emoji: 'x', type: 'Attack', rarity: 'Common',
    cost: 0, quantity: 1, effects: { damage: 99 },
  }]);
  const manager = GameStateManager.getInstance();
  const pipelineState = core.createEmptyBattleState();
  pipelineState.player.currentHp = 30;
  pipelineState.player.maxHp = 30;
  manager.replaceState(pipelineState);
  manager.setEnemies([parent], parent.id);
  manager.setPhase('player_turn');
  const runtimeExecutor = UnifiedEffectExecutor.getInstance();
  runtimeExecutor.presentation = new Proxy({}, { get: () => () => undefined });
  let pipelineOutcome = null;
  runtimeExecutor.completeBattleEnd = async result => { pipelineOutcome = result; };
  await runtimeExecutor.executeEffectProgram(finisher.effectProgram, true, { cardContext: finisher });
  assert.equal(pipelineOutcome, null);
  assert.deepEqual(manager.getEnemies({ livingOnly: true }).map(enemy => enemy.name), ['Pipeline child', 'Pipeline child']);
  assert.deepEqual(manager.getGameState().defeatedEnemies.map(enemy => enemy.id), ['pipeline_parent']);

  // Once combat has started, an empty roster is authoritative and must never
  // fall back to the immutable MVU battle.enemy definition.
  manager.setEnemies([], null);
  assert.equal(manager.getEnemy(), null, 'an active battle never resurrects an MVU enemy after the roster becomes empty');
}

console.log('Multi-enemy MVU, preflight paths, conversion, lethal target identity, death removal, and final victory integrate correctly.');
