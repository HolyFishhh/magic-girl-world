import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const storageModule = require(resolve('src/fish/core/battleSessionStore.ts'));
const session = { ...core, ...storageModule };

const clone = value => structuredClone(value);
let variables = {
  [session.BATTLE_SESSION_NAMESPACE]: {
    uiPreferences: { compact: true },
  },
};
const storage = {
  read: () => clone(variables),
  update: async updater => {
    variables = await updater(clone(variables));
    return clone(variables);
  },
};

const battleA = {
  core: { hp: 80, max_hp: 80 },
  cards: [{ id: 'strike', quantity: 4 }],
  enemy: { name: 'Training Dummy', hp: 60 },
};
const battleB = { ...battleA, enemy: { ...battleA.enemy, hp: 52 } };
const effectProgram = {
  spec: 'mwg.effect/v1',
  steps: [{ op: 'gain_block', target: 'self', amount: 1 }],
};
const runtimeCard = (id, extra = {}) => ({ id, effectProgram, ...extra });
const state = {
  player: {
    maxHp: 80,
    currentHp: 80,
    maxLust: 100,
    currentLust: 0,
    energy: 3,
    maxEnergy: 3,
    resources: {
      stars: { id: 'stars', name: '星能', emoji: '⭐', current: 2, max: 5, refresh: 'retain' },
    },
    block: 0,
    deck: [runtimeCard('strike_1')],
    hand: [runtimeCard('strike_1')],
    drawPile: [],
    discardPile: [],
    exhaustPile: [],
    statusEffects: [],
    relics: [],
    drawPerTurn: 5,
  },
  enemy: {
    id: 'training_dummy',
    name: 'Training Dummy',
    maxHp: 60,
    currentHp: 60,
    maxLust: 100,
    currentLust: 0,
    energy: 0,
    maxEnergy: 0,
    resources: {
      rage: { id: 'rage', name: '怒气', emoji: '🔥', current: 1, max: 4, refresh: 'reset' },
    },
    block: 0,
    statusEffects: [],
    actions: [],
    lustEffect: { id: 'enemy_lust', name: 'Enemy lust', effectProgram },
  },
  currentTurn: 1,
  cardsPlayedThisTurn: 0,
  attacksPlayedThisTurn: 0,
  skillsPlayedThisTurn: 0,
  phase: 'player_turn',
  isGameOver: false,
  battleResult: 'ongoing',
  battleNarrative: '',
  battle: { player_lust_effect: { id: 'player_lust', name: 'Player lust', effectProgram } },
  random: { schemaVersion: 1, seed: 1234, cursor: 9 },
};

const towerAwaiting = session.createRunState({ seed: 1 });
const towerOpeningChoice = towerAwaiting.choices[0];
const towerAfterOpening = session.completeRunNode(
  session.enterRunNode(towerAwaiting, towerOpeningChoice.id),
  { outcome: 'cleared' },
);
const towerChoice = towerAfterOpening.choices.find(choice => session.isBattleRunNode(choice.kind));
assert.ok(towerChoice, 'the route after the opening reward must expose a battle node');
const towerActiveRun = session.enterRunNode(towerAfterOpening, towerChoice.id);
const towerState = clone(state);
towerState.battleRequest = {
  route: { nodeId: towerChoice.id },
};

const store = new session.BattleSessionStore(storage, 1);
assert.equal(store.prepare(storage.read(), battleA), null);
store.enable();
await store.flush(state);

assert.deepEqual(variables[session.BATTLE_SESSION_NAMESPACE].uiPreferences, { compact: true });
const saved = session.readBattleSessionSnapshot(variables);
assert.ok(saved);
assert.equal(saved.state.currentTurn, 1);
assert.deepEqual(saved.state.random, { schemaVersion: 1, seed: 1234, cursor: 9 });
assert.equal(saved.state.player.resources.stars.current, 2);
assert.equal(saved.state.enemy.resources.rage.refresh, 'reset');

