import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const run = require(resolve('src/game-core/runState.ts'));
const rewards = require(resolve('src/common/rewardTransactions.ts'));
const transactions = require(resolve('src/common/runTransactions.ts'));
const adapter = require(resolve('src/fish/core/mvuBattleAdapter.ts'));

const strike = {
  id: 'six_strike',
  name: '六点斩击',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  unique: false,
  quantity: 1,
  effects: [{ damage: 6 }],
};

const reachShop = () => {
  let value = run.createRunState({ seed: 3, floorsPerAct: 8 });
  for (let guard = 0; guard < 80; guard += 1) {
    const shop = value.choices.find(entry => entry.kind === 'shop');
    if (shop) return run.enterRunNode(value, shop.id);
    value = run.completeRunNode(run.enterRunNode(value, value.choices[0].id), { outcome: 'cleared' });
  }
  throw new Error('fixture did not reach a shop');
};

// A regular reward can grant the exact existing six-damage card without
// inventing a cosmetic ID; it aggregates authored ownership before instances
// are materialized.
const rewardStat = {
  battle: { core: {}, cards: [structuredClone(strike)], artifacts: [], items: [], statuses: [] },
  reward: { card: [structuredClone(strike)], artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 } },
};
rewards.applyRewardSelectionsToStat(rewardStat, { cards: [0], artifacts: [], items: [] });
assert.equal(rewardStat.battle.cards.length, 1);
assert.equal(rewardStat.battle.cards[0].quantity, 2, 'exact reward reuses the existing template definition');

// The same offer remains legal through the real shop transaction path.
const shopStat = {
  run: reachShop(),
  battle: { core: {}, cards: [structuredClone(strike)], artifacts: [], items: [], statuses: [] },
  reward: { card: [structuredClone(strike)], artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 } },
};
transactions.executeUnifiedRunTransactionInStat(shopStat, {
  kind: 'shop_purchase',
  selections: { cards: [0], artifacts: [], items: [] },
});
const owned = core.migratePersistentRunDeck(shopStat.battle.cards);
assert.equal(owned.length, 2);
assert.equal(owned[0].id, 'six_strike');
assert.equal(owned[1].id, 'six_strike');
assert.notEqual(
  owned[0].runInstanceId,
  owned[1].runInstanceId,
  'each identical owned copy has a stable independent identity',
);
assert.deepEqual(
  owned.map(card => card.effects),
  [[{ damage: 6 }], [{ damage: 6 }]],
);

// A save/restore round trip retains both identities and the executable rule.
const combatCards = adapter.convertMvuCards(shopStat.battle.cards);
const saved = adapter.writeBackMvuCardProgression(shopStat.battle.cards, combatCards, combatCards).cards;
const restored = core.migratePersistentRunDeck(saved);
assert.deepEqual(
  restored.map(card => card.runInstanceId),
  owned.map(card => card.runInstanceId),
);
assert.deepEqual(
  restored.map(card => card.effects),
  [[{ damage: 6 }], [{ damage: 6 }]],
);

// A same-ID card with a different executable rule is a structural conflict and
// leaves an attempted purchase atomic.
const conflict = {
  run: reachShop(),
  battle: { core: {}, cards: [structuredClone(strike)], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [{ ...structuredClone(strike), effects: [{ damage: 7 }] }],
    artifact: [],
    item: [],
    limits: { cards: 1, artifacts: 0, items: 0 },
  },
};
const beforeConflict = structuredClone(conflict);
assert.throws(
  () =>
    transactions.executeUnifiedRunTransactionInStat(conflict, {
      kind: 'shop_purchase',
      selections: { cards: [0], artifacts: [], items: [] },
    }),
  /规则不同，请使用新 ID/,
);
assert.deepEqual(conflict, beforeConflict, 'conflicting ID purchase must not mutate gold, offers, or deck');

console.log(
  'Exact six-damage card reuse passes reward and shop acquisition, distinct-instance persistence, and conflicting-ID rejection.',
);
