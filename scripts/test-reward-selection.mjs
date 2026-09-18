import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const selection = require(resolve('src/game-core/rewardSelection.ts'));
const settlement = require(resolve('src/game-core/rewardSettlement.ts'));
const validation = require(resolve('src/game-core/rewardCandidateValidation.ts'));

const counts = { cards: 3, artifacts: 2, items: 1 };
const limits = { cards: 1, artifacts: 1, items: 1 };

assert.deepEqual(
  selection.validateRewardSelections({ cards: [2, 2], artifacts: [], items: [0] }, counts, limits),
  { cards: [2], artifacts: [], items: [0] },
  'duplicate UI indices must be normalized once before pricing or persistence',
);

for (const value of [
  { cards: [0], artifacts: [], items: [], extra: [] },
  { cards: [3], artifacts: [], items: [] },
  { cards: [0, 1], artifacts: [], items: [] },
  { cards: [0], artifacts: [], items: '0' },
]) {
  assert.throws(
    () => selection.validateRewardSelections(value, counts, limits),
    /奖励选择失败/,
    `malformed selection must be rejected: ${JSON.stringify(value)}`,
  );
}

assert.throws(
  () => selection.validateRewardSelections({ cards: [], artifacts: [], items: [] }, counts, { ...limits, cards: -1 }),
  /可选数量无效/,
);

const candidate = {
  id: 'ember_guard',
  name: '余烬守护',
  type: 'Skill',
  rarity: 'Common',
  cost: 1,
  quantity: 1,
  effects: [{ block: 6 }],
};
assert.equal(
  validation.validateRewardCandidate('cards', {
    ...candidate,
    id: 'ember_guard_exhaust',
    effects: [{ block: 6 }, { card_destination: 'exhaust' }],
  }).ok,
  true,
  'reward validation must allow a card main effect to choose its own post-play destination',
);
const plan = settlement.planRewardSelections({
  selections: { cards: [0], artifacts: [], items: [] },
  candidates: { cards: [candidate], artifacts: [], items: [] },
  existing: { cards: [], artifacts: [], items: [] },
  statusDefinitions: [],
  limits: { cards: 1, artifacts: 0, items: 0 },
});
assert.deepEqual(plan.summary, { cards: ['余烬守护'], artifacts: [], items: [] });
assert.equal(plan.entries[0].value === candidate, false, 'portable reward plans must clone selected values');

const resourceCard = {
  ...candidate,
  id: 'star_burst',
  name: '星辉迸发',
  cost: { stars: 1 },
  effects: { damage: 'spent_resource.stars * 5' },
};
assert.equal(
  validation.validateRewardCandidateAgainstLibrary('cards', resourceCard, { knownResourceIds: ['stars'] }).ok,
  true,
);
assert.match(
  validation.validateRewardCandidateAgainstLibrary('cards', resourceCard, { knownResourceIds: [] }).message,
  /未注册资源/,
);
const illegalXFormula = { ...resourceCard, id: 'bad_star_x', cost: { stars: 1 }, effects: { damage: 'x_resource.stars * 5' } };
assert.match(validation.validateRewardCandidate('cards', illegalXFormula).message, /没有资源 stars 的 X 费用/);
const illegalDiscardX = {
  ...resourceCard,
  id: 'bad_discard_x',
  discard_effects: { block: 'x_resource.stars * 2' },
};
assert.match(validation.validateRewardCandidate('cards', illegalDiscardX).message, /discard_effects/);
const unknownResourceItem = {
  id: 'void_tonic', name: '虚空药剂', count: 1, effects: { resource: { id: 'void', amount: 1 } },
};
assert.match(
  validation.validateRewardCandidateAgainstLibrary('items', unknownResourceItem, { knownResourceIds: ['stars'] }).message,
  /未注册资源/,
);
const artifactWithGeneratedCard = {
  id: 'mirror_matrix',
  name: '镜像矩阵',
  rarity: 'Uncommon',
  trigger: { on: 'battle_start', effects: { add_card: 'mirror_etch' } },
  creates: [{
    id: 'mirror_etch', name: '镜像刻印', type: 'Skill', rarity: 'Common', cost: 0, effects: { draw: 1 },
  }],
};
assert.equal(
  validation.validateRewardCandidate('artifacts', artifactWithGeneratedCard).ok,
  true,
  'artifact reward effects must resolve templates from that artifact own creates list',
);
assert.equal(
  validation.validateRewardCandidate('items', {
    id: 'mirror_capsule',
    name: '镜像胶囊',
    count: 1,
    effects: { add_card: 'capsule_echo' },
    creates: [{
      id: 'capsule_echo', name: '胶囊回响', type: 'Skill', rarity: 'Common', cost: 0, effects: { block: 3 },
    }],
  }).ok,
  true,
  'item reward effects must resolve templates from that item own creates list',
);

