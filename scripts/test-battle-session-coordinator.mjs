import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

function transactionHarness(state) {
  let sequence = 0;
  const snapshots = new Map();
  const events = [];
  return {
    events,
    gate: new core.BattleSessionActionGate(),
    beginTransaction(action) {
      const token = `${action}_${++sequence}`;
      snapshots.set(token, structuredClone(state));
      events.push(`begin:${action}`);
      return token;
    },
    commitTransaction(token) {
      assert.equal(snapshots.delete(token), true);
      events.push('commit');
    },
    rollbackTransaction(token) {
      const snapshot = snapshots.get(token);
      assert.ok(snapshot);
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, structuredClone(snapshot));
      snapshots.delete(token);
      events.push('rollback');
    },
  };
}

{
  const state = { terminal: false };
  const tx = transactionHarness(state);
  const steps = [];
  assert.deepEqual(
    await core.startBattleSession({
      ...tx,
      restored: true,
      isTerminal: () => state.terminal,
      executeStartStep: step => steps.push(step),
    }),
    { status: 'restored' },
  );
  assert.deepEqual(tx.events, []);
  assert.deepEqual(steps, []);

  const started = await core.startBattleSession({
    ...tx,
    restored: false,
    isTerminal: () => state.terminal,
    executeStartStep: step => steps.push(step),
  });
  assert.equal(started.status, 'completed');
  assert.deepEqual(steps, core.BATTLE_START_FLOW_STEPS);
  assert.deepEqual(tx.events, ['begin:battle_start', 'commit']);
}

{
  const state = { phase: 'player_turn', terminal: false, marker: 0 };
  const tx = transactionHarness(state);
  const steps = [];
  const result = await core.advanceBattleSessionTurn({
    ...tx,
    canEndTurn: () => state.phase === 'player_turn',
    isTerminal: () => state.terminal,
    beginEnemyTurn: () => {
      state.phase = 'enemy_turn';
      steps.push('begin_enemy');
    },
    executeTurnStep: step => steps.push(step),
  });
  assert.equal(result.status, 'completed');
  const enemyStep = core.BATTLE_TURN_FLOW_STEPS.indexOf('enemy_block_reset');
  assert.deepEqual(steps, [
    ...core.BATTLE_TURN_FLOW_STEPS.slice(0, enemyStep),
    'begin_enemy',
    ...core.BATTLE_TURN_FLOW_STEPS.slice(enemyStep),
  ]);
  assert.deepEqual(tx.events, ['begin:end_turn', 'commit']);

  state.phase = 'player_turn';
  await assert.rejects(
    core.advanceBattleSessionTurn({
      ...tx,
      canEndTurn: () => true,
      isTerminal: () => false,
      beginEnemyTurn: () => {
        state.phase = 'enemy_turn';
      },
      executeTurnStep: step => {
        state.marker += 1;
        if (step === 'enemy_action') throw new Error('enemy failed');
      },
    }),
    /enemy failed/,
  );
  assert.equal(state.phase, 'player_turn');
  assert.equal(state.marker, 0);
  assert.equal(tx.gate.active(), null);
}

{
  const state = { phase: 'player_turn', terminal: false, extraPlayerTurns: 1, marker: 0 };
  const tx = transactionHarness(state);
  await assert.rejects(
    core.advanceBattleSessionTurn({
      ...tx,
      canEndTurn: () => state.phase === 'player_turn',
      isTerminal: () => state.terminal,
      beginEnemyTurn: () => { state.phase = 'enemy_turn'; },
      consumeExtraTurn: actor => {
        if (actor !== 'player' || state.extraPlayerTurns <= 0) return false;
        state.extraPlayerTurns -= 1;
        return true;
      },
      executeTurnStep: step => {
        state.marker += 1;
        if (step === 'player_begin') throw new Error('extra turn failed');
      },
    }),
    /extra turn failed/,
  );
  assert.deepEqual(state, { phase: 'player_turn', terminal: false, extraPlayerTurns: 1, marker: 0 });
  assert.equal(tx.gate.active(), null);
}

function cardState() {
  return {
    phase: 'player_turn',
    hasOpponent: true,
    terminal: false,
    hand: [
      { id: 'attack', name: '攻击', type: 'Attack', cost: 1, doubleEffect: true },
      { id: 'guard', name: '守势', type: 'Skill', cost: 0 },
    ],
    energy: 3,
    cardsPlayedThisTurn: 0,
    attacksPlayedThisTurn: 0,
    skillsPlayedThisTurn: 0,
    discardPile: [],
    exhaustPile: [],
    transit: [],
    effects: 0,
    postTriggers: 0,
  };
}

