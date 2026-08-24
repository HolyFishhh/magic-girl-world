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

const store = new session.BattleSessionStore(storage, 1);
assert.equal(store.prepare(storage.read(), battleA), null);
store.enable();
await store.flush(state);

assert.deepEqual(variables[session.BATTLE_SESSION_NAMESPACE].uiPreferences, { compact: true });
const saved = session.readBattleSessionSnapshot(variables);
assert.ok(saved);
assert.equal(saved.state.currentTurn, 1);
assert.deepEqual(saved.state.random, { schemaVersion: 1, seed: 1234, cursor: 9 });

const restore = store.prepare(storage.read(), battleA);
assert.deepEqual(restore, state);
assert.equal(store.wasRestored(), true);
assert.deepEqual(restore.random, { schemaVersion: 1, seed: 1234, cursor: 9 });
restore.currentTurn = 99;
assert.equal(saved.state.currentTurn, 1, 'restored state must not retain a message-variable reference');
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