const multiplyMalformedReward = validation.validateRewardCandidateAgainstLibrary('cards', {
  id: 'shattered_mirror',
  name: '碎镜诅咒',
  type: 'Curse',
  rarity: 'Common',
  cost: 0,
  quantity: 1,
  effects: [{ damage: 2, to: 'self' }, { draw: 1, to: 'self' }],
}, { statusDefinitions: [] });
assert.equal(multiplyMalformedReward.ok, false);
assert.match(multiplyMalformedReward.message, /Curse cards cannot contain cost/);
assert.match(multiplyMalformedReward.message, /Unknown field: to/);

const inertCurseReward = {
  id: 'sealed_reward',
  name: '封印残片',
  type: 'Curse',
  rarity: 'Corrupt',
  quantity: 1,
  description: '无法被打出，只会占据手牌位置。',
};
assert.equal(
  validation.validateRewardCandidateAgainstLibrary('cards', inertCurseReward, { statusDefinitions: [] }).ok,
  true,
  'reward candidates may contain a deliberately inert Curse without invented effects',
);
assert.equal(
  validation.validateRewardCandidate('cards', {
    ...inertCurseReward,
    id: 'false_story_reward',
    effects: { narrate: '非法叙事占位。' },
  }).ok,
  false,
  'explicit invalid Curse effects cannot bypass reward validation',
);

const candidateUsingExistingStatus = {
  ...candidate,
  id: 'existing_status_reward',
  effects: { apply_status: 'existing_status', stacks: 1, to: 'opponent' },
};
const malformedExistingStatus = {
  id: 'existing_status',
  name: 'Existing status',
  emoji: 'x',
  type: 'debuff',
  triggers: { tick: { damage: 1, unsupported_global_field: true } },
};
assert.deepEqual(
  validation.collectRewardCandidateContractIssues('cards', candidateUsingExistingStatus, {
    statusDefinitions: [malformedExistingStatus],
  }),
  [],
  'an isolated reward candidate must resolve an existing status id without duplicating unrelated library-definition errors',
);
assert.equal(
  validation.validateRewardCandidateAgainstLibrary('cards', candidateUsingExistingStatus, {
    statusDefinitions: [malformedExistingStatus],
  }).ok,
  true,
  'the persistent status table owns validation of its definitions; reward candidates only validate references',
);
const validExistingStatus = {
  id: 'existing_status',
  name: 'Existing status',
  emoji: 'x',
  type: 'debuff',
  triggers: { tick: { damage: 1 } },
};
const redundantSupportStatus = {
  ...candidateUsingExistingStatus,
  status: structuredClone(validExistingStatus),
};
assert.equal(
  validation.validateRewardCandidateAgainstLibrary('cards', redundantSupportStatus, {
    statusDefinitions: [validExistingStatus],
  }).ok,
  true,
  'an identical candidate status wrapper is redundant but does not change executable semantics',
);
const singletonArraySupportStatus = structuredClone(redundantSupportStatus);
singletonArraySupportStatus.status.triggers.tick = [{ damage: 1 }];
assert.equal(
  validation.validateRewardCandidateAgainstLibrary('cards', singletonArraySupportStatus, {
    statusDefinitions: [validExistingStatus],
  }).ok,
  true,
  'one shallow trigger object and a singleton effect list are the same executable status rule',
);
const conflictingSupportStatus = structuredClone(redundantSupportStatus);
conflictingSupportStatus.status.triggers = { tick: { damage: 2 } };
const conflictingSupportValidation = validation.validateRewardCandidateAgainstLibrary('cards', conflictingSupportStatus, {
  statusDefinitions: [validExistingStatus],
});
assert.equal(conflictingSupportValidation.ok, false);
assert.match(conflictingSupportValidation.message, /规则不同/);
const redundantSupportPlan = settlement.planRewardSelections({
  selections: { cards: [0], artifacts: [], items: [] },
  candidates: { cards: [redundantSupportStatus], artifacts: [], items: [] },
  existing: { cards: [], artifacts: [], items: [] },
  statusDefinitions: [validExistingStatus],
  limits: { cards: 1, artifacts: 0, items: 0 },
});
assert.deepEqual(redundantSupportPlan.statuses, []);
assert.equal(redundantSupportPlan.entries[0].value.status, undefined);