function cardPorts(state, tx, overrides = {}) {
  return {
    ...tx,
    readCardPlayState: () => ({
      phase: state.phase,
      hasOpponent: state.hasOpponent,
      hand: state.hand,
      energy: state.energy,
      cardsPlayedThisTurn: state.cardsPlayedThisTurn,
      attacksPlayedThisTurn: state.attacksPlayedThisTurn,
      skillsPlayedThisTurn: state.skillsPlayedThisTurn,
      statusIds: [],
    }),
    isTerminal: () => state.terminal,
    presentCardPlay: () => tx.events.push('present'),
    applyCardPlayCommit: committed => {
      state.hand = committed.hand;
      state.energy = committed.energy;
      state.cardsPlayedThisTurn = committed.cardsPlayedThisTurn;
      state.attacksPlayedThisTurn = committed.attacksPlayedThisTurn;
      state.skillsPlayedThisTurn = committed.skillsPlayedThisTurn;
    },
    beginCardTransit: card => state.transit.push(card.id),
    endCardTransit: card => {
      state.transit = state.transit.filter(id => id !== card.id);
    },
    executeCardEffect: () => {
      state.effects += 1;
    },
    movePlayedCard: (card, destination) => state[`${destination}Pile`].push(card),
    triggerPostCardPlay: () => {
      state.postTriggers += 1;
    },
    ...overrides,
  };
}

{
  const state = cardState();
  const tx = transactionHarness(state);
  const result = await core.playBattleSessionCard('attack', cardPorts(state, tx));
  assert.equal(result.status, 'completed');
  assert.equal(result.repeatsExecuted, 2);
  assert.deepEqual(state.hand.map(card => card.id), ['guard']);
  assert.equal(state.energy, 2);
  assert.equal(state.cardsPlayedThisTurn, 1);
  assert.equal(state.attacksPlayedThisTurn, 1);
  assert.equal(state.skillsPlayedThisTurn, 0);
  assert.equal(state.effects, 2);
  assert.equal(state.postTriggers, 1);
  assert.deepEqual(state.transit, []);
  assert.equal(state.discardPile.length, 1);
  assert.equal(state.discardPile[0].id, 'attack');
  assert.equal(state.discardPile[0].doubleEffect, undefined);
  assert.deepEqual(tx.events, ['begin:play_card', 'present', 'commit']);
}

{
  const state = cardState();
  const tx = transactionHarness(state);
  const before = structuredClone(state);
  await assert.rejects(
    core.playBattleSessionCard(
      'attack',
      cardPorts(state, tx, {
        executeCardEffect: () => {
          state.effects += 1;
          throw new Error('effect failed');
        },
      }),
    ),
    /effect failed/,
  );
  assert.deepEqual(state, before);
  assert.equal(tx.gate.active(), null);
}

{
  const state = cardState();
  const tx = transactionHarness(state);
  let releaseEffect;
  const pendingEffect = new Promise(resolveEffect => {
    releaseEffect = resolveEffect;
  });
  const playing = core.playBattleSessionCard(
    'attack',
    cardPorts(state, tx, { executeCardEffect: () => pendingEffect }),
  );
  await Promise.resolve();
  assert.equal(tx.gate.active(), 'play_card');
  assert.deepEqual(
    await core.advanceBattleSessionTurn({
      ...tx,
      canEndTurn: () => true,
      isTerminal: () => false,
      beginEnemyTurn: () => {},
      executeTurnStep: () => {},
    }),
    { status: 'busy' },
  );
  releaseEffect();
  assert.equal((await playing).status, 'completed');
}

{
  const state = { phase: 'player_turn', terminal: false, itemCount: 1, hp: 10 };
  const tx = transactionHarness(state);
  const first = await core.runBattleSessionAtomicAction(
    'use_item',
    { ...tx, canRun: () => state.phase === 'player_turn', isTerminal: () => state.terminal },
    () => {
      state.itemCount -= 1;
      state.hp += 2;
      return '药剂';
    },
  );
  assert.deepEqual(first, { status: 'completed', value: '药剂' });
  assert.deepEqual({ itemCount: state.itemCount, hp: state.hp }, { itemCount: 0, hp: 12 });

  await assert.rejects(
    core.runBattleSessionAtomicAction(
      'use_item',
      { ...tx, canRun: () => true, isTerminal: () => false },
      () => {
        state.hp = 1;
        throw new Error('item failed');
      },
    ),
    /item failed/,
  );
  assert.equal(state.hp, 12);
}

console.log('Portable battle-session coordinator owns action gating, transactions, card play, turns, and restore safety.');
