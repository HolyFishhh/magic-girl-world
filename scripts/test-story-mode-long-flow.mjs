import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { assessInitialPlayerContent } = require(resolve('src/game-core/playerContentReadiness.ts'));
const { createContentPackFromMvuBattle } = require(resolve('src/runtime/contentPackAdapter.ts'));
const { settleTavernBattleVariables } = require(resolve('src/runtime/battleSettlementAdapter.ts'));
const { preflightBattleContent } = require(resolve('src/fish/core/battleContentPreflight.ts'));
const { applyRewardSelectionsToStat, hasSelectableRewards } = require(resolve('src/common/rewardTransactions.ts'));

const settlementMarker = '[MVU_BATTLE_SETTLEMENT]';
const enemy = ({ id, name, hp, maxHp }) => ({
  id,
  name,
  emoji: '👁️',
  hp,
  max_hp: maxHp,
  lust: 0,
  max_lust: 100,
  description: '剧情中已经具象并立即发动攻击的敌人。',
  actions: [
    { id: `${id}_strike`, name: '压迫攻击', description: '向玩家发动直接攻击。', weight: 2, effects: { damage: 7 } },
    { id: `${id}_guard`, name: '短暂防守', description: '收拢力量保护自己。', weight: 1, effects: { block: 5 } },
  ],
  abilities: [],
  status_effects: [],
  lust_effect: {
    name: '失控追击',
    description: '欲望满溢时继续伤害玩家。',
    effects: { damage: 6 },
  },
  action_mode: 'probability',
  action_config: { probability: { 压迫攻击: 2, 短暂防守: 1 } },
});

const firstEnemy = enemy({ id: 'first_enemy', name: '初战敌人', hp: 34, maxHp: 34 });
const variables = {
  stat_data: {
    status: {
      time: '24年01月01日 09:00',
      location: '故事起点',
      profession: { name: '旅法者', ability: '将沿途经历转化为卡牌构筑。' },
      inventory: [],
      permanent_status: [],
      temporary_status: [],
    },
    battle: {
      core: { emoji: '🧙', hp: 80, max_hp: 80, lust: 0, max_lust: 100, card_removal_count: 1 },
      cards: [
        {
          id: 'starter_strike', name: '基础攻击', emoji: '⚔️', type: 'Attack', rarity: 'Common', cost: 1,
          quantity: 5, description: '向敌方发动直接攻击。', effects: { damage: 6 },
        },
        {
          id: 'starter_guard', name: '基础防守', emoji: '🛡️', type: 'Skill', rarity: 'Common', cost: 1,
          quantity: 5, description: '稳住架势保护自己。', effects: { block: 5 },
        },
        {
          id: 'starter_focus', name: '资源整理', emoji: '✨', type: 'Skill', rarity: 'Uncommon', cost: 0,
          quantity: 1, description: '整理资源并抽取新的行动。', effects: { draw: 1 },
        },
      ],
      artifacts: [
        {
          id: 'starter_keepsake', name: '启程纪念物', emoji: '🎗️', rarity: 'Common',
          description: '在战斗开始时提供少量保护。',
          trigger: { on: 'battle_start', effects: { block: 3 } },
        },
      ],
      items: [
        { id: 'starter_tonic', name: '随身补给', emoji: '🧴', count: 2, description: '恢复生命。', effects: { heal: 8 } },
      ],
      statuses: [],
      player_abilities: [],
      player_status_effects: [],
      player_lust_effect: {
        name: '意志回响', description: '敌方欲望满溢时发动追击。', effects: { damage: 8, to: 'opponent' },
      },
      enemy: firstEnemy,
      level: 1,
      exp: 0,
    },
    reward: { card: [], artifact: [], item: [], limits: {}, request: null },
    run: null,
    run_result: null,
    run_upgrade: null,
  },
};

const initial = assessInitialPlayerContent(createContentPackFromMvuBattle(variables.stat_data.battle), {
  emoji: variables.stat_data.battle.core.emoji,
  hp: variables.stat_data.battle.core.hp,
  maxHp: variables.stat_data.battle.core.max_hp,
  lust: variables.stat_data.battle.core.lust,
  maxLust: variables.stat_data.battle.core.max_lust,
  level: variables.stat_data.battle.level,
  exp: variables.stat_data.battle.exp,
});
assert.equal(initial.ok, true, `initialization failed: ${JSON.stringify(initial.issues)}`);
assert.equal(initial.deck.deckQuantity, 11);
assert.equal(preflightBattleContent(variables.stat_data.battle).ok, true, 'the initialized first encounter must open');

const firstRequest = {
  player: { hp: 80, maxHp: 80, lust: 0, maxLust: 100, level: 1 },
  route: null,
};
settleTavernBattleVariables(variables, {
  result: 'victory',
  request: firstRequest,
  player: { currentHp: 63, currentLust: 12 },
  items: [{ id: 'starter_tonic', count: 1 }],
  turns: 4,
  rewardRequest: {
    marker: settlementMarker,
    result: 'victory',
    cards: { candidates: 2, rarities: ['Common', 'Uncommon'] },
    items: { candidates: 1 },
    limits: { cards: 1, items: 1 },
  },
});
assert.equal(variables.stat_data.battle.core.hp, 63);
assert.equal(variables.stat_data.battle.exp, 25);
assert.equal(variables.stat_data.battle.items[0].count, 1);
assert.equal(variables.stat_data.battle.enemy.name, '');