const corruptResourceVariables = clone(variables);
corruptResourceVariables[session.BATTLE_SESSION_NAMESPACE][session.BATTLE_SESSION_KEY].state.player.resources.stars.current = 9;
assert.equal(session.readBattleSessionSnapshot(corruptResourceVariables), null, 'corrupt resource pools must not restore');

const restore = store.prepare(storage.read(), battleA);
assert.deepEqual(restore, state);
assert.equal(store.wasRestored(), true);
assert.deepEqual(restore.random, { schemaVersion: 1, seed: 1234, cursor: 9 });
restore.currentTurn = 99;
assert.equal(saved.state.currentTurn, 1, 'restored state must not retain a message-variable reference');
store.finishRestore();

const partialMultiEnemyState = clone(state);
const defeatedEnemy = clone(state.enemy);
defeatedEnemy.currentHp = 0;
defeatedEnemy.block = 0;
const survivingEnemy = {
  ...clone(state.enemy),
  id: 'training_dummy_reinforcement',
  name: 'Training Dummy Reinforcement',
  currentHp: 41,
  block: 2,
};
partialMultiEnemyState.currentTurn = 2;
partialMultiEnemyState.enemy = clone(survivingEnemy);
partialMultiEnemyState.enemies = [clone(survivingEnemy)];
partialMultiEnemyState.defeatedEnemies = [defeatedEnemy];
partialMultiEnemyState.activeEnemyId = survivingEnemy.id;
await store.flush(partialMultiEnemyState);
const partialMultiEnemySnapshot = session.readBattleSessionSnapshot(variables);
assert.ok(partialMultiEnemySnapshot, 'a snapshot with one defeated enemy must remain valid');
assert.deepEqual(partialMultiEnemySnapshot.state.enemies.map(enemy => enemy.id), [survivingEnemy.id]);
assert.deepEqual(partialMultiEnemySnapshot.state.defeatedEnemies.map(enemy => enemy.id), [defeatedEnemy.id]);
const partialMultiEnemyRestore = store.prepare(storage.read(), battleA);
assert.equal(partialMultiEnemyRestore.currentTurn, 2);
assert.equal(partialMultiEnemyRestore.activeEnemyId, survivingEnemy.id);
assert.equal(partialMultiEnemyRestore.enemy.id, survivingEnemy.id);
assert.deepEqual(partialMultiEnemyRestore.enemies.map(enemy => enemy.id), [survivingEnemy.id]);
assert.deepEqual(partialMultiEnemyRestore.defeatedEnemies.map(enemy => enemy.id), [defeatedEnemy.id]);
store.finishRestore();