const luckyStatuses = [
  {
    id: 'lucky_strength',
    name: '幸运强攻',
    emoji: '⚔️',
    type: 'buff',
    stacks_change: 'keep',
    triggers: { hold: { modify: 'damage', add: 'stacks' } },
  },
  {
    id: 'lucky_guard',
    name: '幸运守势',
    emoji: '🛡️',
    type: 'buff',
    stacks_change: 'keep',
    triggers: { hold: { modify: 'block', add: 'stacks' } },
  },
  {
    id: 'lucky_focus',
    name: '幸运专注',
    emoji: '✨',
    type: 'buff',
    stacks_change: 'keep',
    triggers: { hold: { modify: 'heal', add: 'stacks' } },
  },
];
const luckyArtifact = {
  id: 'lucky_clover',
  name: '幸运四叶草',
  rarity: 'Rare',
  trigger: {
    on: 'battle_start',
    effects: {
      choose: 'choose_lucky_buff',
      options: luckyStatuses.map((status, index) => ({
        id: `lucky_option_${index + 1}`,
        label: status.name,
        effects: { apply_status: status.id, stacks: 2, to: 'self' },
      })),
    },
  },
  statuses: luckyStatuses,
};
const layeredInvalidSupport = structuredClone(luckyArtifact);
layeredInvalidSupport.id = 'layered_invalid_support';
layeredInvalidSupport.statuses = [{
  id: 'haste',
  name: '急速',
  emoji: '⚡',
  type: 'buff',
  description: '每层使召唤物额外行动一次，回合结束时减少一层。',
  stacks_change: '-1',
  triggers: { hold: { modify: 'actions_per_activation', add: 1 } },
}];
layeredInvalidSupport.trigger.effects = {
  apply_summon_status: { selector: { owner: 'self', pick: 'random' }, id: 'haste', stacks: 2 },
};
const layeredSupportResult = validation.readRewardCandidateSupportStatuses(layeredInvalidSupport);
assert.equal(layeredSupportResult.ok, false);
assert.match(layeredSupportResult.message, /状态 stacks_change 无效/);
assert.match(layeredSupportResult.message, /triggers\.hold\.modify: Unsupported modifier: actions_per_activation/);
assert.equal(
  validation.validateRewardCandidateAgainstLibrary('artifacts', luckyArtifact, { statusDefinitions: [] }).ok,
  true,
  'one reward artifact may close several independently referenced new statuses',
);
const luckyPlan = settlement.planRewardSelections({
  selections: { cards: [], artifacts: [0], items: [] },
  candidates: { cards: [], artifacts: [luckyArtifact], items: [] },
  existing: { cards: [], artifacts: [], items: [] },
  statusDefinitions: [],
  limits: { cards: 0, artifacts: 1, items: 0 },
});
assert.deepEqual(luckyPlan.statuses.map(status => status.id), luckyStatuses.map(status => status.id));
assert.equal(luckyPlan.entries[0].value.status, undefined);
assert.equal(luckyPlan.entries[0].value.statuses, undefined, 'support status envelopes are never persisted as relic rules');

const duplicateLuckyStatus = structuredClone(luckyArtifact);
duplicateLuckyStatus.id = 'lucky_clover_duplicate_same';
duplicateLuckyStatus.statuses = [luckyStatuses[0], structuredClone(luckyStatuses[0])];
duplicateLuckyStatus.trigger.effects.options = [duplicateLuckyStatus.trigger.effects.options[0], {
  id: 'lucky_option_repeat',
  label: '仍是幸运强攻',
  effects: { apply_status: luckyStatuses[0].id, stacks: 1, to: 'self' },
}];
const duplicateLuckyPlan = settlement.planRewardSelections({
  selections: { cards: [], artifacts: [0], items: [] },
  candidates: { cards: [], artifacts: [duplicateLuckyStatus], items: [] },
  existing: { cards: [], artifacts: [], items: [] },
  statusDefinitions: [],
  limits: { cards: 0, artifacts: 1, items: 0 },
});
assert.deepEqual(duplicateLuckyPlan.statuses.map(status => status.id), ['lucky_strength']);

const conflictingLuckyStatus = structuredClone(duplicateLuckyStatus);
conflictingLuckyStatus.id = 'lucky_clover_duplicate_conflict';
conflictingLuckyStatus.statuses[1].triggers.hold = { modify: 'damage', add: 9 };
assert.match(
  validation.validateRewardCandidateAgainstLibrary('artifacts', conflictingLuckyStatus, { statusDefinitions: [] }).message,
  /重复但规则不同/,
);

