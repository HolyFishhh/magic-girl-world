import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

function card(id, name = id) {
  return {
    id,
    originalId: id.split('#')[0],
    name,
    cost: 1,
    type: 'Skill',
    rarity: 'Common',
    emoji: 'C',
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] },
    description: 'Gain 1 block.',
  };
}

const store = new core.BattleStateStore();
assert.equal(store.getCurrentPhase(), 'setup');
assert.equal(store.getPlayer().currentHp, 80);
assert.equal(store.getEnemy(), null);

const changed = [];
const unsubscribe = store.addEventListener('state_changed', state => changed.push(state.phase));
store.updatePlayer({ currentHp: 61, modifiers: { draw: 2, damage: 3 } });
store.setEnemy({
  id: 'enemy',
  name: 'Fixture',
  maxHp: 20,
  currentHp: 20,
  maxLust: 100,
  currentLust: 0,
  energy: 0,
  maxEnergy: 0,
  block: 0,
  statusEffects: [],
  intent: { type: 'attack', description: 'Attack', emoji: 'A' },
  emoji: 'E',
  actions: [],
  nextAction: null,
  dialogue: '',
  modifiers: { discard: 1, armor: 2 },
});
store.setPhase('player_turn');
assert.equal(store.getPlayer().currentHp, 61);
assert.equal(store.getEnemy().name, 'Fixture');

store.addStatusEffect('player', {
  id: 'focus',
  name: 'Focus',
  type: 'buff',
  stacks: 2,
  duration: 1,
  description: '',
  emoji: 'F',
});
store.addStatusEffect('player', {
  id: 'focus',
  name: 'Focus',
  type: 'buff',
  stacks: 3,
  duration: 2,
  description: '',
  emoji: 'F',
});
assert.deepEqual(store.getPlayer().statusEffects.map(({ id, stacks, duration }) => ({ id, stacks, duration })), [
  { id: 'focus', stacks: 5, duration: 2 },
]);

store.updatePlayer({
  hand: [card('hand')],
  drawPile: [card('draw-a'), card('draw-b'), card('draw-c')],
  discardPile: [card('discard')],
  exhaustPile: [card('exhaust')],
});
assert.deepEqual(store.recoverOwnedCards(['discard'], 'discard').map(entry => entry.id), ['discard']);
assert.deepEqual(store.moveOwnedCardsToExhaust(['hand']).map(entry => entry.id), ['hand']);
assert.deepEqual(store.scryOwnedCards(2, ['draw-c']).map(entry => entry.id), ['draw-c']);
assert.deepEqual(store.readCardZoneState(), {
  hand: [card('discard')],
  drawPile: [card('draw-a'), card('draw-b')],
  discardPile: [card('draw-c')],
  exhaustPile: [card('exhaust'), card('hand')],
});

const firstRandom = new core.BattleStateStore({
  ...core.createEmptyBattleState(),
  random: core.createBattleRandomState(451),
});
const secondRandom = new core.BattleStateStore({
  ...core.createEmptyBattleState(),
  random: core.createBattleRandomState(451),
});
assert.deepEqual(
  [firstRandom.nextRandom(), firstRandom.nextRandom(), firstRandom.nextRandom()],
  [secondRandom.nextRandom(), secondRandom.nextRandom(), secondRandom.nextRandom()],
);
assert.equal(firstRandom.getGameState().random.cursor, 3);

store.recordPersistentGrowth({ stat: 'max_hp', operator: 'add', value: 6 });
assert.equal(store.getGameState().persistentGrowth?.[0]?.stat, 'max_hp');
assert.equal(typeof store.getGameState().persistentGrowth?.[0]?.id, 'string');
const growthReload = JSON.parse(JSON.stringify(store.getGameState()));
store.replaceState(growthReload);
assert.deepEqual(store.getGameState().persistentGrowth, growthReload.persistentGrowth, 'the explicit growth ledger survives a runtime reload');

