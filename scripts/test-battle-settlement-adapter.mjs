import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { settleTavernBattleVariables } = require(resolve('src/runtime/battleSettlementAdapter.ts'));

const enemy = () => ({
  name: '敌人', emoji: 'X', max_hp: 20, hp: 0, max_lust: 80, lust: 9, description: 'desc',
  actions: [{ name: '攻击' }], abilities: [{}], status_effects: [{}],
  lust_effect: { name: '反噬', description: 'desc', effects: [{ damage: 1 }] },
  action_mode: 'sequence', action_config: { sequence: ['攻击'] },
});
const root = () => ({
  core: { hp: 20, max_hp: 20, lust: 0, max_lust: 100 },
  player_abilities: [{}], player_status_effects: [{}], items: [{ id: 'potion', count: 2 }], enemy: enemy(),
});
const flatBattle = root();
const variables = { stat_data: { battle: root(), reward: { card: [], artifact: [], item: [], limits: {}, request: null } }, battle: flatBattle };
const result = settleTavernBattleVariables(variables, {
  result: 'victory',
  player: { currentHp: 12, currentLust: 7 },
  items: [{ id: 'potion', count: 1 }],
  turns: 3,
  rewardRequest: { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'victory' },
});

assert.equal(result, variables);
for (const battle of [variables.stat_data.battle]) {
  assert.equal(battle.core.hp, 12);
  assert.equal(battle.core.lust, 7);
  assert.deepEqual(battle.player_abilities, []);
  assert.deepEqual(battle.player_status_effects, []);
  assert.equal(battle.items[0].count, 1);
  assert.equal(battle.enemy.name, '');
  assert.deepEqual(battle.enemy.actions, []);
  assert.deepEqual(battle.enemy.action_config, {});
  assert.equal(battle.enemy.action_mode, 'sequence');
  assert.deepEqual(battle.enemy.lust_effect.effects, []);
}
assert.equal(variables.battle, flatBattle, 'flat battle data is outside the current settlement contract');
assert.deepEqual(variables.stat_data.reward.request, { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'victory' });

const victoryWithRequest = { stat_data: { battle: { ...root(), exp: 10 } } };
settleTavernBattleVariables(victoryWithRequest, {
  result: 'victory',
  request: { player: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, level: 1 }, route: null },
  player: { currentHp: 12, currentLust: 7 },
  items: [],
  turns: 3,
});
assert.equal(victoryWithRequest.stat_data.battle.exp, 35, 'ordinary victory experience is program-owned');

console.log('The Tavern settlement adapter cleans the canonical MUV root.');