// Emulate the settlement model: ordinary rewards plus a story-confirmed cost of victory.
variables.stat_data.reward.card = [
  {
    id: 'reward_counter', name: '余势反击', emoji: '🌠', type: 'Attack', rarity: 'Common', cost: 1,
    quantity: 1, description: '借助上一场战斗积累的余势攻击敌方。', effects: { damage: 8 },
  },
  {
    id: 'reward_cycle', name: '回流准备', emoji: '🔄', type: 'Skill', rarity: 'Uncommon', cost: 1,
    quantity: 1, description: '整理手牌并恢复行动资源。', effects: { draw: 1, energy: 1 },
  },
];
variables.stat_data.reward.artifact = [];
variables.stat_data.reward.item = [
  { id: 'reward_tonic', name: '战后补给', emoji: '🧃', count: 1, description: '恢复生命。', effects: { heal: 10 } },
];
variables.stat_data.reward.limits = { cards: 1, items: 1 };
variables.stat_data.battle.cards.push({
  id: 'victory_cost', name: '胜利余痛', emoji: '🕸️', type: 'Curse', rarity: 'Corrupt', quantity: 1,
  description: '胜利留下的创伤会在抽到时反噬自己。', effects: { damage: 2, to: 'self' },
});
variables.stat_data.reward.request = null;
assert.equal(hasSelectableRewards(variables.stat_data), true);

const rewardSummary = applyRewardSelectionsToStat(variables.stat_data, {
  cards: [0], artifacts: [], items: [0],
});
assert.deepEqual(rewardSummary, { cards: ['余势反击'], artifacts: [], items: ['战后补给'] });
assert.equal(hasSelectableRewards(variables.stat_data), false);
assert.equal(variables.stat_data.battle.cards.some(card => card.id === 'victory_cost'), true);
assert.equal(variables.stat_data.battle.cards.some(card => card.id === 'reward_counter'), true);
assert.equal(variables.stat_data.battle.cards.find(card => card.id === 'starter_strike').quantity, 5);

// The next encounter inherits the grown deck and may begin with story-established damage.
const secondEnemy = enemy({ id: 'second_enemy', name: '第二名敌人', hp: 29, maxHp: 42 });
variables.stat_data.battle.enemy = secondEnemy;
assert.equal(preflightBattleContent(variables.stat_data.battle).ok, true, 'the second encounter must accept inherited growth');
assert.equal(variables.stat_data.battle.enemy.hp < variables.stat_data.battle.enemy.max_hp, true);

const expBeforeDefeat = variables.stat_data.battle.exp;
settleTavernBattleVariables(variables, {
  result: 'defeat',
  request: {
    player: { hp: 63, maxHp: 80, lust: 12, maxLust: 100, level: 1 },
    route: null,
  },
  player: { currentHp: 0, currentLust: 48 },
  items: [
    { id: 'starter_tonic', count: 1 },
    { id: 'reward_tonic', count: 1 },
  ],
  turns: 5,
  rewardRequest: {
    marker: settlementMarker,
    result: 'defeat',
    penalty: true,
    enemy: { id: secondEnemy.id, name: secondEnemy.name, description: secondEnemy.description },
  },
});
assert.equal(variables.stat_data.battle.core.hp, 0);
assert.equal(variables.stat_data.battle.exp, expBeforeDefeat, 'defeat must not grant victory experience');
assert.equal(variables.stat_data.battle.enemy.name, '');

// Emulate one legal multi-penalty response. No fixed count or exclusive category is imposed.
variables.stat_data.reward.card = [];
variables.stat_data.reward.artifact = [];
variables.stat_data.reward.item = [];
variables.stat_data.reward.limits = {};
variables.stat_data.battle.cards.push({
  id: 'defeat_curse', name: '败北烙印', emoji: '⛓️', type: 'Curse', rarity: 'Corrupt', quantity: 1,
  description: '战败留下的烙印会伤害自己。', effects: { damage: 3, to: 'self' },
});
variables.stat_data.battle.artifacts.push({
  id: 'negative_relic', name: '沉重枷锁', emoji: '🔗', rarity: 'Corrupt',
  description: '承受攻击时受到额外伤害。',
  trigger: { on: 'passive', effects: { modify: 'damage_taken', add: 1 } },
});
variables.stat_data.status.permanent_status.push(
  { id: 'lasting_wound', name: '长久创伤', description: '伤势会持续影响后续剧情。' },
  { id: 'enemy_mark', name: '敌人印记', description: '敌人的力量在角色身上留下了持续痕迹。' },
);
variables.stat_data.reward.request = null;

assert.deepEqual(variables.stat_data.reward, { card: [], artifact: [], item: [], limits: {}, request: null });
assert.equal(variables.stat_data.battle.cards.some(card => card.id === 'defeat_curse'), true);
assert.equal(variables.stat_data.battle.artifacts.some(artifact => artifact.id === 'negative_relic'), true);
assert.deepEqual(
  variables.stat_data.status.permanent_status.map(status => status.id),
  ['lasting_wound', 'enemy_mark'],
);
assert.equal(variables.stat_data.run, null, 'story mode must not silently initialize a tower run');

console.log('Story mode deterministically completes initialization, victory rewards, a second encounter, and multi-penalty defeat.');