// Mid-combat refresh must preserve every recently added runtime container,
// including reinforced enemies and summon-local behaviour/state. Enemy and
// summon action queues are rebuilt deterministically from these persisted
// definitions after the current atomic action finishes.
const richRuntimeState = clone(partialMultiEnemyState);
richRuntimeState.enemies[0].statusEffects = [
  { id: 'armor_mark', name: '甲印', emoji: '◆', description: '保留状态', type: 'buff', stacks: 2 },
];
richRuntimeState.enemies[0].abilities = [
  { id: 'rage_start', name: '怒意启动', trigger: 'turn_start', effectProgram },
];
richRuntimeState.enemies[0].actions = [
  { id: 'reinforced_hit', name: '增援重击', weight: 2, effectProgram },
];
richRuntimeState.enemies[0].resources.rage.current = 3;
richRuntimeState.player.stance = {
  id: 'guard_stance', name: '守势', emoji: '🛡️', enteredTurn: 2,
  passiveEffects: [{ op: 'gain_block', target: 'self', amount: 1 }],
};
richRuntimeState.player.orbs = {
  slots: 2,
  orbs: [{
    instanceId: 'spark_orb:1', id: 'spark_orb', name: '火花球', emoji: '⚡', value: 4,
    passiveEffects: [{ op: 'damage', target: 'opponent', amount: 2 }],
    evokeEffects: [{ op: 'damage', target: 'opponent', amount: 5 }],
  }],
};
const summonDefinition = {
  id: 'clock_guard', name: '发条护卫', emoji: '⚙️', maxHp: 12, block: 3,
  statusEffects: [{ id: 'summon_charge', name: '蓄力', emoji: '◆', description: '召唤状态', type: 'buff', stacks: 2 }],
  resources: { charge: { id: 'charge', name: '充能', emoji: '⚡', current: 2, max: 4, refresh: 'retain' } },
  actions: [{ id: 'clock_hit', name: '齿轮冲撞', weight: 1, effectProgram }],
  abilities: [{ id: 'clock_guard_start', name: '护卫启动', trigger: 'turn_start', effectProgram }],
  actionsPerActivation: 2, actionPriority: 3, speed: 4,
  intercept: { mode: 'unblocked_attack', priority: 2, maxPerTurn: 1 },
};
richRuntimeState.summons = core.spawnSummonUnits(
  core.createSummonCollectionState(), 'player', summonDefinition, 1, 3, 'replace_oldest', 2,
).state;
richRuntimeState.summons.living[0].currentHp = 7;
richRuntimeState.summons.living[0].interceptionsThisTurn = 1;
richRuntimeState.effectScheduler = core.scheduleEffect(core.createEffectSchedulerState(), {
  source: { kind: 'card', id: 'delayed_guard', name: '延迟护盾' },
  owner: 'player', createdTurn: 2, dueTurn: 3, phase: 'turn_start', priority: 1,
  payload: { type: 'effect_program', program: effectProgram, sourceIsPlayer: true },
}).state;
richRuntimeState.turnControl = { extraPlayerTurns: 1, extraEnemyTurns: 0, forceEndPlayer: false, forceEndEnemy: false };
await store.flush(richRuntimeState);
const richSnapshot = session.readBattleSessionSnapshot(variables);
assert.ok(richSnapshot, 'rich runtime state must remain restorable');
const normalizedRich = new core.BattleStateStore(richSnapshot.state).getGameState();
assert.equal(normalizedRich.enemies[0].actions[0].id, 'reinforced_hit');
assert.equal(normalizedRich.enemies[0].abilities[0].id, 'rage_start');
assert.equal(normalizedRich.enemies[0].statusEffects[0].stacks, 2);
assert.equal(normalizedRich.enemies[0].resources.rage.current, 3);
assert.equal(normalizedRich.player.stance.id, 'guard_stance');
assert.equal(normalizedRich.player.orbs.orbs[0].instanceId, 'spark_orb:1');
assert.equal(normalizedRich.summons.living[0].instanceId, 'clock_guard__summon__1');
assert.equal(normalizedRich.summons.living[0].currentHp, 7);
assert.equal(normalizedRich.summons.living[0].block, 3);
assert.equal(normalizedRich.summons.living[0].statusEffects[0].id, 'summon_charge');
assert.equal(normalizedRich.summons.living[0].abilities[0].id, 'clock_guard_start');
assert.equal(normalizedRich.summons.living[0].resources.charge.current, 2);
assert.equal(normalizedRich.summons.living[0].interceptionsThisTurn, 1);
assert.equal(normalizedRich.effectScheduler.queue[0].id, 'schedule:delayed_guard:1');
assert.equal(normalizedRich.turnControl.extraPlayerTurns, 1);
store.finishRestore();

