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

const weightedAliasBattle = structuredClone(validBattle);
weightedAliasBattle.enemy.actions = [
  { name: '轻击', weight: 3, effects: { damage: 4 } },
  { name: '重击', weight: 1, effects: { damage: 9 } },
];
weightedAliasBattle.enemy.action_mode = 'weighted';
weightedAliasBattle.enemy.action_config = {};
assert.equal(
  preflightBattleContent(weightedAliasBattle).ok,
  true,
  'weighted model output should be accepted as a probability alias',
);

const validResourceBattle = structuredClone(validBattle);
validResourceBattle.core.resources = [
  { id: 'stars', name: '星能', emoji: '⭐', current: 2, max: 5, refresh: 'retain' },
];
validResourceBattle.cards[0].cost = { energy: 1, stars: 2 };
assert.equal(preflightBattleContent(validResourceBattle).ok, true, JSON.stringify(preflightBattleContent(validResourceBattle).issues));

const unknownResourceBattle = structuredClone(validBattle);
unknownResourceBattle.cards[0].cost = { energy: 1, stars: 1 };
const unknownResourceResult = preflightBattleContent(unknownResourceBattle);
assert.equal(unknownResourceResult.ok, false);
assert.equal(unknownResourceResult.issues.some(issue => issue.code === 'UNKNOWN_CARD_RESOURCE'), true);

const invalidResourceBattle = structuredClone(validResourceBattle);
invalidResourceBattle.core.resources.push({ id: 'stars', name: '重复', emoji: '!', current: 9, max: 2, refresh: 'never' });
const invalidResourceResult = preflightBattleContent(invalidResourceBattle);
assert.equal(invalidResourceResult.ok, false);
for (const code of ['DUPLICATE_RESOURCE_ID', 'INVALID_RESOURCE_VALUE', 'INVALID_RESOURCE_REFRESH']) {
  assert.equal(invalidResourceResult.issues.some(issue => issue.code === code), true, code);
}

const playerOwnedResourceStatus = structuredClone(validResourceBattle);
playerOwnedResourceStatus.statuses.push({
  id: 'star_guard',
  name: '星辉守护',
  emoji: '⭐',
  type: 'buff',
  stacks_change: -1,
  maxStacks: 5,
  triggers: { tick: { block: 'self.resource.stars.current' } },
});
playerOwnedResourceStatus.player_status_effects = [{ id: 'star_guard', stacks: 1 }];
assert.equal(
  preflightBattleContent(playerOwnedResourceStatus).ok,
  true,
  'a player-owned status must not force unrelated enemies to register the player private resource',
);

const invalidEnemyOwnedResourceStatus = structuredClone(playerOwnedResourceStatus);
invalidEnemyOwnedResourceStatus.player_status_effects = [];
invalidEnemyOwnedResourceStatus.enemy.status_effects = [{ id: 'star_guard', stacks: 1 }];
const invalidEnemyOwnedStatusResult = preflightBattleContent(invalidEnemyOwnedResourceStatus);
assert.equal(invalidEnemyOwnedStatusResult.ok, false);
assert.equal(invalidEnemyOwnedStatusResult.issues.some(issue => issue.code === 'UNKNOWN_TARGET_RESOURCE'), true);

const targetedEnemyResource = structuredClone(validResourceBattle);
targetedEnemyResource.enemies = [
  { ...structuredClone(validBattle.enemy), id: 'front', name: '前卫' },
  {
    ...structuredClone(validBattle.enemy),
    id: 'back',
    name: '后卫',
    resources: [{ id: 'stars', name: '星能', emoji: '⭐', current: 1, max: 3, refresh: 'retain' }],
  },
];
delete targetedEnemyResource.enemy;
targetedEnemyResource.cards[0].effects = {
  resource: { id: 'stars', amount: 1 },
  to: 'opponent',
  targets: { mode: 'by_id', id: 'back' },
};
assert.equal(preflightBattleContent(targetedEnemyResource).ok, true, 'by_id resource effects validate only their selected enemy');
const invalidAllEnemyResource = structuredClone(targetedEnemyResource);
invalidAllEnemyResource.cards[0].effects.targets = { mode: 'all' };
const invalidAllEnemyResourceResult = preflightBattleContent(invalidAllEnemyResource);
assert.equal(invalidAllEnemyResourceResult.ok, false);
assert.equal(invalidAllEnemyResourceResult.issues.some(issue => issue.code === 'UNKNOWN_TARGET_RESOURCE'), true);

const enemyAllySupport = structuredClone(targetedEnemyResource);
enemyAllySupport.enemies[0].actions = [{
  name: '群体支援',
  weight: 1,
  effects: [
    { block: 4, to: 'self', targets: { mode: 'all' } },
    { apply_status: 'weak', stacks: 1, to: 'self', targets: { mode: 'lowest_hp' } },
  ],
}];
const enemyAllySupportResult = preflightBattleContent(enemyAllySupport);
assert.equal(
  enemyAllySupportResult.ok,
  true,
  `enemy actions may target the enemy-side collection for ally support: ${JSON.stringify(enemyAllySupportResult.issues)}`,
);
const invalidPlayerSelfSelector = structuredClone(targetedEnemyResource);
invalidPlayerSelfSelector.cards[0].effects = { heal: 2, to: 'self', targets: { mode: 'all' } };
const invalidPlayerSelfSelectorResult = preflightBattleContent(invalidPlayerSelfSelector);
assert.equal(invalidPlayerSelfSelectorResult.ok, false);

assert.equal(
  invalidPlayerSelfSelectorResult.issues.some(issue => issue.code === 'INVALID_TARGET_SELECTOR'),
  true,
  'player self-target effects must not silently ignore an enemy collection selector',
);

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

