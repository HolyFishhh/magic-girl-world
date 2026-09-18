import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/index.ts');
const { TavernRunActionHost, createShopPurchaseQuote } = require('../src/common/runActionHost.ts');
let run = core.createRunState({ seed: 3, floorsPerAct: 8 });
for (let i = 0; i < 80; i++) {
  const choice = run.choices.find(c => c.kind === 'shop');
  if (choice) {
    run = core.enterRunNode(run, choice.id);
    break;
  }
  run = core.completeRunNode(core.enterRunNode(run, run.choices[0].id), { outcome: 'cleared' });
}
assert.equal(run.currentNode.kind, 'shop');
run.gold = 300;
const attack = {
  id: 'strike',
  name: '打击',
  emoji: '⚔',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  quantity: 1,
  effects: { damage: 6 },
};
let variables = {
  stat_data: {
    run,
    battle: { core: { hp: 60, max_hp: 80 }, cards: [], artifacts: [], items: [], statuses: [] },
    reward: {
      card: [attack, { ...attack, id: 'guard', name: '防御', type: 'Skill', effects: { block: 5 } }],
      artifact: [],
      item: [],
      limits: { cards: 2, artifacts: 0, items: 0 },
    },
  },
};
let schedules = 0;
let latest = true;
const makeHost = ({ becomeHistoricalBeforeUpdate = false } = {}) =>
  new TavernRunActionHost({
    isLatest: () => latest,
    updateVariablesWith: async updater => {
      if (becomeHistoricalBeforeUpdate) latest = false;
      const next = await updater(structuredClone(variables));
      variables = next;
      return next;
    },
    continueWithPrompt: async () => {
      throw Error('No model request allowed');
    },
    scheduleTowerGeneration: () => {
      schedules++;
    },
  });
let host = makeHost();
const before = structuredClone(variables),
  quote = createShopPurchaseQuote(variables.stat_data);
const purchased = await host.purchaseShopItem('cards', 0, quote);
assert.equal(purchased.spentGold, core.recommendShopPrice('cards', attack, run.act));
assert.equal(variables.stat_data.run.gold, 300 - purchased.spentGold);
assert.equal(variables.stat_data.run.phase, 'in_node', 'one purchase keeps even legacy shops open');
assert.equal(variables.stat_data.reward.card.length, 1);
assert.equal(variables.stat_data.battle.cards.length, 1);
assert.equal(schedules, 0, 'purchases do not leave or advance the route');
const purchasedState = JSON.stringify(variables);
await assert.rejects(host.purchaseShopItem('cards', 0, quote), /商品已经更新/);
assert.equal(JSON.stringify(variables), purchasedState, 'stale click cannot purchase the next stock slot');
variables = JSON.parse(purchasedState);
host = makeHost();
await host.purchaseShopItem('cards', 0, createShopPurchaseQuote(variables.stat_data));
assert.equal(variables.stat_data.reward.card.length, 0, 'saved stock does not refill');
assert.equal(variables.stat_data.run.phase, 'in_node');
await host.leaveShop();
assert.equal(variables.stat_data.run.phase, 'awaiting_choice');
assert.equal(schedules, 1);
assert.equal(variables.stat_data.run_shop, null);

variables = structuredClone(before);
host = makeHost();
await host.leaveShop();
assert.equal(variables.stat_data.run.gold, 300, 'leave with every item unsold requires no selection/payment');
assert.deepEqual(variables.stat_data.reward.card, []);
variables = structuredClone(before);
variables.stat_data.run.gold = 0;
host = makeHost();
const poor = JSON.stringify(variables);
await assert.rejects(host.purchaseShopItem('cards', 0, createShopPurchaseQuote(variables.stat_data)));
assert.equal(JSON.stringify(variables), poor, 'insufficient gold is atomic');
variables = structuredClone(before);
host = makeHost();
const changedQuote = createShopPurchaseQuote(variables.stat_data);
variables.stat_data.reward.card[0].effects.damage = 99;
await assert.rejects(
  host.purchaseShopItem('cards', 0, changedQuote),
  /商品已经更新/,
  'same ID with changed rules is not the displayed offer',
);
assert.equal(variables.stat_data.run.gold, 300);
// A rendered historical market cannot write its old message. The same guard
// runs again inside the updater, closing the race after the initial click.
for (const operation of [
  async host => host.purchaseShopItem('cards', 0, createShopPurchaseQuote(variables.stat_data)),
  async host => host.removeCardAtShop('missing-instance'),
  async host => host.leaveShop(),
]) {
  variables = structuredClone(before);
  latest = false;
  host = makeHost();
  const snapshot = JSON.stringify(variables);
  await assert.rejects(operation(host), /最新消息的商店/);
  assert.equal(JSON.stringify(variables), snapshot, 'historical shop controls cannot write saved state');
}
for (const operation of [
  async host => host.purchaseShopItem('cards', 0, createShopPurchaseQuote(variables.stat_data)),
  async host => host.removeCardAtShop('missing-instance'),
  async host => host.leaveShop(),
]) {
  variables = structuredClone(before);
  latest = true;
  host = makeHost({ becomeHistoricalBeforeUpdate: true });
  const snapshot = JSON.stringify(variables);
  await assert.rejects(operation(host), /最新消息的商店/);
  assert.equal(
    JSON.stringify(variables),
    snapshot,
    'a message that becomes historical before mutation stays unchanged',
  );
}
console.log(
  'Single shop purchases, retained stock, save/reload, stale clicks, insufficient gold and unconditional leave passed.',
);
