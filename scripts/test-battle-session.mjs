import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const storage = require(resolve('src/fish/core/battleSessionStore.ts'));
const session = { ...core, ...storage };

const battleA = {
  enemy: { name: 'Training Dummy', hp: 60 },
  cards: [{ id: 'strike', quantity: 4 }],
  core: { hp: 80, max_hp: 80 },
};
const battleAReordered = {
  core: { max_hp: 80, hp: 80 },
  cards: [{ quantity: 4, id: 'strike' }],
  enemy: { hp: 60, name: 'Training Dummy' },
};
const battleB = { ...battleA, enemy: { ...battleA.enemy, hp: 52 } };

assert.equal(
  session.createBattleFingerprint(battleA),
  session.createBattleFingerprint(battleAReordered),
  'object key order must not change the battle identity',
);
assert.notEqual(
  session.createBattleFingerprint(battleA),
  session.createBattleFingerprint(battleB),
  'an edited MUV battle must invalidate the saved session',
);

const state = {
  player: {
    maxHp: 80,
    currentHp: 80,
    maxLust: 100,
    currentLust: 0,
    energy: 3,
    maxEnergy: 3,
    block: 0,
    deck: [{ id: 'strike_1', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 6 }] } }],
    hand: [{ id: 'strike_1', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 6 }] } }],
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
    currentHp: 52,
    maxLust: 100,
    currentLust: 0,
    energy: 0,
    maxEnergy: 0,
    block: 0,
    statusEffects: [],
    actions: [],
    lustEffect: {
      name: '反噬',
      description: '造成1点伤害。',
      effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 1 }] },
    },
  },
  currentTurn: 2,
  cardsPlayedThisTurn: 1,
  attacksPlayedThisTurn: 1,
  skillsPlayedThisTurn: 0,
  phase: 'player_turn',
  isGameOver: false,
  battleResult: 'ongoing',
  battleNarrative: '',
  battle: {
    player_lust_effect: {
      name: '反击',
      description: '造成1点伤害。',
      effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 1 }] },
    },
  },
};
const fingerprint = session.createBattleFingerprint(battleA);
const snapshot = session.createBattleSessionSnapshot(fingerprint, state, 1234);
const variables = {
  [session.BATTLE_SESSION_NAMESPACE]: {
    [session.BATTLE_SESSION_KEY]: snapshot,
  },
};

assert.deepEqual(session.readBattleSessionSnapshot(variables), snapshot);
assert.equal(session.canRestoreBattleSession(snapshot, fingerprint), true);
assert.equal(session.canRestoreBattleSession(snapshot, session.createBattleFingerprint(battleB)), false);

const incompleteCounterSnapshot = structuredClone(snapshot);
delete incompleteCounterSnapshot.state.attacksPlayedThisTurn;
delete incompleteCounterSnapshot.state.skillsPlayedThisTurn;
assert.equal(
  session.readBattleSessionSnapshot({
    [session.BATTLE_SESSION_NAMESPACE]: { [session.BATTLE_SESSION_KEY]: incompleteCounterSnapshot },
  }),
  null,
  'snapshots missing current counters must be rejected',
);

state.player.hand[0].id = 'mutated_after_save';
assert.equal(snapshot.state.player.hand[0].id, 'strike_1', 'snapshots must not retain live state references');
assert.equal(session.readBattleSessionSnapshot({}), null);
assert.equal(
  session.readBattleSessionSnapshot({
    [session.BATTLE_SESSION_NAMESPACE]: {
      [session.BATTLE_SESSION_KEY]: { ...snapshot, schemaVersion: 999 },
    },
  }),
  null,
);
assert.equal(
  session.readBattleSessionSnapshot({
    [session.BATTLE_SESSION_NAMESPACE]: {
      [session.BATTLE_SESSION_KEY]: {
        ...snapshot,
        state: {
          ...snapshot.state,
          player: { ...snapshot.state.player, currentHp: '52' },
        },
      },
    },
  }),
  null,
  'runtime combat numbers must never be restored from strings',
);
assert.equal(
  session.readBattleSessionSnapshot({
    [session.BATTLE_SESSION_NAMESPACE]: {
      [session.BATTLE_SESSION_KEY]: {
        ...snapshot,
        state: { ...snapshot.state, battleResult: 'unknown' },
      },
    },
  }),
  null,
);
const programSnapshot = session.createBattleSessionSnapshot(
  fingerprint,
  {
    ...snapshot.state,
    player: {
      ...snapshot.state.player,
      hand: [
        {
          id: 'program_card',
          effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] },
        },
      ],
    },
  },
  1235,
);
assert.equal(
  session.readBattleSessionSnapshot({
    [session.BATTLE_SESSION_NAMESPACE]: { [session.BATTLE_SESSION_KEY]: programSnapshot },
  }) !== null,
  true,
);
programSnapshot.state.player.hand[0].effectProgram.spec = 'bad';
assert.equal(
  session.readBattleSessionSnapshot({
    [session.BATTLE_SESSION_NAMESPACE]: { [session.BATTLE_SESSION_KEY]: programSnapshot },
  }),
  null,
  'corrupt runtime effect programs must invalidate the private snapshot',
);
for (const [label, statePatch] of [
  ['negative turns', { currentTurn: -1 }],
  ['negative cards played', { cardsPlayedThisTurn: -1 }],
  ['negative attacks played', { attacksPlayedThisTurn: -1 }],
  ['fractional skills played', { skillsPlayedThisTurn: 0.5 }],
  ['missing draw pile', { player: { ...snapshot.state.player, drawPile: undefined } }],
  ['non-array enemy actions', { enemy: { ...snapshot.state.enemy, actions: {} } }],
  ['non-boolean game-over marker', { isGameOver: 'false' }],
]) {
  assert.equal(
    session.readBattleSessionSnapshot({
      [session.BATTLE_SESSION_NAMESPACE]: {
        [session.BATTLE_SESSION_KEY]: {
          ...snapshot,
          state: { ...snapshot.state, ...statePatch },
        },
      },
    }),
    null,
    `${label} must invalidate the private session snapshot`,
  );
}

console.log('Battle session fingerprint and snapshot contract passed.');
