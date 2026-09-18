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
assert.equal(stat.battle.cards[0].quantity, 4, 'the atomically replaced stat owns the merged card stack');
assert.equal(stat.battle.items[0].count, 4, 'the atomically replaced stat owns the merged item stack');
assert.equal(strike.quantity, 2, 'atomic replacement must not mutate caller-owned card aliases');
assert.equal(potion.count, 1, 'atomic replacement must not mutate caller-owned item aliases');
assert.equal(stat.battle.artifacts[0].id, 'moon');
assert.deepEqual(stat.reward, { card: [], artifact: [], item: [], limits: {}, pool_revision: 1 });
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
assert.throws(() => rewards.applyRewardSelectionsToStat(invalid, { cards: [1], artifacts: [], items: [] }), /卡牌不属于待领取奖励/);
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

const zeroQuantityReward = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [
      {
        id: 'fresh_strike',
        name: '新生斩',
        type: 'Attack',
        rarity: 'Common',
        cost: 1,
        quantity: 0,
        effects: { damage: 6 },
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1 },
  },
};
assert.equal(
  rewards.inspectRewardCandidates(zeroQuantityReward).cards[0].ok,
  true,
  'an AI reward quantity of zero means one unclaimed card candidate',
);
assert.deepEqual(
  rewards.applyRewardSelectionsToStat(zeroQuantityReward, { cards: [0], artifacts: [], items: [] }),
  { cards: ['新生斩'], artifacts: [], items: [] },
);
assert.equal(zeroQuantityReward.battle.cards[0].quantity, 1);

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
  /(?:未注册状态|状态未注册): missing_hex/,
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
const malformedReferencedStatusCopy = structuredClone(malformedReferencedStatus);
assert.doesNotThrow(
  () => rewards.applyRewardSelectionsToStat(malformedReferencedStatusCopy, { cards: [0], artifacts: [], items: [] }),
  'reward selection resolves persistent status ids without repeating validation owned by the full battle content pass',
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

const multiStatusDefinitions = [
  {
    id: 'gift_force',
    name: '馈赠之力',
    emoji: '⚔️',
    type: 'buff',
    triggers: { hold: { modify: 'damage', add: 'stacks' } },
  },
  {
    id: 'gift_guard',
    name: '馈赠之护',
    emoji: '🛡️',
    type: 'buff',
    triggers: { hold: { modify: 'block', add: 'stacks' } },
  },
  {
    id: 'gift_focus',
    name: '馈赠之愈',
    emoji: '✨',
    type: 'buff',
    triggers: { hold: { modify: 'heal', add: 'stacks' } },
  },
];
const multiStatusReward = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [],
    artifact: [{
      id: 'threefold_gift',
      name: '三相馈赠',
      rarity: 'Rare',
      trigger: {
        on: 'battle_start',
        effects: {
          choose: 'threefold_gift_choice',
          options: multiStatusDefinitions.map((status, index) => ({
            id: `threefold_${index + 1}`,
            label: status.name,
            effects: { apply_status: status.id, stacks: 1, to: 'self' },
          })),
        },
      },
      statuses: multiStatusDefinitions,
    }],
    item: [],
    limits: { artifacts: 1 },
  },
};
assert.equal(
  rewards.applyRewardSelectionsToStat(multiStatusReward, { cards: [], artifacts: [0], items: [] }).artifacts[0],
  '三相馈赠',
);
assert.deepEqual(multiStatusReward.battle.statuses.map(status => status.id), multiStatusDefinitions.map(status => status.id));
assert.equal(multiStatusReward.battle.artifacts[0].status, undefined);
assert.equal(multiStatusReward.battle.artifacts[0].statuses, undefined, 'all support definitions are registered atomically');

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
  /候选 status 无效: 状态 hold 只能包含持续修饰或出牌规则/,
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

const persistentOwnedCopies = {
  battle: {
    core: {},
    cards: [
      { ...strike, quantity: 1, runInstanceId: 'strike__run__1', templateId: 'strike', origin: 'initial' },
      { ...strike, quantity: 1, runInstanceId: 'strike__run__2', templateId: 'strike', origin: 'initial' },
    ],
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
rewards.applyRewardSelectionsToStat(persistentOwnedCopies, { cards: [0], artifacts: [], items: [] });
assert.equal(
  persistentOwnedCopies.battle.cards.reduce((total, card) => total + Number(card.quantity || 0), 0),
  3,
  'owned-instance metadata must not create a false rule conflict',
);

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
assert.deepEqual(skipped.reward, { card: [], artifact: [], item: [], limits: {}, pool_revision: 1 });

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

const directStatusPowerRewards = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [bundledStatus] },
  reward: {
    card: [
      {
        id: 'ember_stance',
        name: '余烬架势',
        type: 'Power',
        rarity: 'Uncommon',
        cost: 1,
        quantity: 1,
        effects: { apply_status: 'ember_mark', stacks: 2 },
      },
      {
        id: 'invalid_power_strike',
        name: '错误能力打击',
        type: 'Power',
        rarity: 'Uncommon',
        cost: 1,
        quantity: 1,
        effects: { damage: 8 },
      },
    ],
    artifact: [],
    item: [],
  },
};
const directStatusPowerInspections = rewards.inspectRewardCandidates(directStatusPowerRewards).cards;
assert.equal(directStatusPowerInspections[0].ok, true, 'a Power may directly apply one registered persistent status');
assert.equal(directStatusPowerInspections[1].ok, false, 'a triggerless Power must not execute immediate damage');