const growthEntry = { stat: 'max_hp', operator: 'add', value: 2 };
const replayA = new core.BattleStateStore(growthReload);
const replayB = new core.BattleStateStore(JSON.parse(JSON.stringify(growthReload)));
const randomBeforeGrowth = structuredClone(replayA.getGameState().random);
replayA.createSnapshot('before_growth');
replayA.recordPersistentGrowth(growthEntry);
replayB.recordPersistentGrowth(growthEntry);
const expectedGrowth = structuredClone(replayA.getGameState().persistentGrowth);
assert.deepEqual(replayB.getGameState().persistentGrowth, expectedGrowth, 'the same saved state and operation produce identical receipt IDs');
assert.equal(new Set(expectedGrowth.map(entry => entry.id)).size, expectedGrowth.length, 'new growth never reuses a restored receipt');
assert.deepEqual(replayA.getGameState().random, randomBeforeGrowth, 'receipt allocation never consumes gameplay randomness');
assert.equal(replayA.restoreSnapshot('before_growth'), true);
replayA.recordPersistentGrowth(growthEntry);
assert.deepEqual(replayA.getGameState().persistentGrowth, expectedGrowth, 'rolling back and retrying growth preserves deterministic receipts');

const encounterA = new core.BattleStateStore(undefined, { persistentGrowthNonce: () => 'encounter_a' });
const encounterB = new core.BattleStateStore(undefined, { persistentGrowthNonce: () => 'encounter_b' });
encounterA.recordPersistentGrowth(growthEntry);
encounterB.recordPersistentGrowth(growthEntry);
assert.notEqual(encounterA.getGameState().persistentGrowth[0].id, encounterB.getGameState().persistentGrowth[0].id, 'the host can distinguish independent encounters even with the same battle seed');
const hostReload = new core.BattleStateStore(JSON.parse(JSON.stringify(encounterA.getGameState())), { persistentGrowthNonce: () => 'encounter_b' });
assert.deepEqual(hostReload.getGameState().persistentGrowth, encounterA.getGameState().persistentGrowth, 'a changed host namespace never rewrites saved receipts');

store.setCardPlayCounters({ cardsPlayedThisTurn: 4, attacksPlayedThisTurn: 2, skillsPlayedThisTurn: 2 });
const summonProgram = { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 2 }] };
const summoned = store.spawnSummons('player', {
  id: 'guard_unit', name: 'Guard unit', emoji: 'G', maxHp: 6,
  actionProgram: summonProgram, actionsPerActivation: 1,
  intercept: { mode: 'unblocked_attack' },
}, 1);
assert.equal(summoned.spawned.length, 1);
assert.equal(store.getSummonActionQueue('player').length, 1);
store.createSnapshot('action');
store.updatePlayer({ currentHp: 1 });
store.damageSummons([summoned.spawned[0].instanceId], 99);
store.beginEnemyTurn();
store.incrementTurn();
assert.equal(store.restoreSnapshot('action'), true);
assert.equal(store.getPlayer().currentHp, 61);
assert.equal(store.getCurrentPhase(), 'player_turn');
assert.equal(store.getGameState().currentTurn, 0);
assert.equal(store.getSummons('player').length, 1, 'summon entities must roll back with the battle snapshot');
assert.equal(store.deleteSnapshot('action'), true);
assert.equal(store.restoreSnapshot('action'), false);

store.clearTemporaryModifiers();
assert.deepEqual(store.getPlayer().modifiers, { damage: 3 });
assert.deepEqual(store.getEnemy().modifiers, { armor: 2 });
store.setBattleOutcome('terminated', 'done');
assert.equal(store.isGameOver(), true);
assert.equal(store.getGameState().battleResult, 'terminated');
assert.equal(store.getGameState().battleNarrative, 'done');

unsubscribe();
const changeCount = changed.length;
store.resetGame();
assert.equal(changed.length, changeCount);
assert.equal(store.getCurrentPhase(), 'setup');
assert.deepEqual(store.getGameState().persistentGrowth, [], 'a new combat never inherits the prior combat growth ledger');

const source = core.createEmptyBattleState();
const replaced = new core.BattleStateStore();
replaced.replaceState(source);
source.player.currentHp = 1;
assert.equal(replaced.getPlayer().currentHp, 80, 'replaceState must detach external host data');

console.log('Portable BattleStateStore owns deterministic state, zones, turns, listeners, and rollback without Tavern.');