const playedInnateState = clone(state);
playedInnateState.player.energy = 2;
playedInnateState.player.hand = [
  runtimeCard('innate_guard__1', { originalId: 'innate_guard', innate: true }),
  runtimeCard('normal_guard__1', { originalId: 'normal_guard' }),
  runtimeCard('normal_strike__4', { originalId: 'normal_strike' }),
  runtimeCard('normal_guard__4', { originalId: 'normal_guard' }),
];
playedInnateState.player.drawPile = [
  runtimeCard('normal_strike__1', { originalId: 'normal_strike' }),
  runtimeCard('normal_guard__2', { originalId: 'normal_guard' }),
  runtimeCard('normal_strike__2', { originalId: 'normal_strike' }),
  runtimeCard('normal_guard__3', { originalId: 'normal_guard' }),
  runtimeCard('normal_strike__3', { originalId: 'normal_strike' }),
];
playedInnateState.player.discardPile = [
  runtimeCard('innate_strike__1', { originalId: 'innate_strike', innate: true }),
];
playedInnateState.enemy.currentHp = 53;
playedInnateState.cardsPlayedThisTurn = 1;
playedInnateState.random = { schemaVersion: 1, seed: 2613270615, cursor: 8 };
await store.flush(playedInnateState);
const playedInnateRestore = store.prepare(storage.read(), battleA);
assert.equal(playedInnateRestore.player.energy, 2);
assert.equal(playedInnateRestore.enemy.currentHp, 53);
assert.equal(playedInnateRestore.cardsPlayedThisTurn, 1);
assert.deepEqual(playedInnateRestore.random, { schemaVersion: 1, seed: 2613270615, cursor: 8 });
assert.deepEqual(
  playedInnateRestore.player.hand.map(card => card.id),
  ['innate_guard__1', 'normal_guard__1', 'normal_strike__4', 'normal_guard__4'],
);
assert.deepEqual(playedInnateRestore.player.discardPile.map(card => card.id), ['innate_strike__1']);
store.finishRestore();

const interruptedVariables = {};
const interruptedStorage = {
  read: () => clone(interruptedVariables),
  update: async updater => Object.assign(interruptedVariables, await updater(clone(interruptedVariables))),
};
const interruptedStore = new session.BattleSessionStore(interruptedStorage, 1);
interruptedStore.prepare(interruptedStorage.read(), battleA);
interruptedStore.enable();
const interruptedState = clone(state);
interruptedState.phase = 'enemy_turn';
interruptedState.currentTurn = 7;
interruptedState.player.currentHp = 37;
await interruptedStore.flush(interruptedState);
const interruptedRestore = interruptedStore.prepare(interruptedStorage.read(), battleA);
assert.equal(interruptedRestore.phase, 'player_turn');
assert.equal(interruptedRestore.currentTurn, 7);
assert.equal(interruptedRestore.player.currentHp, 37);
assert.equal(interruptedRestore.isGameOver, false);

const preTransaction = clone(state);
preTransaction.player.currentHp = 80;
await store.flush(preTransaction);
store.suspend();
store.suspend();
const partialTransaction = clone(preTransaction);
partialTransaction.player.currentHp = 1;
store.schedule(partialTransaction);
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(
  session.readBattleSessionSnapshot(variables).state.player.currentHp,
  80,
  'a suspended transaction must not persist an intermediate battle state',
);
store.resume(partialTransaction);
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(
  session.readBattleSessionSnapshot(variables).state.player.currentHp,
  80,
  'nested transactions must remain suspended until the outermost transaction finishes',
);
const committedTransaction = clone(preTransaction);
committedTransaction.player.currentHp = 64;
store.resume(committedTransaction);
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(
  session.readBattleSessionSnapshot(variables).state.player.currentHp,
  64,
  'the outermost transaction must persist its committed state',
);

const stale = store.prepare(storage.read(), battleB);
assert.equal(stale, null);
assert.equal(store.wasRestored(), false);

const corruptVariables = clone(variables);
corruptVariables[session.BATTLE_SESSION_NAMESPACE][session.BATTLE_SESSION_KEY].state.player.currentHp = '64';
const corruptStorage = {
  read: () => clone(corruptVariables),
  update: async updater => updater(clone(corruptVariables)),
};
const corruptStore = new session.BattleSessionStore(corruptStorage, 1);
assert.equal(corruptStore.prepare(corruptStorage.read(), battleA), null);
assert.equal(corruptStore.wasRestored(), false);

const isolatedVariables = {};
const isolatedStorage = {
  read: () => clone(isolatedVariables),
  update: async updater => Object.assign(isolatedVariables, await updater(clone(isolatedVariables))),
};
const generationStore = new session.BattleSessionStore(isolatedStorage, 1);
generationStore.prepare(isolatedStorage.read(), battleA);
generationStore.enable();
const obsoleteSave = generationStore.flush(state);
generationStore.prepare(isolatedStorage.read(), battleB);
await obsoleteSave;
assert.equal(
  session.readBattleSessionSnapshot(isolatedVariables),
  null,
  'a queued save from an older battle generation must not write after the MUV input changes',
);

