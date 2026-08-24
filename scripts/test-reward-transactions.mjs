import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const rewards = require(resolve('src/common/rewardTransactions.ts'));

const strike = {
  id: 'strike',
  name: '斩击',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  quantity: 2,
  effects: [{ damage: 6 }],
};
const potion = { id: 'potion', name: '药剂', count: 1, effects: [{ heal: 5 }] };
const stat = {
  battle: {
    core: { card_removal_count: 2 },
    cards: [strike],
    artifacts: [],
    items: [potion],
  },
  reward: {
    card: [
      {
        id: 'strike',
        name: '斩击',
        type: 'Attack',
        rarity: 'Common',
        cost: 1,
        quantity: 2,
        effects: [{ damage: 6 }],
      },
    ],
    artifact: [{ id: 'moon', name: '月轮', trigger: 'battle_start', effects: [{ block: 2 }] }],
    item: [{ id: 'potion', name: '药剂', count: 3, effects: [{ heal: 5 }] }],
    limits: { cards: 1, artifacts: 1, items: 1 },
  },
};

assert.deepEqual(rewards.readRewardLimits(stat), { cards: 1, artifacts: 1, items: 1 });
assert.equal(rewards.hasSelectableRewards(stat), true);
assert.deepEqual(rewards.normalizeMvuList(stat.reward.card), [
  { id: 'strike', name: '斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 2, effects: [{ damage: 6 }] },
]);
assert.deepEqual(rewards.applyRewardSelectionsToStat(stat, { cards: [0], artifacts: [0], items: [0] }), {
  cards: ['斩击 x2'],
  artifacts: ['月轮'],
  items: ['药剂 x3'],
});
assert.equal(strike.quantity, 4);
assert.equal(potion.count, 4);
assert.equal(stat.battle.artifacts[0].id, 'moon');
assert.deepEqual(stat.reward, { card: [], artifact: [], item: [], limits: {} });
assert.equal(rewards.hasSelectableRewards(stat), false);

const invalid = {
  battle: { core: { card_removal_count: 1 }, cards: [], artifacts: [], items: [] },
  reward: {
    card: [{ id: 'guard', name: '防御', quantity: 1 }],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
const invalidBefore = structuredClone(invalid);
assert.throws(() => rewards.applyRewardSelectionsToStat(invalid, { cards: [1], artifacts: [], items: [] }), /索引无效/);
assert.deepEqual(invalid, invalidBefore, 'invalid selection must not partially mutate MUV data');

const malformedReward = {
  battle: { core: { card_removal_count: 1 }, cards: [], artifacts: [], items: [] },
  reward: {
    card: [
      { id: 'broken', name: '坏牌', type: 'Attack', rarity: 'Common', cost: 1, effects: [{ damage: 'unknown + 1' }] },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
const malformedBefore = structuredClone(malformedReward);
const malformedInspections = rewards.inspectRewardCandidates(malformedReward);
assert.equal(malformedInspections.cards[0].ok, false);
assert.match(malformedInspections.cards[0].message, /unknown/);
assert.deepEqual(malformedInspections.artifacts, []);
assert.deepEqual(malformedInspections.items, []);
assert.throws(
  () => rewards.applyRewardSelectionsToStat(malformedReward, { cards: [0], artifacts: [], items: [] }),
  /奖励 坏牌 无效/,
);
assert.deepEqual(malformedReward, malformedBefore, 'invalid generated rewards must never enter the persistent deck');

const mixedReward = structuredClone(malformedReward);
mixedReward.reward.card.push({
  id: 'valid_guard',
  name: '可靠守势',
  type: 'Skill',
  rarity: 'Common',
  cost: 1,
  quantity: 1,
  effects: { block: 7 },
});
assert.deepEqual(
  rewards.inspectRewardCandidates(mixedReward).cards.map(result => result.ok),
  [false, true],
  'one malformed AI candidate must not make valid siblings unavailable',
);

const missingStatusReward = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [
      {
        id: 'hex',
        name: '咒印',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        effects: [{ apply_status: 'missing_hex' }],
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
const missingStatusBefore = structuredClone(missingStatusReward);
assert.throws(
  () => rewards.applyRewardSelectionsToStat(missingStatusReward, { cards: [0], artifacts: [], items: [] }),
  /未注册状态: missing_hex/,
);
assert.deepEqual(missingStatusReward, missingStatusBefore);

const malformedReferencedStatus = {
  battle: {
    core: {},
    cards: [],
    artifacts: [],
    items: [],
    statuses: [
      {
        id: 'broken_hex',
        name: '破损咒印',
        emoji: 'X',
        description: '错误定义。',
        type: 'debuff',
        stacks_change: -1,
        triggers: { hold: [{ damage: 2 }] },
      },
    ],
  },
  reward: {
    card: [
      {
        id: 'hex_two',
        name: '咒印二',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        effects: [{ apply_status: 'broken_hex' }],
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
assert.throws(
  () => rewards.applyRewardSelectionsToStat(malformedReferencedStatus, { cards: [0], artifacts: [], items: [] }),
  /状态 broken_hex 无效: 状态 hold 只能包含 modify/,
);

const validReferencedStatus = structuredClone(malformedReferencedStatus);
validReferencedStatus.battle.statuses[0].triggers = { tick: [{ damage: 'stacks', to: 'self' }] };
assert.equal(
  rewards.applyRewardSelectionsToStat(validReferencedStatus, { cards: [0], artifacts: [], items: [] }).cards[0],
  '咒印二',
);

const bundledStatus = {
  id: 'ember_mark',
  name: '余烬印记',
  emoji: 'E',
  description: '回合末受到等于层数的伤害，然后减少1层。',
  type: 'debuff',
  stacks_change: -1,
  maxStacks: 9,
  triggers: { tick: [{ damage: 'stacks', to: 'self' }] },
};
const bundledStatusReward = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [
      {
        id: 'ember_card',
        name: '余烬刻印',
        type: 'Skill',
        rarity: 'Uncommon',
        cost: 1,
        quantity: 1,
        description: '施加2层余烬印记。',
        effects: [{ apply_status: 'ember_mark', stacks: 2 }],
        status: bundledStatus,
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
assert.equal(
  rewards.applyRewardSelectionsToStat(bundledStatusReward, { cards: [0], artifacts: [], items: [] }).cards[0],
  '余烬刻印',
);
assert.equal(bundledStatusReward.battle.statuses[0].id, 'ember_mark');
assert.equal(
  bundledStatusReward.battle.cards[0].status,
  undefined,
  'support status must not remain on persistent content',
);

const skippedBundledStatus = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [
      {
        id: 'skip_ember',
        name: '跳过余烬',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        description: '施加1层余烬印记。',
        effects: [{ apply_status: 'ember_mark' }],
        status: bundledStatus,
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
rewards.applyRewardSelectionsToStat(skippedBundledStatus, { cards: [], artifacts: [], items: [] });
assert.deepEqual(skippedBundledStatus.battle.statuses, [], 'unselected support statuses must not pollute the library');

const invalidBundledStatus = structuredClone(bundledStatusReward);
invalidBundledStatus.battle.cards = [];
invalidBundledStatus.battle.statuses = [];
invalidBundledStatus.reward.card = [
  {
    id: 'bad_ember',
    name: '坏余烬',
    type: 'Skill',
    rarity: 'Common',
    cost: 1,
    quantity: 1,
    description: '施加余烬。',
    effects: [{ apply_status: 'bad_ember_mark' }],
    status: { ...bundledStatus, id: 'bad_ember_mark', triggers: { hold: [{ damage: 2 }] } },
  },
];
const invalidBundledStatusBefore = structuredClone(invalidBundledStatus);
assert.throws(
  () => rewards.applyRewardSelectionsToStat(invalidBundledStatus, { cards: [0], artifacts: [], items: [] }),
  /候选 status 无效: 状态 hold 只能包含 modify/,
);
assert.deepEqual(
  invalidBundledStatus,
  invalidBundledStatusBefore,
  'bad support statuses must roll back the whole reward',
);

const unusedBundledStatus = structuredClone(invalidBundledStatus);
unusedBundledStatus.reward.card[0] = {
  id: 'plain_guard',
  name: '普通防御',
  type: 'Skill',
  rarity: 'Common',
  cost: 1,
  quantity: 1,
  description: '获得5点格挡。',
  effects: [{ block: 5 }],
  status: bundledStatus,
};
assert.throws(
  () => rewards.applyRewardSelectionsToStat(unusedBundledStatus, { cards: [0], artifacts: [], items: [] }),
  /未被该候选引用/,
);

const duplicateBundledStatuses = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [
      {
        id: 'ember_a',
        name: '余烬甲',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        effects: [{ apply_status: 'ember_mark' }],
        status: bundledStatus,
      },
      {
        id: 'ember_b',
        name: '余烬乙',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        effects: [{ apply_status: 'ember_mark', stacks: 2 }],
        status: bundledStatus,
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 2 },
  },
};
rewards.applyRewardSelectionsToStat(duplicateBundledStatuses, { cards: [0, 1], artifacts: [], items: [] });
assert.equal(duplicateBundledStatuses.battle.statuses.length, 1, 'identical support definitions register once');
assert.equal(duplicateBundledStatuses.battle.cards.length, 2);

const mechanicalDuplicateRewards = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [
      { ...strike, id: 'sun_strike', name: '日耀斩', quantity: 1 },
      { ...strike, id: 'moon_strike', name: '月辉斩', emoji: 'M', description: '换名的相同规则。', quantity: 1 },
    ],
    artifact: [],
    item: [],
    limits: { cards: 2 },
  },
};
const narrativeVariants = rewards.applyRewardSelectionsToStat(mechanicalDuplicateRewards, {
  cards: [0, 1],
  artifacts: [],
  items: [],
});
assert.deepEqual(narrativeVariants.cards, ['日耀斩', '月辉斩']);
assert.deepEqual(
  mechanicalDuplicateRewards.battle.cards.map(card => card.id),
  ['sun_strike', 'moon_strike'],
  'different narrative identities may intentionally share mechanics',
);

const conflictingIdReward = {
  battle: { core: {}, cards: [strike], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [{ ...strike, quantity: 1, effects: [{ damage: 99 }] }],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
const conflictingIdBefore = structuredClone(conflictingIdReward);
assert.throws(
  () => rewards.applyRewardSelectionsToStat(conflictingIdReward, { cards: [0], artifacts: [], items: [] }),
  /规则不同，请使用新 ID/,
);
assert.deepEqual(conflictingIdReward, conflictingIdBefore);

const ownedMechanicalDuplicateReward = {
  battle: { core: {}, cards: [strike], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [{ ...strike, id: 'moon_strike', name: '月辉斩', effects: [{ to: 'opponent', damage: 6 }] }],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
rewards.applyRewardSelectionsToStat(ownedMechanicalDuplicateReward, { cards: [0], artifacts: [], items: [] });
assert.deepEqual(
  ownedMechanicalDuplicateReward.battle.cards.map(card => card.id),
  ['strike', 'moon_strike'],
  'later narrative variants remain valid permanent content',
);

const describedStack = {
  battle: {
    core: {},
    cards: [{ ...strike, quantity: 2, description: '旧手写描述。' }],
    artifacts: [],
    items: [],
    statuses: [],
  },
  reward: {
    card: [{ ...strike, quantity: 1 }],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
rewards.applyRewardSelectionsToStat(describedStack, { cards: [0], artifacts: [], items: [] });
assert.equal(describedStack.battle.cards[0].quantity, 3, 'descriptions must not split identical card rules');

const conflictingSelectedRewards = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [
      { ...strike, quantity: 1 },
      { ...strike, quantity: 1, effects: [{ damage: 99 }] },
    ],
    artifact: [],
    item: [],
    limits: { cards: 2 },
  },
};
const conflictingSelectedBefore = structuredClone(conflictingSelectedRewards);
assert.throws(
  () => rewards.applyRewardSelectionsToStat(conflictingSelectedRewards, { cards: [0, 1], artifacts: [], items: [] }),
  /规则不同，请使用新 ID/,
);
assert.deepEqual(conflictingSelectedRewards, conflictingSelectedBefore, 'same-batch ID conflicts must remain atomic');

const duplicateRelicReward = {
  battle: {
    core: {},
    cards: [],
    items: [],
    statuses: [],
    artifacts: [{ id: 'moon', name: '月轮', trigger: 'battle_start', effects: [{ block: 2 }] }],
  },
  reward: {
    card: [],
    artifact: [{ id: 'moon', name: '月轮', trigger: 'battle_start', effects: [{ block: 2 }] }],
    item: [],
    limits: { artifacts: 1 },
  },
};
assert.throws(
  () => rewards.applyRewardSelectionsToStat(duplicateRelicReward, { cards: [], artifacts: [0], items: [] }),
  /遗物已持有/,
);

const narrativeRelicVariants = {
  battle: {
    core: {}, cards: [], items: [], statuses: [],
    artifacts: [{ id: 'life_stone', name: '生命之石', trigger: 'battle_start', effects: [{ block: 5 }] }],
  },
  reward: {
    card: [],
    artifact: [{ id: 'life_root', name: '生命之根', trigger: 'battle_start', effects: [{ block: 5 }] }],
    item: [],
    limits: { artifacts: 1 },
  },
};
rewards.applyRewardSelectionsToStat(narrativeRelicVariants, { cards: [], artifacts: [0], items: [] });
assert.deepEqual(narrativeRelicVariants.battle.artifacts.map(relic => relic.id), ['life_stone', 'life_root']);

const skipped = structuredClone(invalid);
assert.deepEqual(rewards.applyRewardSelectionsToStat(skipped, { cards: [], artifacts: [], items: [] }), {
  cards: [],
  artifacts: [],
  items: [],
});
assert.deepEqual(skipped.reward, { card: [], artifact: [], item: [], limits: {} });

const deck = {
  core: { card_removal_count: 2 },
  cards: [
    { id: 'duplicate', name: '重复卡', quantity: 2 },
    { id: 'duplicate', name: '重复项', quantity: 1 },
  ],
};
assert.deepEqual(rewards.removeOneCardFromBattleDeck(deck, 'duplicate'), {
  cardName: '重复卡',
  remainingQuantity: 1,
  remainingRemovals: 1,
});
assert.equal(deck.cards[0].quantity, 1);
assert.equal(deck.cards.length, 2, 'one action must never remove multiple matching records');

const noAllowance = { core: { card_removal_count: 0 }, cards: [{ id: 'guard', name: '防御', quantity: 1 }] };
const noAllowanceBefore = structuredClone(noAllowance);
assert.throws(() => rewards.removeOneCardFromBattleDeck(noAllowance, 'guard'), /次数不足/);
assert.deepEqual(noAllowance, noAllowanceBefore);

console.log('Atomic reward selection, stack merging, skipping, and single-card removal passed.');
