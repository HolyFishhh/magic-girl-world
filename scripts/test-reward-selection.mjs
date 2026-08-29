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
