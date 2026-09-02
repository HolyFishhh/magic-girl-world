import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { createRunState, completeRunNode, enterRunNode } = require('../src/game-core/index.ts');
const {
  executeUnifiedRunTransactionInStat,
  settleTowerOpeningChoiceInStat,
} = require('../src/common/runTransactions.ts');

function statWithOpening(outcome) {
  const run = createRunState({ seed: 174 });
  run.opening = {
    phase: 'ready',
    requestId: 'opening-request',
    basedOnRevision: 0,
    attempts: 1,
    content: {
      title: '启程礼物',
      narrative: '旅途开始前，一份馈赠落入手中。',
      choices: [{ id: 'accept', label: '接受', outcome }],
    },
  };
  return {
    run,
    battle: {
      core: { hp: 100, max_hp: 100, card_removal_count: 1, resources: [] },
      cards: [],
      artifacts: [],
      items: [],
      statuses: [],
    },
    reward: { card: [], artifact: [], item: [], limits: {}, disabled_categories: [] },
  };
}

const stat = statWithOpening({
  hp: -5,
  max_hp: 10,
  gold: 20,
  card_removals: 1,
  reward: {
    items: [{
      id: 'opening_tonic',
      name: '启程药剂',
      count: 1,
      description: '为接下来的道路准备的温和药剂。',
      effects: { heal: 5 },
    }],
  },
});
const result = settleTowerOpeningChoiceInStat(stat, 'accept');
assert.equal(result.hp, 95);
assert.equal(result.maxHp, 110);
assert.equal(result.gold, 119);
assert.equal(result.cardRemovalCount, 2);
assert.deepEqual(result.items, ['启程药剂']);
assert.equal(stat.battle.items[0].id, 'opening_tonic');
assert.equal(stat.run.opening.phase, 'consumed');
assert.equal(stat.run.floor, 1, 'choosing the opening gift also completes the unique reward start');
assert.equal(stat.run.choices.length, 3, 'the reward start opens the three main routes');
assert.ok(stat.run.choices.every(choice => choice.floor === 2));
assert.throws(() => settleTowerOpeningChoiceInStat(stat, 'accept'), /没有可结算/);

const invalid = statWithOpening({ reward: { items: [{ id: 'broken' }] } });
const before = structuredClone(invalid);
assert.throws(() => settleTowerOpeningChoiceInStat(invalid, 'accept'));
assert.deepEqual(invalid, before, 'invalid opening rewards must roll back every scalar and route change');

const treasureStat = statWithOpening({});
treasureStat.run.opening.phase = 'consumed';
while (treasureStat.run.floor < 8) {
  treasureStat.run = enterRunNode(treasureStat.run, treasureStat.run.choices[0].id);
  treasureStat.run = completeRunNode(treasureStat.run, { outcome: 'cleared' });
}
const treasure = treasureStat.run.choices.find(choice => choice.kind === 'treasure');
assert.ok(treasure, 'floor 9 must expose the mandatory treasure node');
treasureStat.run = enterRunNode(treasureStat.run, treasure.id);
treasureStat.reward.item = [{
  id: 'treasure_tonic',
  name: '宝箱药剂',
  count: 1,
  description: '从固定宝箱中取得的补给。',
  effects: { heal: 6 },
}];
treasureStat.reward.limits = { cards: 0, artifacts: 0, items: 1 };
const treasureResult = executeUnifiedRunTransactionInStat(treasureStat, {
  kind: 'treasure_reward_claim',
  selections: { cards: [], artifacts: [], items: [0] },
});
assert.equal(treasureStat.run.phase, 'awaiting_choice');
assert.equal(treasureStat.run.floor, 9);
assert.equal(treasureStat.run.nodeCounts.treasure, 2, 'the opening reward and floor-nine chest are both counted');
assert.equal(treasureResult.event.type, 'treasure_claimed');

console.log('tower opening and treasure settlements are atomic');