let towerVariables = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    run: towerActiveRun,
  },
};
const archivedTurn = session.appendBattleEvent(session.createBattleEventJournal(), {
  turn: 1,
  phase: 'after',
  kind: 'turn_ended',
  cause: { source: { kind: 'system', id: 'turn' } },
  actorId: 'player',
});
assert.equal(archivedTurn.ok, true);
const towerRunHistory = session.archiveBattleJournalInRun(
  session.createRunEventHistory(),
  'previous-battle',
  archivedTurn.state,
);
towerVariables.stat_data.run_event_history = towerRunHistory;
towerState.eventJournal = session.attachRunEventHistory(
  session.createBattleEventJournal(),
  towerRunHistory,
);
const towerStorage = {
  read: () => clone(towerVariables),
  update: async updater => {
    towerVariables = await updater(clone(towerVariables));
    return clone(towerVariables);
  },
};
const towerStore = new session.BattleSessionStore(towerStorage, 1);
towerStore.prepare(towerStorage.read(), battleA);
towerStore.enable();
await towerStore.flush(towerState);
assert.equal(session.readBattleSessionSnapshot(towerVariables).state.currentTurn, 1);
assert.equal(
  session.readBattleSessionSnapshot(towerVariables).state.eventJournal.runHistory,
  undefined,
  'the rapid battle snapshot must not duplicate run-owned history',
);
assert.deepEqual(
  towerVariables.stat_data.run_event_history,
  towerRunHistory,
  'stripping the snapshot copy must not mutate the canonical run history',
);

const savedTowerSnapshot = clone(session.readBattleSessionSnapshot(towerVariables));
towerVariables.stat_data.run = {
  ...towerVariables.stat_data.run,
  phase: 'awaiting_choice',
  act: 3,
  floor: 15,
  currentNode: null,
  choices: [{ id: 'act-3-boss', kind: 'boss', act: 3, floor: 16, danger: 3, column: 3 }],
  stateRevision: 98,
};
const staleTowerState = clone(towerState);
staleTowerState.player.currentHp = 1;
await towerStore.flush(staleTowerState);
assert.deepEqual(
  session.readBattleSessionSnapshot(towerVariables),
  savedTowerSnapshot,
  'a completed tower node must reject late session writes from its old battle view',
);
assert.equal(
  towerStore.prepare(towerStorage.read(), battleA),
  null,
  'a completed tower node must not restore its old battle session',
);

let failNextUpdate = false;
let clearFailureVariables = {};
const clearFailureStorage = {
  read: () => clone(clearFailureVariables),
  update: async updater => {
    if (failNextUpdate) {
      failNextUpdate = false;
      throw new Error('storage unavailable');
    }
    clearFailureVariables = await updater(clone(clearFailureVariables));
    return clone(clearFailureVariables);
  },
};
const clearFailureStore = new session.BattleSessionStore(clearFailureStorage, 1);
clearFailureStore.prepare(clearFailureStorage.read(), battleA);
clearFailureStore.enable();
await clearFailureStore.flush(state);
failNextUpdate = true;
await assert.rejects(clearFailureStore.clear(), /storage unavailable/);
const stateAfterFailedClear = clone(state);
stateAfterFailedClear.player.currentHp = 55;
await clearFailureStore.flush(stateAfterFailedClear);
assert.equal(
  session.readBattleSessionSnapshot(clearFailureVariables).state.player.currentHp,
  55,
  'a failed clear must leave the in-memory store enabled for retry or rollback',
);

await store.clear();
assert.equal(session.readBattleSessionSnapshot(variables), null);
assert.deepEqual(
  variables[session.BATTLE_SESSION_NAMESPACE],
  { uiPreferences: { compact: true } },
  'clearing a battle must preserve sibling data in the project namespace',
);

console.log('Battle session store lifecycle passed.');
