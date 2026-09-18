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
  assert.equal(Object.hasOwn(battle.enemy, 'lust_effect'), false, 'settlement must remove the optional effect instead of leaving an invalid empty shell');
}
assert.equal(variables.battle, flatBattle, 'flat battle data is outside the current settlement contract');
assert.deepEqual(variables.stat_data.reward.request, { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'victory' });

const depletedItemVariables = {
  stat_data: {
    battle: {
      ...root(),
      items: [
        { id: 'empty_tonic', name: 'Empty tonic', count: 1 },
        { id: 'spare_tonic', name: 'Spare tonic', count: 2 },
      ],
    },
  },
};
settleTavernBattleVariables(depletedItemVariables, {
  result: 'victory',
  player: { currentHp: 12, currentLust: 7 },
  items: [
    { id: 'empty_tonic', count: 0 },
    { id: 'spare_tonic', count: 1 },
  ],
  turns: 1,
});
assert.deepEqual(
  depletedItemVariables.stat_data.battle.items.map(item => ({ id: item.id, count: item.count })),
  [{ id: 'spare_tonic', count: 1 }],
  'battle settlement removes a consumable after its final use',
);

const victoryWithRequest = { stat_data: { battle: { ...root(), exp: 10 } } };
settleTavernBattleVariables(victoryWithRequest, {
  result: 'victory',
  request: { player: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, level: 1 }, route: null },
  player: { currentHp: 12, currentLust: 7 },
  items: [],
  turns: 3,
});
assert.equal(victoryWithRequest.stat_data.battle.exp, 35, 'ordinary victory experience is program-owned');

const promotionWithoutCommonUi = {
  stat_data: {
    battle: {
      ...root(),
      level: 1,
      exp: 90,
      core: { ...root().core, card_removal_count: 0 },
    },
  },
};
settleTavernBattleVariables(promotionWithoutCommonUi, {
  result: 'victory',
  request: { player: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, level: 1 }, route: null },
  player: { currentHp: 12, currentLust: 7 },
  items: [],
  turns: 3,
});
assert.equal(promotionWithoutCommonUi.stat_data.battle.level, 2, 'battle settlement promotes without mounting common UI');
assert.equal(promotionWithoutCommonUi.stat_data.battle.exp, 15, 'promotion consumes the current level requirement');
assert.equal(
  promotionWithoutCommonUi.stat_data.battle.core.card_removal_count,
  1,
  'reaching an even level immediately grants one removal use',
);

const legacyTowerProgression = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    battle: {
      ...root(),
      level: 1,
      exp: 150,
      core: { ...root().core, card_removal_count: 0 },
    },
  },
};
settleTavernBattleVariables(legacyTowerProgression, {
  result: 'victory',
  request: { player: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, level: 1 }, route: null },
  player: { currentHp: 12, currentLust: 7 },
  items: [],
  turns: 3,
});
assert.equal(legacyTowerProgression.stat_data.battle.level, 1, 'tower settlement preserves legacy levels without progressing them');
assert.equal(legacyTowerProgression.stat_data.battle.exp, 150, 'tower settlement neither grants nor consumes legacy EXP');
assert.equal(legacyTowerProgression.stat_data.battle.core.card_removal_count, 0, 'tower legacy EXP cannot generate removal rewards');

const permanentGrowthVariables = { stat_data: { battle: root() } };
const permanentGrowthInput = {
  result: 'defeat',
  player: { currentHp: 99, currentLust: 7 },
  items: [],
  turns: 2,
  persistentGrowth: [
    { id: 'growth_hp_1', stat: 'max_hp', operator: 'add', value: 12 },
    { id: 'growth_lust_1', stat: 'max_lust', operator: 'set', value: 120 },
  ],
};
const permanentGrowthSnapshot = structuredClone(permanentGrowthInput);
settleTavernBattleVariables(permanentGrowthVariables, structuredClone(permanentGrowthSnapshot));
assert.equal(permanentGrowthVariables.stat_data.battle.core.max_hp, 32, 'only the explicit ledger persists player maxima');
assert.equal(permanentGrowthVariables.stat_data.battle.core.max_lust, 120);
assert.equal(permanentGrowthVariables.stat_data.battle.core.hp, 32, 'settlement clamps final vitals to the new maximum');
assert.deepEqual(
  permanentGrowthVariables.stat_data.battle.core.persistent_growth_receipts,
  ['growth_hp_1', 'growth_lust_1'],
  'the MVU core stores the durable receipt with the applied growth',
);
const reloadSnapshot = structuredClone(permanentGrowthVariables);
assert.equal(reloadSnapshot.stat_data.battle.core.max_hp, 32, 'the canonical settled root survives a reload snapshot');
settleTavernBattleVariables(permanentGrowthVariables, structuredClone(permanentGrowthSnapshot));
assert.equal(permanentGrowthVariables.stat_data.battle.core.max_hp, 32, 'a repeated settlement consumes the ledger instead of stacking permanent growth');

const failedGrowthVariables = { stat_data: { battle: root() } };
const failedGrowthInput = {
  result: 'defeat', player: { currentHp: 12, currentLust: 7 }, items: [], turns: 1,
  persistentGrowth: [
    { id: 'retry_hp', stat: 'max_hp', operator: 'add', value: 4 },
    { id: '', stat: 'max_lust', operator: 'add', value: 5 },
  ],
};
assert.throws(
  () => settleTavernBattleVariables(failedGrowthVariables, structuredClone(failedGrowthInput)),
  /invalid persistent growth ledger entry/,
);
assert.equal(failedGrowthVariables.stat_data.battle.core.max_hp, 20, 'a failed settlement cannot partially apply a preceding growth entry');
assert.equal(failedGrowthInput.persistentGrowth.length, 2, 'a failed callback leaves its source ledger intact for retry');
const retryGrowthInput = structuredClone(failedGrowthInput);
retryGrowthInput.persistentGrowth[1].id = 'retry_lust';
settleTavernBattleVariables(failedGrowthVariables, retryGrowthInput);
assert.equal(failedGrowthVariables.stat_data.battle.core.max_hp, 24, 'a later retry applies the intact ledger exactly once');
const transientMaximumVariables = { stat_data: { battle: root() } };
settleTavernBattleVariables(transientMaximumVariables, {
  result: 'victory', player: { currentHp: 12, currentLust: 7 }, items: [], turns: 1,
});
assert.equal(transientMaximumVariables.stat_data.battle.core.max_hp, 20, 'ordinary combat settlement never invents permanent max-health growth');

console.log('The Tavern settlement adapter cleans the canonical MUV root.');
for(const withRequest of [false,true])for(const [hp,expected] of [[12.2,12],[12.5,13],[12.8,13]]){
 const saved={stat_data:{battle:root(),reward:{card:[],artifact:[],item:[],limits:{},request:null}}};
 const input={result:'victory',player:{currentHp:hp,currentLust:1.25},items:[],turns:3,...(withRequest?{request:{player:{hp:20,maxHp:20,lust:0,maxLust:100,level:1},route:null}}:{})};
 settleTavernBattleVariables(saved,input);assert.equal(saved.stat_data.battle.core.hp,expected);assert.equal(input.player.currentHp,hp);
 assert.equal(JSON.parse(JSON.stringify(saved)).stat_data.battle.core.hp,expected,'rounded outcome survives save restore');
}
