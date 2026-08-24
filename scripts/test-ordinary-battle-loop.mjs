import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const { settleTavernBattleVariables } = require(resolve('src/runtime/battleSettlementAdapter.ts'));
const { settleBattleProgression } = require(resolve('src/common/progression.ts'));
const rewards = require(resolve('src/common/rewardTransactions.ts'));
const { parseOptionTags } = require(resolve('src/common/optionTags.ts'));

const starter = {
  id: 'starter_strike',
  name: '星击',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  quantity: 5,
  effects: { damage: 6 },
};
const rewardCard = {
  id: 'afterglow_guard',
  name: '余辉守势',
  type: 'Skill',
  rarity: 'Common',
  cost: 1,
  quantity: 1,
  effects: { block: 8 },
};
const variables = {
  stat_data: {
    run: null,
    run_result: null,
    run_upgrade: null,
    battle: {
      core: { hp: 20, max_hp: 20, lust: 0, max_lust: 100, card_removal_count: 0 },
      level: 1,
      exp: 90,
      cards: [starter],
      artifacts: [],
      items: [{ id: 'potion', name: '药剂', count: 2, effects: { heal: 5 } }],
      statuses: [],
      player_abilities: [{ id: 'temporary', name: '临时能力', trigger: 'battle_start', effects: { block: 1 } }],
      player_status_effects: [{ id: 'temporary', stacks: 1 }],
      enemy: {
        name: '影兽',
        emoji: 'X',
        max_hp: 30,
        hp: 0,
        max_lust: 100,
        lust: 0,
        description: '',
        actions: [{ name: '爪击', effects: { damage: 5 } }],
        abilities: [],
        status_effects: [],
        lust_effect: { name: '', description: '', effects: [] },
        action_mode: 'random',
        action_config: {},
      },
    },
    reward: { card: [], artifact: [], item: [], limits: {} },
  },
};
const ordinaryRequest = {
  player: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, level: 1 },
  route: null,
};

const prompt = core.formatBattleEndPrompt({
  result: 'victory',
  continuation: 'ordinary',
  player: {
    hp: 14,
    maxHp: 20,
    lust: 7,
    maxLust: 100,
    energy: 0,
    statuses: [],
    handCount: 0,
    drawPileCount: 0,
    discardPileCount: 10,
  },
  turns: 3,
  rewardBudget: '[奖励预算] cards=3/1 rarity=Common exp=160',
});
assert.match(prompt.promptedBattleSummary, /\[战斗后续\] ordinary/);

settleTavernBattleVariables(variables, {
  result: 'victory',
  request: ordinaryRequest,
  player: { currentHp: 14, currentLust: 7 },
  items: [{ id: 'potion', count: 1 }],
  turns: 3,
});
assert.equal(variables.stat_data.run, null);
assert.equal(variables.stat_data.battle.core.hp, 14);
assert.equal(variables.stat_data.battle.items[0].count, 1);
assert.equal(variables.stat_data.battle.enemy.name, '');
assert.deepEqual(variables.stat_data.battle.player_abilities, []);
assert.deepEqual(variables.stat_data.battle.player_status_effects, []);

// This is the canonical state produced by a valid ordinary post-battle AI reply.
variables.stat_data.battle.exp += 160;
variables.stat_data.reward.card = [rewardCard];
variables.stat_data.reward.limits = { cards: 1 };
const response = `战斗后的街区逐渐恢复平静。

<Options>
<Option id="1">护送伤员返回据点</Option>
<BattleOption id="2">追击逃走的影兽</BattleOption>
</Options>`;
const options = parseOptionTags(response);
assert.deepEqual(options, [
  { kind: 'option', text: '护送伤员返回据点' },
  { kind: 'battle-option', text: '追击逃走的影兽' },
]);
assert.equal(rewards.hasSelectableRewards(variables.stat_data), true, 'rewards temporarily gate ordinary options');

assert.deepEqual(settleBattleProgression(variables.stat_data.battle), {
  before: { level: 1, exp: 250 },
  after: { level: 3, exp: 0 },
  promotions: 2,
  cardRemovalsGranted: 1,
});
assert.equal(variables.stat_data.battle.core.card_removal_count, 1);

assert.deepEqual(rewards.applyRewardSelectionsToStat(variables.stat_data, { cards: [0], artifacts: [], items: [] }), {
  cards: ['余辉守势'],
  artifacts: [],
  items: [],
});
assert.equal(rewards.hasSelectableRewards(variables.stat_data), false, 'ordinary options resume after reward settlement');
assert.equal(variables.stat_data.battle.cards.some(card => card.id === rewardCard.id), true);
assert.equal(variables.stat_data.run, null, 'the complete ordinary loop must not initialize an expedition');
assert.equal(parseOptionTags(response).length, 2, 'the original post-battle options remain available after reward settlement');

console.log('Ordinary battle settlement, AI continuation, rewards, progression, and story options form one loop.');