const nestedPatch = amount => ({
  patch_card: {
    damage: { add: amount },
    scope: 'combat',
    from: 'combat',
    pick: 'all',
    template_id: 'strike',
    root_only: true,
  },
});
const legacyNestedPatchBattle = structuredClone(validBattle);
legacyNestedPatchBattle.cards[1].effects = [{ block: 6 }, nestedPatch(1)];
legacyNestedPatchBattle.cards.push({
  id: 'patch_power',
  name: '持续强化',
  type: 'Power',
  rarity: 'Uncommon',
  cost: 1,
  quantity: 1,
  trigger: { on: 'attack_played', effects: [nestedPatch(1)] },
});
legacyNestedPatchBattle.artifacts = [{
  id: 'patch_relic',
  name: '强化遗物',
  rarity: 'Common',
  trigger: { on: 'battle_start', effects: [nestedPatch(1)] },
}];
legacyNestedPatchBattle.items = [{
  id: 'patch_item',
  name: '强化道具',
  count: 1,
  effects: [{ heal: 8 }, nestedPatch(2)],
}];
legacyNestedPatchBattle.player_lust_effect = {
  name: '终极强化',
  effects: [{ damage: 35 }, nestedPatch(3)],
};
const legacyNestedPatchResult = preflightBattleContent(legacyNestedPatchBattle);
assert.equal(
  legacyNestedPatchResult.ok,
  true,
  `unambiguous nested patch_card deviations must normalize in every executable container: ${JSON.stringify(legacyNestedPatchResult.issues)}`,
);

const ambiguousNestedPatchBattle = structuredClone(validBattle);
ambiguousNestedPatchBattle.cards[1].effects = [{
  patch_card: {
    damage: { add: 1 },
    block: { add: 1 },
    from: 'combat',
    pick: 'all',
  },
}];
const ambiguousNestedPatchResult = preflightBattleContent(ambiguousNestedPatchBattle);
assert.equal(ambiguousNestedPatchResult.ok, false);
assert.ok(
  ambiguousNestedPatchResult.issues.some(issue => issue.path.includes('battle.cards[1].effects[0].patch_card')),
  JSON.stringify(ambiguousNestedPatchResult.issues),
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
keyedStatusBattle.cards[0].effects = [
  { damage: 8 },
  { apply_status: 'combo_flow', stacks: 1, to: 'self' },
];
keyedStatusBattle.cards.push({
  id: 'combo_power',
  name: '连击架势',
  type: 'Power',
  rarity: 'Uncommon',
  cost: 1,
  quantity: 1,
  effects: { apply_status: 'combo_flow', stacks: 2, to: 'self' },
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

const createSplitEnemy = () => ({
  id: 'split_child',
  name: '分裂子体',
  emoji: '🦠',
  max_hp: 12,
  hp: 12,
  max_lust: 100,
  lust: 0,
  actions: [{ name: '侵蚀', weight: 1, effects: { damage: 3 } }],
  abilities: [],
  status_effects: [],
  lust_effect: { name: '孢子爆发', effects: { damage: 2 } },
  action_mode: 'random',
  action_config: {},
  count: 2,
});

const validSplitBattle = structuredClone(validBattle);
validSplitBattle.enemy.abilities = [{
  id: 'split_on_defeat',
  name: '死亡分裂',
  trigger: 'defeated',
  effects: { spawn_enemy: createSplitEnemy() },
}];
assert.equal(
  preflightBattleContent(validSplitBattle).ok,
  true,
  JSON.stringify(preflightBattleContent(validSplitBattle).issues),
);

const invalidSplitStatusBattle = structuredClone(validSplitBattle);
invalidSplitStatusBattle.enemy.abilities[0].effects.spawn_enemy.actions[0].effects = {
  apply_status: 'missing_spawn_status',
  stacks: 1,
  to: 'opponent',
};
const invalidSplitStatusResult = preflightBattleContent(invalidSplitStatusBattle);
assert.equal(invalidSplitStatusResult.ok, false);
assert.ok(
  invalidSplitStatusResult.issues.some(issue =>
    issue.code === 'UNKNOWN_STATUS' && issue.path.includes('spawn_enemy.actions[0]')),
  JSON.stringify(invalidSplitStatusResult.issues),
);

const invalidSplitResourceBattle = structuredClone(validSplitBattle);
invalidSplitResourceBattle.enemy.abilities[0].effects.spawn_enemy.actions[0] = {
  name: '积蓄怒气',
  description: '为自身积蓄怒气。',
  weight: 1,
  effects: { resource: { id: 'rage', amount: 1 }, to: 'self' },
};
const invalidSplitResourceResult = preflightBattleContent(invalidSplitResourceBattle);
assert.equal(invalidSplitResourceResult.ok, false);
assert.ok(
  invalidSplitResourceResult.issues.some(issue =>
    issue.code === 'UNKNOWN_TARGET_RESOURCE' && issue.path.includes('spawn_enemy.actions[0]')),
  JSON.stringify(invalidSplitResourceResult.issues),
);

const validSplitResourceBattle = structuredClone(invalidSplitResourceBattle);
validSplitResourceBattle.enemy.abilities[0].effects.spawn_enemy.resources = [{
  id: 'rage', name: '怒气', emoji: '🔥', current: 0, max: 3, refresh: 'retain',
}];
assert.equal(
  preflightBattleContent(validSplitResourceBattle).ok,
  true,
  JSON.stringify(preflightBattleContent(validSplitResourceBattle).issues),
);

console.log('Strict modern battle preflight passed.');
