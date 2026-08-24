import assert from 'node:assert/strict';

import { summarizeBattleSnapshot, summarizeMvuBattle } from './lib/battle-snapshot-report.mjs';

const snapshot = {
  state: {
    currentTurn: 3,
    phase: 'player_turn',
    random: { schemaVersion: 1, seed: 12345, cursor: 9 },
    battleRequest: { route: { nodeId: 'a1_f1_battle_0_0' } },
    cardsPlayedThisTurn: 2,
    attacksPlayedThisTurn: 1,
    skillsPlayedThisTurn: 1,
    player: {
      currentHp: 18,
      energy: 1,
      block: 4,
      hand: [{ id: 'marked', name: 'Marked', cost: 1, doubleEffect: true }],
      drawPile: [{ id: 'draw', name: 'Draw', cost: 2 }],
      discardPile: [],
      exhaustPile: [{ id: 'spent', name: 'Spent', cost: 0 }],
    },
    enemy: {
      currentHp: 12,
      block: 3,
      nextAction: { name: 'Guard' },
      _sequenceIndex: 1,
      _sequenceDoneOnce: true,
    },
  },
};

assert.deepEqual(summarizeBattleSnapshot(snapshot), {
  currentTurn: 3,
  phase: 'player_turn',
  randomSeed: 12345,
  randomCursor: 9,
  requestNodeId: 'a1_f1_battle_0_0',
  currentHp: 18,
  currentHpType: 'number',
  energy: 1,
  block: 4,
  enemyHp: 12,
  enemyBlock: 3,
  enemyIntent: 'Guard',
  enemySequenceIndex: 1,
  enemySequenceDoneOnce: true,
  cardsPlayedThisTurn: 2,
  attacksPlayedThisTurn: 1,
  skillsPlayedThisTurn: 1,
  hand: [{ id: 'marked', name: 'Marked', cost: 1, doubleEffect: true }],
  drawPile: [{ id: 'draw', name: 'Draw', cost: 2, doubleEffect: undefined }],
  discardPile: [],
  exhaustPile: [{ id: 'spent', name: 'Spent', cost: 0, doubleEffect: undefined }],
});
assert.equal(summarizeBattleSnapshot(null).hand, null);

assert.deepEqual(
  summarizeMvuBattle({
    core: { hp: 40, max_hp: 50 },
    cards: [{ id: 'guard' }],
    enemy: {
      name: 'Target',
      hp: 30,
      max_hp: 30,
      block: 2,
      actions: [{ name: 'Hit' }, { name: 'Guard' }],
      action_mode: 'sequence',
      action_config: { sequence: ['Hit', 'Guard'] },
    },
  }),
  {
    coreHp: 40,
    coreMaxHp: 50,
    cardCount: 1,
    enemyName: 'Target',
    enemyHp: 30,
    enemyMaxHp: 30,
    enemyBlock: 2,
    enemyActionMode: 'sequence',
    enemyActionNames: ['Hit', 'Guard'],
    enemyActionConfig: { sequence: ['Hit', 'Guard'] },
  },
);

console.log('Real Tavern snapshot reports preserve battle state and card-operation markers.');