const structuredTriggerRewards = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [bundledStatus] },
  reward: {
    card: [
      {
        id: 'structured_power',
        name: '结构化能力',
        type: 'Power',
        rarity: 'Uncommon',
        cost: 1,
        quantity: 1,
        effects: { block: 4 },
        trigger: { on: 'deal_damage', effects: { apply_status: 'ember_mark', stacks: 1, to: 'opponent' } },
      },
    ],
    artifact: [
      {
        id: 'structured_relic',
        name: '结构化遗物',
        rarity: 'Common',
        trigger: { on: 'passive', effects: { modify: 'block', add: 1 } },
      },
    ],
    item: [],
  },
};
const structuredTriggerInspections = rewards.inspectRewardCandidates(structuredTriggerRewards);
assert.equal(structuredTriggerInspections.cards[0].ok, true);
assert.equal(structuredTriggerInspections.artifacts[0].ok, true);

const mutablePool = {
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [{ ...strike, id: 'pool_start', name: '初始候选', quantity: 1 }],
    artifact: [],
    item: [{ ...potion, id: 'pool_potion', name: '池中药剂' }],
    limits: { cards: 1, artifacts: 1, items: 1 },
  },
};
const poolReplacement = rewards.mutateRewardPoolInStat(mutablePool, {
  kind: 'replace',
  category: 'cards',
  index: 0,
  candidate: { ...strike, id: 'pool_replacement', name: '替换候选', quantity: 1 },
});
assert.equal(poolReplacement.revision, 1);
assert.equal(mutablePool.reward.card[0].id, 'pool_replacement');
assert.equal(mutablePool.reward.pool_revision, 1);

const poolBeforeFailure = structuredClone(mutablePool);
assert.throws(
  () => rewards.mutateRewardPoolInStat(mutablePool, {
    kind: 'replace',
    category: 'cards',
    index: 0,
    candidate: { ...strike, id: 'broken_pool_card', effects: { damage: 'unknown + 1' } },
  }),
  /Unsupported variable: unknown/,
);
assert.deepEqual(mutablePool, poolBeforeFailure, 'invalid replacement must preserve candidates and pool metadata');

const rerolled = rewards.mutateRewardPoolInStat(mutablePool, {
  kind: 'reroll',
  categories: ['cards'],
  candidates: {
    cards: [
      { ...strike, id: 'reroll_a', name: '重投甲', quantity: 1 },
      { ...strike, id: 'reroll_b', name: '重投乙', quantity: 1 },
    ],
  },
});
assert.equal(rerolled.rerolls, 1);
assert.deepEqual(mutablePool.reward.card.map(card => card.id), ['reroll_a', 'reroll_b']);

const modified = rewards.mutateRewardPoolInStat(mutablePool, {
  kind: 'modify',
  category: 'cards',
  removeIndices: [0],
  add: [{ ...strike, id: 'pool_added', name: '池中新增', quantity: 1 }],
});
assert.deepEqual(mutablePool.reward.card.map(card => card.id), ['reroll_b', 'pool_added']);
assert.equal(modified.revision, 3);

const disabled = rewards.mutateRewardPoolInStat(mutablePool, {
  kind: 'disable_category',
  category: 'items',
});
assert.deepEqual(disabled.disabledCategories, ['items']);
assert.deepEqual(mutablePool.reward.item, []);
assert.equal(rewards.readRewardLimits(mutablePool).items, 0);
assert.throws(
  () => rewards.mutateRewardPoolInStat(mutablePool, {
    kind: 'modify', category: 'items', add: [{ ...potion, id: 'forbidden_item' }],
  }),
  /disabled/,
);

console.log('Atomic reward selection, stack merging, skipping, and single-card removal passed.');

// A same-template reward must not grow quantity on a persisted card identity.
{
  const { migratePersistentRunDeck } = require(resolve('src/game-core/cardProgression.ts'));
  const owned=migratePersistentRunDeck([{...strike,quantity:2}]);
  const fixture={battle:{cards:structuredClone(owned),artifacts:[],items:[]},reward:{
    card:[{...strike,quantity:1,runInstanceId:owned[1].runInstanceId}],artifact:[],item:[],limits:{cards:1,artifacts:0,items:0}}};
  rewards.applyRewardSelectionsToStat(fixture,{cards:[0],artifacts:[],items:[]});
  assert.equal(fixture.battle.cards.length,3);
  assert.deepEqual(fixture.battle.cards.slice(0,2),owned,'existing instances stay byte-equivalent');
  assert.equal(new Set(fixture.battle.cards.map(c=>c.runInstanceId)).size,3);
  assert.ok(fixture.battle.cards.every(c=>c.quantity===1));
  assert.deepEqual(migratePersistentRunDeck(JSON.parse(JSON.stringify(fixture.battle.cards))),fixture.battle.cards);
  assert.throws(()=>rewards.applyRewardSelectionsToStat(fixture,{cards:[0],artifacts:[],items:[]}));
  const mixed=[{...owned[0],quantity:2},owned[1]];
  const restored=migratePersistentRunDeck(mixed);
  assert.equal(restored.length,3);
  assert.equal(restored[0].runInstanceId,owned[0].runInstanceId);
  assert.equal(restored[2].runInstanceId,owned[1].runInstanceId,'later explicit identity is reserved');
  assert.throws(()=>migratePersistentRunDeck([owned[0],owned[0]]),/duplicate run card identity/);
  console.log('Reward acquisition reserves existing IDs, restores safely, rejects real duplicates and double claims.');
}