const unusedLuckyStatus = structuredClone(luckyArtifact);
unusedLuckyStatus.id = 'lucky_clover_unused_status';
unusedLuckyStatus.statuses.push({
  id: 'unused_lucky_status',
  name: '未使用幸运',
  emoji: '◇',
  type: 'buff',
  triggers: { hold: { modify: 'damage', add: 1 } },
});
assert.match(
  validation.validateRewardCandidateAgainstLibrary('artifacts', unusedLuckyStatus, { statusDefinitions: [] }).message,
  /未被该候选引用: unused_lucky_status/,
);

const chainedStatusReward = {
  ...candidate,
  id: 'linked_status_reward',
  effects: { apply_status: 'linked_status_root', stacks: 1, to: 'self' },
  statuses: [
    {
      id: 'linked_status_root', name: '联结起点', emoji: '①', type: 'buff',
      triggers: { apply: { apply_status: 'linked_status_payoff', stacks: 1, to: 'self' } },
    },
    {
      id: 'linked_status_payoff', name: '联结收益', emoji: '②', type: 'buff',
      triggers: { hold: { modify: 'block', add: 'stacks' } },
    },
  ],
};
assert.equal(
  validation.validateRewardCandidateAgainstLibrary('cards', chainedStatusReward, { statusDefinitions: [] }).ok,
  true,
  'candidate-owned status definitions may close dependencies through other local status definitions',
);

const summonStatusReward = {
  ...candidate,
  id: 'summon_status_reward',
  effects: {
    apply_summon_status: {
      selector: { owner: 'self', pick: 'choose' },
      id: 'summon_haste',
      stacks: 2,
    },
  },
  statuses: [
    {
      id: 'summon_haste', name: '召唤迅捷', emoji: '⚡', type: 'buff',
      triggers: { turn_end: { activate_summon: { selector: { owner: 'self', pick: 'first' } } } },
      stacks_change: -1,
    },
  ],
};
assert.equal(
  validation.validateRewardCandidateAgainstLibrary('cards', summonStatusReward, { statusDefinitions: [] }).ok,
  true,
  'summon-only apply_summon_status references keep their candidate-owned status reachable',
);

const chainedSummonStatusReward = structuredClone(summonStatusReward);
chainedSummonStatusReward.id = 'chained_summon_status_reward';
chainedSummonStatusReward.effects.apply_summon_status.id = 'summon_status_root';
chainedSummonStatusReward.statuses = [
  {
    id: 'summon_status_root', name: '召唤联结起点', emoji: '①', type: 'buff',
    triggers: { apply: { apply_summon_status: {
      selector: { owner: 'self', pick: 'choose' }, id: 'summon_status_payoff', stacks: 1,
    } } },
  },
  {
    id: 'summon_status_payoff', name: '召唤联结收益', emoji: '②', type: 'buff',
    triggers: { turn_end: { activate_summon: { selector: { owner: 'self', pick: 'first' } } } },
  },
];
assert.equal(
  validation.validateRewardCandidateAgainstLibrary('cards', chainedSummonStatusReward, { statusDefinitions: [] }).ok,
  true,
  'candidate-owned summon status dependency chains remain reachable through compiled summon status operations',
);
const incompleteStatusChain = structuredClone(chainedStatusReward);
incompleteStatusChain.id = 'incomplete_linked_status_reward';
incompleteStatusChain.statuses.pop();
assert.match(
  validation.validateRewardCandidateAgainstLibrary('cards', incompleteStatusChain, { statusDefinitions: [] }).message,
  /(?:未注册状态|unregistered status): linked_status_payoff/,
);

const existingLuckyPlan = settlement.planRewardSelections({
  selections: { cards: [], artifacts: [0], items: [] },
  candidates: {
    cards: [],
    artifacts: [{
      ...structuredClone(luckyArtifact),
      id: 'lucky_clover_existing_status',
      trigger: {
        on: 'battle_start',
        effects: { apply_status: luckyStatuses[0].id, stacks: 1, to: 'self' },
      },
      statuses: [structuredClone(luckyStatuses[0])],
    }],
    items: [],
  },
  existing: { cards: [], artifacts: [], items: [] },
  statusDefinitions: [structuredClone(luckyStatuses[0])],
  limits: { cards: 0, artifacts: 1, items: 0 },
});
assert.deepEqual(existingLuckyPlan.statuses, [], 'an identical global status definition is reused rather than registered twice');

