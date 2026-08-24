import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const selection = require(resolve('src/game-core/rewardSelection.ts'));
const settlement = require(resolve('src/game-core/rewardSettlement.ts'));

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

console.log('Portable reward selection contract normalizes UI indices and rejects malformed payloads.');
