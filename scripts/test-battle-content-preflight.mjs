import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { preflightBattleContent } = require(resolve('src/fish/core/battleContentPreflight.ts'));

const validBattle = {
  core: { hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
  cards: [
    { id: 'strike', name: '打击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 8 } },
    { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
  ],
  artifacts: [
    { id: 'stone', name: '护石', rarity: 'Common', trigger: 'battle_start', effects: { block: 2 } },
  ],
  items: [{ id: 'tonic', name: '药剂', count: 1, effects: { heal: 8 } }],
  statuses: [
    { id: 'weak', name: '虚弱', emoji: '🌀', type: 'debuff', stacks_change: -1, maxStacks: 3, triggers: {} },
  ],
  player_status_effects: [],
  player_abilities: [],
  player_lust_effect: { name: '反噬', effects: { damage: 8 } },
  enemy: {
    name: '训练傀儡',
    max_hp: 40,
    hp: 40,
    max_lust: 100,
    lust: 0,
    actions: [{ name: '攻击', weight: 1, effects: { damage: 6 } }],
    abilities: [],
    status_effects: [],
    lust_effect: { name: '欲望爆发', effects: { damage: 5 } },
    action_mode: 'random',
    action_config: {},
  },
};

const valid = preflightBattleContent(validBattle);
assert.equal(valid.ok, true, JSON.stringify(valid.issues));

for (const [battle, expectedPath] of [
  [{ ...validBattle, cards: [{ ...validBattle.cards[0], effects: undefined }] }, 'battle.cards[0]'],
  [{ ...validBattle, cards: [{ ...validBattle.cards[0], effect: 'OP.hp - 8' }] }, 'battle.cards[0].effect'],
  [{ ...validBattle, cards: [{ ...validBattle.cards[0], effect_program: { spec: 'mwg.effect/v1', steps: [] } }] }, 'battle.cards[0].effect_program'],
  [{ ...validBattle, statuses: [{ ...validBattle.statuses[0], triggers: { tick: 'ME.hp - stacks' } }] }, 'battle.statuses[0]'],
  [{ ...validBattle, enemy: { ...validBattle.enemy, hp: 99 } }, 'battle.enemy.hp'],
]) {
  const result = preflightBattleContent(battle);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.path.startsWith(expectedPath)), `${expectedPath}: ${JSON.stringify(result.issues)}`);
}

const harmlessEnemy = preflightBattleContent({
  ...validBattle,
  enemy: { ...validBattle.enemy, actions: [{ name: '防御', effects: { block: 5 } }] },
});
assert.ok(harmlessEnemy.warnings.some(issue => issue.code === 'NO_ENEMY_PRESSURE'));

console.log('Strict modern battle preflight passed.');