const conflictingGlobalLucky = structuredClone(luckyArtifact);
conflictingGlobalLucky.id = 'lucky_clover_global_conflict';
conflictingGlobalLucky.statuses = [structuredClone(luckyStatuses[0])];
conflictingGlobalLucky.trigger.effects = { apply_status: luckyStatuses[0].id, stacks: 1, to: 'self' };
const conflictingGlobalDefinition = structuredClone(luckyStatuses[0]);
conflictingGlobalDefinition.triggers.hold = { modify: 'damage', add: 4 };
assert.match(
  validation.validateRewardCandidateAgainstLibrary('artifacts', conflictingGlobalLucky, {
    statusDefinitions: [conflictingGlobalDefinition],
  }).message,
  /规则不同/,
);

const passivePowerReward = {
  id: 'summon_capacity_core',
  name: '机甲核心',
  type: 'Power',
  rarity: 'Rare',
  cost: 1,
  quantity: 1,
  trigger: {
    on: 'passive',
    effects: [{ modify: 'summon_capacity', add: 1 }],
  },
};
assert.equal(
  validation.validateRewardCandidate('cards', passivePowerReward).ok,
  true,
  'a root passive trigger must be admitted before its nested modifier-only body is checked',
);
assert.equal(
  validation.validateRewardCandidate('cards', {
    ...passivePowerReward,
    id: 'charged_summon_capacity_core',
    effects: { energy: 1 },
    trigger: {
      on: 'passive',
      effects: { card_rule: 'replay', limit: 1, extra: 1, card_type: 'Skill' },
    },
  }).ok,
  true,
  'a Power reward may combine one immediate on-play effect with a nested passive card rule',
);
assert.match(
  validation.validateRewardCandidate('cards', {
    ...passivePowerReward,
    id: 'invalid_passive_energy',
    trigger: { on: 'passive', effects: [{ energy: 1 }] },
  }).message,
  /passive 与状态 hold 只能包含持续修饰或出牌规则/,
);

const poolSource = {
  candidates: {
    cards: [{ ...candidate, id: 'pool_a', name: '候选甲' }],
    artifacts: [{ id: 'pool_relic', name: '池中遗物' }],
    items: [{ id: 'pool_item', name: '池中道具' }],
  },
  revision: 2,
  rerolls: 1,
};
const replacedPool = settlement.planRewardPoolMutation(poolSource, {
  kind: 'replace',
  category: 'cards',
  index: 0,
  candidate: { ...candidate, id: 'pool_b', name: '候选乙' },
});
assert.equal(replacedPool.candidates.cards[0].id, 'pool_b');
assert.equal(replacedPool.revision, 3);
assert.equal(poolSource.candidates.cards[0].id, 'pool_a', 'reward pool plans must not mutate source candidates');

const rerolledPool = settlement.planRewardPoolMutation(replacedPool, {
  kind: 'reroll',
  categories: ['cards', 'items'],
  candidates: {
    cards: [{ ...candidate, id: 'pool_c', name: '候选丙' }],
    items: [],
  },
});
assert.equal(rerolledPool.rerolls, 2);
assert.deepEqual(rerolledPool.changedCategories, ['cards', 'items']);
assert.equal(rerolledPool.candidates.artifacts[0].id, 'pool_relic');

const disabledPool = settlement.planRewardPoolMutation(rerolledPool, {
  kind: 'disable_category',
  category: 'artifacts',
});
assert.deepEqual(disabledPool.disabledCategories, ['artifacts']);
assert.deepEqual(disabledPool.candidates.artifacts, []);
assert.throws(
  () => settlement.planRewardPoolMutation(disabledPool, {
    kind: 'modify', category: 'artifacts', add: [{ id: 'forbidden' }],
  }),
  /disabled/,
);

const modifiedPool = settlement.planRewardPoolMutation(disabledPool, {
  kind: 'modify',
  category: 'cards',
  removeIndices: [0],
  add: [{ ...candidate, id: 'pool_d', name: '候选丁' }],
});
assert.deepEqual(modifiedPool.candidates.cards.map(card => card.id), ['pool_d']);
assert.throws(
  () => settlement.planRewardPoolMutation(modifiedPool, {
    kind: 'replace', category: 'cards', index: 9, candidate,
  }),
  /index is invalid/,
);

console.log('Portable reward selection contract normalizes UI indices and rejects malformed payloads.');
