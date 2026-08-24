import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const guide = (cards, player = { hp: 80, maxHp: 80 }, extras = {}) => {
  const pack = core.createContentPack({ cards, ...extras });
  const budget = core.summarizeBuildBudget(pack, player);
  return core.recommendBuildGuidance(pack, budget);
};

const basic = guide([
  { id: 'strike', quantity: 5, effects: [{ damage: 8 }] },
  { id: 'guard', quantity: 5, effects: [{ block: 6 }] },
]);
assert.equal(basic.need, '抽牌');
assert.equal(basic.synergy, null);
assert.equal(core.formatBuildGuidance(basic), 'need=抽牌 roles=补短板(抽牌),立主轴,转方向');

assert.equal(guide([{ id: 'weak', quantity: 10, effects: [{ block: 2 }] }]).need, '输出');
assert.equal(guide([{ id: 'glass', quantity: 10, effects: [{ damage: 8 }] }]).need, '防御');
assert.equal(
  guide(
    [{ id: 'hurt', quantity: 5, effects: [{ damage: 8 }] }, { id: 'guard', quantity: 5, effects: [{ block: 6 }] }],
    { hp: 20, maxHp: 80 },
  ).need,
  '恢复',
);

const status = guide([
  { id: 'ember', quantity: 1, effects: [{ apply_status: 'ember_mark', stacks: 2 }] },
  { id: 'payoff', quantity: 1, effects: [{ damage: 'opponent.status.ember_mark.stacks * 2' }] },
  { id: 'strike', quantity: 4, effects: [{ damage: 7 }] },
  { id: 'guard', quantity: 4, effects: [{ block: 6 }] },
]);
assert.equal(status.synergy, '状态:ember_mark');
assert.equal(status.roles[0], '补短板(抽牌)');
assert.equal(status.roles[1], '强联动(状态:ember_mark)');
assert.match(core.formatBuildGuidance(status), /synergy=状态:ember_mark roles=补短板\(抽牌\),强联动\(状态:ember_mark\),转方向/);

const discard = guide([
  { id: 'discard', quantity: 2, effects: [{ discard: 1 }] },
  { id: 'discard_payoff', quantity: 1, discard_effects: [{ draw: 1 }], effects: [{ block: 5 }] },
]);
assert.equal(discard.synergy, '弃牌');
assert.equal(guide([{ id: 'x', cost: 'energy', effects: [{ damage: 'spent_energy * 4' }] }]).synergy, 'X费');
assert.notEqual(
  guide([{ id: 'formula', quantity: 10, effects: [{ damage: 'opponent.status.ember.stacks * 3' }] }]).need,
  '输出',
  'formula damage must not be treated as proven zero output',
);
assert.notEqual(
  guide([{ id: 'lust', quantity: 10, effects: [{ lust: 6 }] }]).need,
  '输出',
  'desire damage contributes to the build win condition',
);

console.log('Build guidance identifies one shortfall and one established non-basic synergy without AI analysis.');
