import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { preflightBattleContent } = require(resolve('src/fish/core/battleContentPreflight.ts'));

const validBattle = {
  core: { emoji: '🧙', hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
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

const validDiscardBuild = structuredClone(validBattle);
validDiscardBuild.cards = [
  {
    id: 'discard_cycle',
    name: '循环',
    type: 'Skill',
    rarity: 'Common',
    cost: 1,
    quantity: 6,
    effects: [{ draw: 2 }, { discard: 1, from: 'hand', pick: 'random' }],
  },
  {
    id: 'discard_strike',
    name: '追击',
    type: 'Attack',
    rarity: 'Common',
    cost: 1,
    quantity: 4,
    effects: [{ damage: 4 }, { discard: 1, from: 'hand', pick: 'choose' }, { damage: 4 }],
  },
];
validDiscardBuild.artifacts = [
  {
    id: 'discard_relic',
    name: '循环遗物',
    rarity: 'Common',
    trigger: { on: 'turn_start', effects: [{ draw: 1 }, { discard: 1, from: 'hand', pick: 'random' }] },
  },
];
const validDiscardResult = preflightBattleContent(validDiscardBuild);
assert.equal(validDiscardResult.ok, true, `shallow discard build must compile: ${JSON.stringify(validDiscardResult.issues)}`);

const nestedDiscardBuild = structuredClone(validDiscardBuild);
nestedDiscardBuild.cards[0].effects = { draw: 2, discard: { from: 'hand', pick: 'random' } };
nestedDiscardBuild.artifacts[0].trigger.effects[1] = { discard: { from: 'hand', pick: 'random' } };
const nestedDiscardResult = preflightBattleContent(nestedDiscardBuild);
assert.equal(nestedDiscardResult.ok, false);
assert.ok(
  nestedDiscardResult.issues.some(issue => issue.path.startsWith('battle.cards[0].effects.discard')),
  JSON.stringify(nestedDiscardResult.issues),
);
assert.ok(
  nestedDiscardResult.issues.some(issue => issue.path.startsWith('battle.artifacts[0].trigger.effects[1].discard')),
  JSON.stringify(nestedDiscardResult.issues),
);

const compactDesireBattle = structuredClone(validBattle);
compactDesireBattle.player_lust_effect = { damage: 8, draw: 1 };
compactDesireBattle.enemy.lust_effect = { damage: 8, lust: 5 };
assert.equal(
  preflightBattleContent(compactDesireBattle).ok,
  true,
  'direct shallow desire effects should be normalized at the runtime boundary',
);

const oneDecimalBattle = structuredClone(validBattle);
oneDecimalBattle.enemy.max_hp = 40.1;
oneDecimalBattle.enemy.hp = 40.1;
oneDecimalBattle.enemy.actions[0].effects = { damage: 6.5 };
assert.equal(preflightBattleContent(oneDecimalBattle).ok, true, 'AI-authored values may use one decimal place');

const keyedStatusBattle = structuredClone(validBattle);
keyedStatusBattle.statuses = {
  combo_flow: {
    name: '连击心流',
    emoji: 'F',
    type: 'buff',
    stacks_change: 'keep',
    triggers: { apply: { effects: { block: 1 } } },
  },
};
keyedStatusBattle.cards[0].effects = { damage: 8, apply_status: 'combo_flow', stacks: 1 };
keyedStatusBattle.cards.push({
  id: 'combo_power',
  name: '连击架势',
  type: 'Power',
  rarity: 'Uncommon',
  cost: 1,
  quantity: 1,
  effects: { apply_status: 'combo_flow', stacks: 2 },
});
keyedStatusBattle.player_abilities = [
  {
    id: 'combo_awareness',
    name: '连段意识',
    trigger: 'card_played',
    when: 'self.status.combo_flow.stacks >= 5',
    effects: { draw: 1 },
  },
];
const keyedStatusResult = preflightBattleContent(keyedStatusBattle);
assert.equal(
  keyedStatusResult.ok,
  true,
  `model-shaped status maps, trigger wrappers, direct-status Power cards, and shared conditions must be normalized: ${JSON.stringify(keyedStatusResult.issues)}`,
);

const structuredTriggerBattle = structuredClone(validBattle);
structuredTriggerBattle.statuses = [
  { id: 'mark', name: '战斗标记', emoji: '🔴', type: 'debuff', triggers: {}, stacks_change: 'keep' },
];
structuredTriggerBattle.cards.push({
  id: 'structured_power',
  name: '持续能力',
  type: 'Power',
  rarity: 'Uncommon',
  cost: 1,
  quantity: 1,
  effects: { block: 4 },
  trigger: { on: 'deal_damage', effects: { apply_status: 'mark', stacks: 1, to: 'opponent' } },
});
structuredTriggerBattle.artifacts = [
  {
    id: 'structured_relic',
    name: '结构化遗物',
    rarity: 'Common',
    trigger: { on: 'passive', effects: { modify: 'block', add: 1 } },
  },
];
const structuredTriggerResult = preflightBattleContent(structuredTriggerBattle);
assert.equal(
  structuredTriggerResult.ok,
  true,
  `structured card and relic triggers should remain grouped with their effects: ${JSON.stringify(structuredTriggerResult.issues)}`,
);

for (const [battle, expectedPath] of [
  [{ ...validBattle, cards: [{ ...validBattle.cards[0], effects: undefined }] }, 'battle.cards[0]'],
  [{ ...validBattle, cards: [{ ...validBattle.cards[0], effect: 'OP.hp - 8' }] }, 'battle.cards[0].effect'],
  [{ ...validBattle, cards: [{ ...validBattle.cards[0], effect_program: { spec: 'mwg.effect/v1', steps: [] } }] }, 'battle.cards[0].effect_program'],
  [{ ...validBattle, cards: [{ ...validBattle.cards[0], effects: { discard: { count: 1, pick: 'random' } } }] }, 'battle.cards[0].effects.discard'],
  [{ ...validBattle, cards: [{ ...validBattle.cards[0], effects: { damage: '6 + floor(self.hp / 10)' } }] }, 'battle.cards[0].effects.damage'],
  [{ ...validBattle, statuses: [{ ...validBattle.statuses[0], triggers: { tick: 'ME.hp - stacks' } }] }, 'battle.statuses[0]'],
  [{ ...validBattle, enemy: { ...validBattle.enemy, hp: 99 } }, 'battle.enemy.hp'],
  [{ ...validBattle, enemy: { ...validBattle.enemy, max_hp: 40.12, hp: 40.12 } }, 'battle.enemy.max_hp'],
  [{ ...validBattle, enemy: { ...validBattle.enemy, actions: [{ name: '精度错误', effects: { damage: 6.25 } }] } }, 'battle.enemy.actions[0]'],
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

const emptyStatusTrigger = preflightBattleContent({
  ...validBattle,
  statuses: [
    {
      id: 'custom_status',
      name: '自定义状态',
      emoji: 'S',
      type: 'debuff',
      stacks_change: 'keep',
      triggers: { tick: { damage: 3 }, remove: {} },
    },
  ],
});
assert.equal(emptyStatusTrigger.ok, false);
assert.ok(
  emptyStatusTrigger.issues.some(issue => issue.path === 'battle.statuses[0].triggers.remove'),
  JSON.stringify(emptyStatusTrigger.issues),
);

const missingExplicitStatus = structuredClone(validBattle);
missingExplicitStatus.statuses = [];
missingExplicitStatus.player_lust_effect = {
  name: '玩家满溢效果',
  effects: { damage: 8, apply_status: 'unregistered_status', stacks: 1 },
};
missingExplicitStatus.enemy.actions[0].effects = {
  damage: 7,
  apply_status: 'unregistered_status',
  stacks: 1,
};
const missingStatusResult = preflightBattleContent(missingExplicitStatus);
assert.equal(missingStatusResult.ok, false);
assert.ok(
  missingStatusResult.issues.some(issue => issue.path.startsWith('battle.player_lust_effect')),
  JSON.stringify(missingStatusResult.issues),
);
assert.ok(
  missingStatusResult.issues.some(issue => issue.path.startsWith('battle.enemy.actions[0]')),
  JSON.stringify(missingStatusResult.issues),
);

missingExplicitStatus.statuses = [
  {
    id: 'unregistered_status',
    name: '测试状态',
    emoji: 'S',
    type: 'debuff',
    stacks_change: -1,
    maxStacks: 3,
    triggers: {},
  },
];
const registeredStatusResult = preflightBattleContent(missingExplicitStatus);
assert.equal(registeredStatusResult.ok, true, JSON.stringify(registeredStatusResult.issues));

console.log('Strict modern battle preflight passed.');
