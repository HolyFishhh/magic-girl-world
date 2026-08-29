import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const run = require(resolve('src/game-core/runState.ts'));
const adapter = require(resolve('src/runtime/runStateAdapter.ts'));
const transactions = require(resolve('src/common/runTransactions.ts'));
const triggerRuntime = require(resolve('src/common/runTransactionTriggers.ts'));

const reach = (kind, seed = 1) => {
  let state = run.createRunState({ seed, floorsPerAct: 8 });
  for (let guard = 0; guard < 80; guard += 1) {
    const choice = state.choices.find(entry => entry.kind === kind);
    if (choice) return run.enterRunNode(state, choice.id);
    state = run.completeRunNode(run.enterRunNode(state, state.choices[0].id), { outcome: 'cleared' });
    if (state.phase === 'won') break;
  }
  throw new Error(`seed ${seed} did not reach ${kind}`);
};

const initialized = { run: null, run_upgrade: { stale: true } };
const ensured = adapter.ensureRunStateInStat(initialized, 42);
assert.equal(ensured.run.phase, 'awaiting_choice');
assert.equal(initialized.run_upgrade, null);
assert.equal(adapter.ensureRunStateInStat(initialized, 99).run.seed, 42, 'valid persisted runs must not be replaced');
assert.equal(
  adapter.deriveRunSeed({ status: { time: 'x', location: 'y', profession: { name: 'z' } }, battle: { cards: [] } }),
  adapter.deriveRunSeed({ status: { time: 'x', location: 'y', profession: { name: 'z' } }, battle: { cards: [] } }),
);
const restartedSeed = adapter.restartRunInStat(initialized).seed;
assert.notEqual(restartedSeed, 42);

const coreRestPlan = core.planRestHeal({ run: reach('rest', 2), hp: 40, maxHp: 100 });
assert.equal(coreRestPlan.hp, 70);
assert.equal(coreRestPlan.run.phase, 'awaiting_choice');
const coreShopPlan = core.planShopPurchase({
  run: reach('shop', 3),
  candidates: { cards: [{ rarity: 'Common', quantity: 1 }], artifacts: [], items: [] },
  selections: { cards: [0], artifacts: [], items: [] },
  limits: { cards: 1, artifacts: 0, items: 0 },
});
assert.equal(coreShopPlan.spentGold, 45);
assert.equal(coreShopPlan.remainingGold, coreShopPlan.run.gold);

const battleStat = { run: reach('battle', 42) };
const battleResult = adapter.settleBattleRunInStat(battleStat, 'victory');
assert.equal(battleResult.run.nodeCounts.battle, 1);
assert.equal(battleResult.run.gold, 119);
assert.equal(adapter.settleBattleRunInStat({ run: run.createRunState({ seed: 3 }) }, 'victory'), null);
assert.equal(adapter.settleBattleRunInStat({ run: reach('rest', 2) }, 'victory'), null);
assert.throws(
  () => adapter.settleBattleRunInStat({ run: reach('battle', 4) }, 'victory', 'stale_node'),
  /路线节点已过期/,
);

const eventState = reach('event', 7);
const eventStat = { run: eventState, run_result: { node_id: eventState.currentNode.id, outcome: 'cleared', gold: -10 } };
const eventResult = adapter.consumePendingRunResultInStat(eventStat);
assert.equal(eventResult.run.gold, eventState.gold - 10);
assert.equal(eventStat.run_result, null);

const hpEventState = reach('event', 7);
const hpEventStat = {
  run: hpEventState,
  run_result: { node_id: hpEventState.currentNode.id, outcome: 'cleared', gold: 15, hp: -12 },
  battle: { core: { hp: 50, max_hp: 80 } },
};
const hpEventResult = adapter.consumePendingRunResultInStat(hpEventStat);
assert.equal(hpEventStat.battle.core.hp, 38);
assert.equal(hpEventResult.run.gold, hpEventState.gold + 15);
assert.equal(hpEventResult.run.phase, 'awaiting_choice');

const healEventState = reach('event', 7);
const healEventStat = {
  run: healEventState,
  run_result: { node_id: healEventState.currentNode.id, outcome: 'cleared', hp: 999 },
  battle: { core: { hp: 50, max_hp: 80 } },
};
adapter.consumePendingRunResultInStat(healEventStat);
assert.equal(healEventStat.battle.core.hp, 80, 'event healing must clamp to max HP');

const lethalEventState = reach('event', 7);
const lethalEventStat = {
  run: lethalEventState,
  run_result: { node_id: lethalEventState.currentNode.id, outcome: 'cleared', gold: 50, hp: -99 },
  battle: { core: { hp: 10, max_hp: 80 } },
};
const lethalEventBefore = structuredClone(lethalEventStat);
assert.throws(() => adapter.consumePendingRunResultInStat(lethalEventStat), /非失败事件不能使生命降到 0/);
assert.deepEqual(lethalEventStat, lethalEventBefore, 'rejected lethal events must not partially change HP, gold, or route');

const stringEventState = reach('event', 7);
const stringEventStat = {
  run: stringEventState,
  run_result: { node_id: stringEventState.currentNode.id, outcome: 'cleared', hp: '-5' },
  battle: { core: { hp: 50, max_hp: 80 } },
};
const stringEventBefore = structuredClone(stringEventStat);
assert.throws(() => adapter.consumePendingRunResultInStat(stringEventStat), /节点结果 hp 无效/);
assert.deepEqual(stringEventStat, stringEventBefore, 'numeric strings must not be silently accepted');

const typoEventState = reach('event', 7);
const typoEventStat = {
  run: typoEventState,
  run_result: { node_id: typoEventState.currentNode.id, outcome: 'cleared', hp_delta: -5 },
  battle: { core: { hp: 50, max_hp: 80 } },
};
const typoEventBefore = structuredClone(typoEventStat);
assert.throws(() => adapter.consumePendingRunResultInStat(typoEventStat), /节点结果字段不允许: hp_delta/);
assert.deepEqual(typoEventStat, typoEventBefore, 'unknown result fields must not be ignored before route completion');

const failedEventState = reach('event', 7);
const failedEventStat = {
  run: failedEventState,
  run_result: { node_id: failedEventState.currentNode.id, outcome: 'failed', hp: -999 },
  battle: { core: { hp: 10, max_hp: 80 } },
};
adapter.consumePendingRunResultInStat(failedEventStat);
assert.equal(failedEventStat.battle.core.hp, 0);
assert.equal(failedEventStat.run.phase, 'lost');

const staleEvent = { run: reach('event', 7), run_result: { node_id: 'stale', outcome: 'cleared' } };
const beforeStaleEvent = structuredClone(staleEvent);
assert.throws(() => adapter.consumePendingRunResultInStat(staleEvent), /已过期/);
assert.deepEqual(staleEvent, beforeStaleEvent);

const eventRewardState = reach('event', 7);
const eventRewardStat = {
  run: eventRewardState,
  run_result: { node_id: eventRewardState.currentNode.id, outcome: 'cleared', gold: -20, hp: -8 },
  battle: { core: { hp: 80, max_hp: 80 }, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [{
      id: 'event_guard', name: '余辉守护', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
      description: '获得6点格挡。', effects: [{ block: 6 }],
    }],
    artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 },
  },
};
const eventReward = transactions.settleEventRewardSelectionsInStat(
  eventRewardStat,
  { cards: [0], artifacts: [], items: [] },
);
assert.deepEqual(eventReward.cards, ['余辉守护']);
assert.equal(eventRewardStat.battle.core.hp, 72);
assert.equal(eventRewardStat.run.gold, eventRewardState.gold - 20);
assert.equal(eventRewardStat.run.phase, 'awaiting_choice');
assert.equal(eventRewardStat.battle.cards[0].id, 'event_guard');
assert.deepEqual(eventRewardStat.reward.card, []);
assert.equal(eventRewardStat.run_result, null);

const invalidEventReward = structuredClone(eventRewardStat);
invalidEventReward.run = reach('event', 7);
invalidEventReward.run_result = {
  node_id: invalidEventReward.run.currentNode.id,
  outcome: 'cleared',
  gold: -10,
  hp: -5,
};
invalidEventReward.battle.core = { hp: 50, max_hp: 80 };
invalidEventReward.battle.cards = [];
invalidEventReward.reward.card = [{
  id: 'bad_event_card', name: '坏奖励', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
  description: '错误公式。', effects: [{ damage: 'unknown + 1' }],
}];
const invalidEventRewardBefore = structuredClone(invalidEventReward);
assert.throws(
  () => transactions.settleEventRewardSelectionsInStat(
    invalidEventReward,
    { cards: [0], artifacts: [], items: [] },
  ),
  /Unsupported variable: unknown/,
);
assert.deepEqual(
  invalidEventReward,
  invalidEventRewardBefore,
  'bad event rewards must preserve HP, gold, route, pending result, and all candidates',
);

const staleEventReward = structuredClone(invalidEventRewardBefore);
staleEventReward.reward.card = structuredClone(eventRewardStat.battle.cards);
staleEventReward.run_result.node_id = 'stale_event';
const staleEventRewardBefore = structuredClone(staleEventReward);
assert.throws(
  () => transactions.settleEventRewardSelectionsInStat(
    staleEventReward,
    { cards: [0], artifacts: [], items: [] },
  ),
  /已过期/,
);
assert.deepEqual(
  staleEventReward,
  staleEventRewardBefore,
  'a stale event result must not commit an otherwise valid reward',
);

const restStat = {
  run: reach('rest', 2),
  run_upgrade: null,
  battle: {
    core: { hp: 40, max_hp: 100 },
    cards: [
      {
        id: 'guard', name: '守护', type: 'Skill', rarity: 'Common', cost: 1, quantity: 2,
        description: '获得5点格挡。', effects: [{ block: 5 }],
      },
    ],
  },
};
const healed = transactions.settleRestHealInStat(structuredClone(restStat));
assert.equal(healed.hp, 70);
assert.equal(healed.run.phase, 'awaiting_choice');

restStat.run_upgrade = { node_id: restStat.run.currentNode.id, card_id: 'guard', effects: [{ block: 8 }] };
const upgraded = transactions.settleRestUpgradeInStat(restStat);
assert.equal(upgraded.level, 1);
assert.equal(restStat.battle.cards[0].effects[0].block, 8);
assert.equal(restStat.battle.cards[0].description, undefined);
assert.equal(restStat.run_upgrade, null);

const staleUpgrade = {
  ...structuredClone(restStat),
  run: reach('rest', 2),
  run_upgrade: { node_id: 'stale_rest_node', card_id: 'guard', effects: [{ block: 8 }] },
};
const staleUpgradeBefore = structuredClone(staleUpgrade);
assert.throws(() => transactions.settleRestUpgradeInStat(staleUpgrade), /营火升级所属路线节点已过期/);
assert.deepEqual(staleUpgrade, staleUpgradeBefore, 'stale route-bound upgrades must remain retryable');

const malformedUpgradeNode = {
  ...structuredClone(restStat),
  run: reach('rest', 2),
  run_upgrade: { node_id: 17, card_id: 'guard', effects: [{ block: 8 }] },
};
assert.throws(() => transactions.settleRestUpgradeInStat(malformedUpgradeNode), /所属路线节点已过期/);

const badRest = {
  ...structuredClone(restStat),
  run: reach('rest', 2),
  battle: {
    ...structuredClone(restStat.battle),
    cards: [{
      id: 'guard', name: '守护', type: 'Skill', rarity: 'Common', cost: 1, quantity: 2,
      description: '获得5点格挡。', effects: [{ block: 5 }],
    }],
  },
};
badRest.run_upgrade = { node_id: badRest.run.currentNode.id, card_id: 'guard', description: '坏公式。', effects: [{ block: 'unknown + 1' }] };
const beforeBadRest = structuredClone(badRest);
assert.throws(() => transactions.settleRestUpgradeInStat(badRest), /Unsupported variable: unknown/);
assert.deepEqual(badRest, beforeBadRest, 'bad upgrade must not partially mutate the save');

const missingStatusUpgrade = {
  ...structuredClone(badRest),
  run: reach('rest', 2),
  run_upgrade: { node_id: undefined, card_id: 'guard', description: '施加1层未知状态。', effects: [{ apply_status: 'unknown_status' }] },
};
missingStatusUpgrade.run_upgrade.node_id = missingStatusUpgrade.run.currentNode.id;
const missingStatusUpgradeBefore = structuredClone(missingStatusUpgrade);
assert.throws(() => transactions.settleRestUpgradeInStat(missingStatusUpgrade), /未注册状态: unknown_status/);
assert.deepEqual(missingStatusUpgrade, missingStatusUpgradeBefore);

const shopStat = {
  run: reach('shop', 3),
  run_upgrade: null,
  battle: { cards: [], artifacts: [], items: [], core: {} },
  reward: {
    card: [{ id: 'spark', name: '火花', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, description: '造成5点伤害。', effects: [{ damage: 5 }] }],
    artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 },
  },
};
const shopStartGold = shopStat.run.gold;
const bought = transactions.settleShopSelectionsInStat(shopStat, { cards: [0], artifacts: [], items: [] });
assert.equal(bought.spentGold, 45);
assert.equal(bought.remainingGold, shopStartGold - 45);
assert.equal(shopStat.battle.cards[0].id, 'spark');
assert.equal(shopStat.battle.cards[0].price, undefined);
assert.deepEqual(shopStat.reward.card, []);

const expensive = {
  ...structuredClone(shopStat),
  run: reach('shop', 3),
  reward: {
    card: [{ id: 'rare', name: '昂贵卡', type: 'Skill', rarity: 'Rare', cost: 1, quantity: 2, description: '获得8点格挡。', effects: [{ block: 8 }], price: 1 }],
    artifact: [], item: [], limits: { cards: 1 },
  },
};
const beforeExpensive = structuredClone(expensive);
assert.throws(() => transactions.settleShopSelectionsInStat(expensive, { cards: [0], artifacts: [], items: [] }), /not enough run gold/);
assert.deepEqual(expensive, beforeExpensive, 'failed shop purchase must be atomic');

const ignoredAiPrice = {
  ...structuredClone(shopStat),
  run: reach('shop', 3),
  reward: {
    card: [{ id: 'priced', name: '程序定价', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, description: '造成5点伤害。', effects: [{ damage: 5 }], price: 999 }],
    artifact: [], item: [], limits: { cards: 1 },
  },
};
const pricedPurchase = transactions.settleShopSelectionsInStat(ignoredAiPrice, { cards: [0], artifacts: [], items: [] });
assert.equal(pricedPurchase.spentGold, 45, 'AI-provided price must not control current shop settlement');
assert.equal(ignoredAiPrice.battle.cards.at(-1).price, undefined);

const statusShop = {
  ...structuredClone(shopStat),
  run: reach('shop', 3),
  battle: { cards: [], artifacts: [], items: [], statuses: [], core: {} },
  reward: {
    card: [{
      id: 'frost_card', name: '寒霜刻印', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
      description: '施加1层寒霜。', effects: [{ apply_status: 'frost_mark' }],
      status: {
        id: 'frost_mark', name: '寒霜', emoji: 'F', description: '造成的伤害减少1。', type: 'debuff',
        stacks_change: -1, triggers: { hold: [{ modify: 'damage', subtract: 1 }] },
      },
    }],
    artifact: [], item: [], limits: { cards: 1 },
  },
};
const statusPurchase = transactions.settleShopSelectionsInStat(statusShop, { cards: [0], artifacts: [], items: [] });
assert.equal(statusPurchase.spentGold, 45);
assert.equal(statusShop.battle.statuses[0].id, 'frost_mark');
assert.equal(statusShop.battle.cards[0].status, undefined);

const persistentTemplate = {
  id: 'persistent_guard',
  name: '持久守护',
  type: 'Skill',
  rarity: 'Common',
  cost: 1,
  quantity: 2,
  effects: [{ block: 5 }],
  runInstanceId: 'persistent_guard__run__1',
};
const migratedDeck = core.migratePersistentRunDeck([persistentTemplate]);
assert.equal(migratedDeck.length, 2);
assert.deepEqual(migratedDeck.map(card => card.quantity), [1, 1]);
assert.deepEqual(migratedDeck.map(card => card.runInstanceId), [
  'persistent_guard__run__1',
  'persistent_guard__run__2',
]);
assert.equal(persistentTemplate.quantity, 2, 'persistent deck migration must not mutate legacy saves');
assert.throws(
  () => core.migratePersistentRunDeck([
    { ...persistentTemplate, quantity: 1, runInstanceId: 'duplicate_run_id' },
    { ...persistentTemplate, quantity: 1, runInstanceId: 'duplicate_run_id' },
  ]),
  /duplicate run card identity/,
);

const unifiedRewardStat = {
  battle: {
    core: {},
    cards: [persistentTemplate],
    artifacts: [],
    items: [],
    statuses: [],
  },
  reward: {
    card: [{
      id: 'reward_attack', name: '奖励斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
      effects: [{ damage: 7 }],
    }],
    artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 },
  },
};
const unifiedReward = transactions.executeUnifiedRunTransactionInStat(unifiedRewardStat, {
  kind: 'reward_claim',
  selections: { cards: [0], artifacts: [], items: [] },
  expectedRevision: 0,
  source: { kind: 'player', id: 'reward-test' },
});
assert.equal(unifiedReward.revision, 1);
assert.equal(unifiedRewardStat.battle.cards.length, 3);
assert.equal(new Set(unifiedRewardStat.battle.cards.map(card => card.runInstanceId)).size, 3);
assert.ok(unifiedRewardStat.battle.cards.every(card => card.quantity === 1));
assert.deepEqual(unifiedRewardStat.reward.card, []);
assert.equal(unifiedRewardStat.run_transaction_log[0].kind, 'reward_claim');
assert.equal(unifiedReward.event.type, 'reward_claimed');
assert.deepEqual(unifiedReward.event.source, { kind: 'player', id: 'reward-test' });
assert.equal(unifiedRewardStat.run_transaction_log[0].eventId, unifiedReward.event.id);
assert.equal(unifiedRewardStat.run_transaction_counters.total, 1);
assert.equal(unifiedRewardStat.run_transaction_counters.by_event.reward_claimed, 1);
assert.equal(unifiedRewardStat.run_transaction_counters.by_source['player:reward-test'], 1);
const staleUnifiedReward = structuredClone(unifiedRewardStat);
assert.throws(
  () => transactions.executeUnifiedRunTransactionInStat(staleUnifiedReward, {
    kind: 'reward_claim', selections: { cards: [], artifacts: [], items: [] }, expectedRevision: 0,
  }),
  /stale run transaction revision/,
);
assert.deepEqual(staleUnifiedReward, unifiedRewardStat, 'stale transactions must preserve deck, candidates, and log');

const unifiedPoolStat = {
  run: run.createRunState({ seed: 91 }),
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [{ id: 'pool_guard', name: '池中守护', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 5 } }],
    artifact: [], item: [], limits: { cards: 1 },
  },
};
transactions.executeUnifiedRunTransactionInStat(unifiedPoolStat, {
  kind: 'reward_pool',
  goldCost: 10,
  mutation: {
    kind: 'reroll', categories: ['cards'], candidates: {
      cards: [{ id: 'pool_attack', name: '重投斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 6 } }],
    },
  },
});
assert.equal(unifiedPoolStat.reward.reroll_count, 1);
assert.equal(unifiedPoolStat.run_transaction_revision, 1);
assert.equal(unifiedPoolStat.run.gold, 89);
const invalidUnifiedPool = structuredClone(unifiedPoolStat);
assert.throws(
  () => transactions.executeUnifiedRunTransactionInStat(invalidUnifiedPool, {
    kind: 'reward_pool',
    goldCost: 5,
    mutation: {
      kind: 'replace', category: 'cards', index: 0,
      candidate: { id: 'bad_pool', name: '坏池牌', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 'unknown + 1' } },
    },
  }),
  /Unsupported variable: unknown/,
);
assert.deepEqual(invalidUnifiedPool, unifiedPoolStat, 'bad pool content must roll back gold, candidates, revision, and log');

const unifiedShopRun = reach('shop', 3);
const unifiedShopStat = {
  run: unifiedShopRun,
  battle: { core: {}, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [{ id: 'shop_attack', name: '商店斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 6 } }],
    artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 },
  },
};
const unifiedShop = transactions.executeUnifiedRunTransactionInStat(unifiedShopStat, {
  kind: 'shop_purchase', selections: { cards: [0], artifacts: [], items: [] },
});
assert.equal(unifiedShopStat.run.gold, unifiedShopRun.gold - 45);
assert.equal(unifiedShopStat.battle.cards[0].runInstanceId, 'shop_attack__run__1');
assert.equal(unifiedShop.log.goldBefore - unifiedShop.log.goldAfter, 45);
const failedUnifiedShop = {
  ...structuredClone(unifiedShopStat),
  run: { ...reach('shop', 3), gold: 0 },
  reward: {
    card: [{ id: 'shop_rare', name: '昂贵商品', type: 'Attack', rarity: 'Rare', cost: 1, quantity: 1, effects: { damage: 12 } }],
    artifact: [], item: [], limits: { cards: 1 },
  },
};
const failedUnifiedShopBefore = structuredClone(failedUnifiedShop);
assert.throws(
  () => transactions.executeUnifiedRunTransactionInStat(failedUnifiedShop, {
    kind: 'shop_purchase', selections: { cards: [0], artifacts: [], items: [] },
  }),
  /not enough run gold/,
);
assert.deepEqual(failedUnifiedShop, failedUnifiedShopBefore, 'failed purchases roll back gold, candidates, deck, and log');

const restCard = {
  id: 'rest_guard', name: '营火守护', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
  effects: [{ block: 5 }], runInstanceId: 'rest_guard__run__1', templateId: 'rest_guard',
  $meta: {
    mwg_card_progression: {
      version: 1,
      patches: [
        {
          id: 'rest_guard:permanent:block', source: { kind: 'card', id: 'rest_guard' },
          scope: 'permanent', createdTurn: 0, priority: 0, removeOn: 'manual',
          target: { match: 'run_instance', runInstanceId: 'rest_guard__run__1' },
          kind: 'numeric', stat: 'block', operator: 'add', value: 2,
        },
        {
          id: 'rest_guard:affliction:cost', source: { kind: 'affliction', id: 'rest_fault' },
          scope: 'run', createdTurn: 0, priority: 0, removeOn: 'run_end',
          target: { match: 'run_instance', runInstanceId: 'rest_guard__run__1' },
          kind: 'cost', operator: 'add', value: 1,
        },
      ],
      attachments: [],
      upgradeHistory: [{
        id: 'rest_guard:upgrade:1', source: { kind: 'card', id: 'rest_guard' }, scope: 'permanent',
        fromLevel: 0, toLevel: 1, patchIds: ['rest_guard:permanent:block'],
      }],
      upgraded: true,
      upgradeLevel: 1,
    },
  },
};
const { $meta: _progressionMeta, ...plainRestCard } = restCard;
const makeRestTransactionStat = () => ({
  run: reach('rest', 2),
  battle: { core: {}, cards: [plainRestCard], artifacts: [], items: [], statuses: [] },
});
const makeProgressedRestTransactionStat = () => ({
  run: reach('rest', 2),
  battle: { core: {}, cards: [restCard], artifacts: [], items: [], statuses: [] },
});

const duplicateRest = makeProgressedRestTransactionStat();
const duplicateResult = transactions.executeUnifiedRunTransactionInStat(duplicateRest, {
  kind: 'rest_duplicate_card', runInstanceId: 'rest_guard__run__1',
});
assert.equal(duplicateRest.battle.cards.length, 2);
assert.equal(duplicateResult.log.cardRunInstanceIds.length, 2);
assert.notEqual(duplicateRest.battle.cards[0].runInstanceId, duplicateRest.battle.cards[1].runInstanceId);
assert.equal(
  duplicateRest.battle.cards[1].$meta.mwg_card_progression.patches[0].target.runInstanceId,
  duplicateRest.battle.cards[1].runInstanceId,
  'persistent progression on a copied card is retargeted to the new owned instance',
);
assert.equal(
  duplicateRest.battle.cards[0].$meta.mwg_card_progression.patches[0].target.runInstanceId,
  'rest_guard__run__1',
  'copying does not rewrite the source card progression target',
);
assert.equal(duplicateRest.run.phase, 'awaiting_choice');

const removeRest = makeRestTransactionStat();
transactions.executeUnifiedRunTransactionInStat(removeRest, {
  kind: 'rest_remove_card', runInstanceId: 'rest_guard__run__1',
});
assert.deepEqual(removeRest.battle.cards, []);

const transformRest = makeProgressedRestTransactionStat();
transactions.executeUnifiedRunTransactionInStat(transformRest, {
  kind: 'rest_transform_card',
  runInstanceId: 'rest_guard__run__1',
  replacement: {
    id: 'rest_attack', name: '营火斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
    effects: [{ damage: 8 }],
  },
});
assert.equal(transformRest.battle.cards[0].id, 'rest_attack');
assert.equal(transformRest.battle.cards[0].runInstanceId, 'rest_guard__run__1', 'transform preserves owned identity');
assert.equal(transformRest.battle.cards[0].origin, 'transformed');
assert.deepEqual(
  transformRest.battle.cards[0].$meta.mwg_card_progression.patches.map(patch => patch.id),
  ['rest_guard:permanent:block'],
  'transform inherits ordinary persistent progression but removes affliction metadata',
);
assert.equal(
  transformRest.battle.cards[0].$meta.mwg_card_progression.patches[0].target.runInstanceId,
  'rest_guard__run__1',
);

const statusTransformRest = makeRestTransactionStat();
statusTransformRest.battle.statuses = [];
transactions.executeUnifiedRunTransactionInStat(statusTransformRest, {
  kind: 'rest_transform_card',
  runInstanceId: 'rest_guard__run__1',
  replacement: {
    id: 'rest_mark', name: '营火刻印', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: [{ apply_status: 'rest_mark_status', stacks: 1 }],
    status: {
      id: 'rest_mark_status', name: '营火印记', emoji: 'M', description: '回合末失去一层。', type: 'debuff',
      stacks_change: -1, triggers: { tick: [{ damage: 'stacks', to: 'self' }] },
    },
  },
});
assert.equal(statusTransformRest.battle.statuses[0].id, 'rest_mark_status');
assert.equal(statusTransformRest.battle.cards[0].status, undefined, 'support status is registered, not stored on the card');

const upgradeRest = makeRestTransactionStat();
transactions.executeUnifiedRunTransactionInStat(upgradeRest, {
  kind: 'rest_upgrade_card',
  runInstanceId: 'rest_guard__run__1',
  patch: { effects: [{ block: 9 }] },
});
assert.equal(upgradeRest.battle.cards[0].effects[0].block, 9);
assert.equal(upgradeRest.battle.cards[0].runInstanceId, 'rest_guard__run__1');
assert.equal(upgradeRest.battle.cards[0].upgrade_level, 1);

const failedUpgradeRest = makeRestTransactionStat();
const failedUpgradeRestBefore = structuredClone(failedUpgradeRest);
assert.throws(
  () => transactions.executeUnifiedRunTransactionInStat(failedUpgradeRest, {
    kind: 'rest_upgrade_card',
    runInstanceId: 'rest_guard__run__1',
    patch: { effects: [{ block: 'unknown + 1' }] },
  }),
  /Unsupported variable: unknown/,
);
assert.deepEqual(failedUpgradeRest, failedUpgradeRestBefore, 'failed campfire changes roll back route, deck, and log');

const triggerRun = reach('shop', 3);
const triggerStat = {
  run: { ...triggerRun, gold: 100 },
  status: {
    permanent_status: [{
      id: 'lasting_oath', name: '长期誓约',
      run_triggers: [{
        id: 'keep_items_open', on: 'reward_pool_changed', priority: 0,
        actions: [{ op: 'reward_category', category: 'items', enabled: true }],
      }],
    }],
    temporary_status: [],
  },
  battle: {
    core: { hp: 50, max_hp: 100, card_removal_count: 0 },
    cards: [], items: [],
    artifacts: [{
      id: 'run_purse', name: '远征钱袋',
      run_triggers: [{
        id: 'shop_refund', on: 'reward_pool_changed', priority: 10, max_uses: 1,
        actions: [{ op: 'gold', amount: 3 }],
      }],
    }],
    player_abilities: [{
      id: 'run_recovery', name: '整备恢复',
      run_triggers: [{
        id: 'shop_heal', on: ['reward_pool_changed'], priority: 20,
        when: { node_kinds: ['shop'], source_kinds: ['system'] },
        actions: [{ op: 'hp', amount: 5 }],
      }],
    }],
    player_status_effects: [{ id: 'active_plan', stacks: 1 }],
    statuses: [{
      id: 'active_plan', name: '活跃计划',
      run_triggers: [{
        id: 'removal_credit', on: 'reward_pool_changed',
        actions: [{ op: 'card_removal', amount: 1 }],
      }],
    }],
  },
  run_rules: [{
    id: 'shop_capacity', name: '商店容量规则',
    run_triggers: [{
      id: 'expand_cards', on: 'reward_pool_changed', priority: -1,
      actions: [{ op: 'reward_limit', category: 'cards', amount: 1 }],
    }],
  }],
  reward: {
    card: [], artifact: [], item: [], limits: { cards: 0 },
    disabled_categories: [], pool_revision: 0, reroll_count: 0,
  },
};
const triggerResult = transactions.executeUnifiedRunTransactionInStat(triggerStat, {
  kind: 'reward_pool',
  mutation: { kind: 'disable_category', category: 'items' },
  source: { kind: 'system', id: 'trigger-test' },
});
assert.deepEqual(
  triggerResult.triggerInvocations.map(entry => entry.triggerKey),
  [
    'ability:run_recovery:shop_heal',
    'artifact:run_purse:shop_refund',
    'status:active_plan:removal_credit',
    'status:lasting_oath:keep_items_open',
    'rule:shop_capacity:expand_cards',
  ],
  'out-of-battle triggers use priority followed by stable source ordering',
);
assert.equal(triggerStat.run.gold, 103);
assert.equal(triggerStat.battle.core.hp, 55);
assert.equal(triggerStat.battle.core.card_removal_count, 1);
assert.deepEqual(triggerStat.reward.disabled_categories, []);
assert.equal(triggerStat.reward.limits.cards, 1);
assert.equal(triggerStat.run_trigger_counters.total, 5);
assert.deepEqual(triggerStat.run_trigger_counters.by_source_kind, {
  ability: 1, artifact: 1, status: 2, rule: 1,
});
assert.equal(triggerStat.run_trigger_counters.by_source['artifact:run_purse'], 1);
assert.equal(triggerStat.run_trigger_counters.by_source['status:lasting_oath'], 1);
assert.equal(triggerStat.run_trigger_invocations.length, 5);
assert.equal(triggerResult.event.nodeKind, 'shop');
assert.equal(triggerResult.event.goldDelta, 3, 'transaction event includes inline trigger gold changes');

transactions.executeUnifiedRunTransactionInStat(triggerStat, {
  kind: 'reward_pool',
  mutation: { kind: 'disable_category', category: 'items' },
  source: { kind: 'system', id: 'trigger-test' },
});
assert.equal(triggerStat.run.gold, 103, 'max_uses prevents the artifact refund from firing twice');
assert.equal(triggerStat.run_trigger_counters.by_trigger['artifact:run_purse:shop_refund'], 1);
const restoredInvocationCount = triggerStat.run_trigger_invocations.length;
adapter.migrateRunProgramStateInStat(triggerStat);
assert.equal(triggerStat.run_trigger_invocations.length, restoredInvocationCount, 'restoring program state never replays old events');

const legacyTriggerCounterStat = { run_trigger_counters: { total: 2, by_trigger: { legacy: 2 } } };
adapter.migrateRunProgramStateInStat(legacyTriggerCounterStat);
assert.deepEqual(legacyTriggerCounterStat.run_trigger_counters.by_source_kind, {});
assert.deepEqual(legacyTriggerCounterStat.run_trigger_counters.by_source, {});

const scopedTriggerBase = {
  run_transaction_counters: {
    total: 4,
    by_event: { reward_pool_changed: 2 },
    by_source: { 'system:filtered-source': 1 },
  },
  battle: { core: { card_removal_count: 0 } },
  run_rules: [{
    id: 'scoped-rule', name: 'Scoped rule',
    run_triggers: [{
      id: 'scoped-credit', on: 'reward_pool_changed',
      when: {
        node_kinds: ['shop'],
        source_kinds: ['system'],
        node_id: 'shop-node-7',
        source_id: 'filtered-source',
        event_sequence: { min: 5, max: 9, every: 2, offset: 1 },
        transaction_counters: [
          { scope: 'total', min: 5, max: 5 },
          { scope: 'event', event: 'reward_pool_changed', min: 3, max: 3 },
          { scope: 'source', source_kind: 'system', source_id: 'filtered-source', min: 2, max: 2 },
        ],
      },
      actions: [{ op: 'card_removal', amount: 1 }],
    }],
  }],
};
const scopedTriggerEvent = {
  id: 'scoped:5',
  sequence: 5,
  type: 'reward_pool_changed',
  source: { kind: 'system', id: 'filtered-source' },
  nodeId: 'shop-node-7',
  nodeKind: 'shop',
  cardRunInstanceIds: [],
  goldDelta: 0,
};
const scopedTriggerStat = structuredClone(scopedTriggerBase);
const scopedTriggerResult = triggerRuntime.executeRunTransactionTriggers(scopedTriggerStat, scopedTriggerEvent);
assert.equal(scopedTriggerResult.invocations.length, 1);
assert.equal(scopedTriggerStat.battle.core.card_removal_count, 1);
assert.equal(scopedTriggerStat.run_trigger_counters.by_source_kind.rule, 1);
assert.equal(scopedTriggerStat.run_trigger_counters.by_source['rule:scoped-rule'], 1);

for (const [field, value] of [
  ['nodeId', 'other-node'],
  ['nodeKind', 'event'],
  ['sequence', 6],
]) {
  const stat = structuredClone(scopedTriggerBase);
  const result = triggerRuntime.executeRunTransactionTriggers(stat, { ...scopedTriggerEvent, [field]: value, id: `mismatch:${field}` });
  assert.equal(result.invocations.length, 0, `${field} mismatch must not invoke a scoped trigger`);
  assert.equal(stat.battle.core.card_removal_count, 0);
}
{
  const stat = structuredClone(scopedTriggerBase);
  const result = triggerRuntime.executeRunTransactionTriggers(stat, {
    ...scopedTriggerEvent,
    id: 'mismatch:source-id',
    source: { kind: 'system', id: 'other-source' },
  });
  assert.equal(result.invocations.length, 0, 'source_id and source transaction counter both use exact source identity');
}
{
  const stat = structuredClone(scopedTriggerBase);
  stat.run_transaction_counters.by_event.reward_pool_changed = 1;
  const result = triggerRuntime.executeRunTransactionTriggers(stat, { ...scopedTriggerEvent, id: 'mismatch:event-counter' });
  assert.equal(result.invocations.length, 0, 'transaction counter conditions include and filter the current event count');
}

const everySecondTransactionStat = {
  battle: { core: { card_removal_count: 0 } },
  reward: { card: [], artifact: [], item: [], limits: {}, disabled_categories: [], pool_revision: 0, reroll_count: 0 },
  run_rules: [{
    id: 'cycle-rule', name: 'Cycle rule',
    run_triggers: [{
      id: 'every-second', on: 'reward_pool_changed',
      when: { transaction_counters: [{ scope: 'event', event: 'reward_pool_changed', every: 2, offset: 0 }] },
      actions: [{ op: 'card_removal', amount: 1 }],
    }],
  }],
};
const firstCycleResult = transactions.executeUnifiedRunTransactionInStat(everySecondTransactionStat, {
  kind: 'reward_pool', mutation: { kind: 'disable_category', category: 'items' },
  source: { kind: 'system', id: 'cycle-source' },
});
assert.equal(firstCycleResult.triggerInvocations.length, 0);
const secondCycleResult = transactions.executeUnifiedRunTransactionInStat(everySecondTransactionStat, {
  kind: 'reward_pool', mutation: { kind: 'disable_category', category: 'artifacts' },
  source: { kind: 'system', id: 'cycle-source' },
});
assert.equal(secondCycleResult.triggerInvocations.length, 1, 'the second matching transaction satisfies an every=2 counter');
assert.equal(everySecondTransactionStat.battle.core.card_removal_count, 1);

for (const mutate of [
  trigger => { trigger.when.unsupported = true; },
  trigger => { trigger.when.event_sequence = { every: 0 }; },
  trigger => { trigger.when.transaction_counters = [{ scope: 'source', source_kind: 'system', min: 1 }]; },
]) {
  const stat = structuredClone(scopedTriggerBase);
  mutate(stat.run_rules[0].run_triggers[0]);
  const before = structuredClone(stat);
  assert.throws(
    () => triggerRuntime.executeRunTransactionTriggers(stat, { ...scopedTriggerEvent, id: `invalid:${Math.random()}` }),
    /unsupported fields|must be an integer|source scope requires|source_id/,
  );
  assert.deepEqual(stat, before, 'invalid trigger filters fail before any program state is committed');
}

const invalidTriggerStat = structuredClone(triggerStat);
invalidTriggerStat.battle.artifacts[0].run_triggers[0].actions = [{ op: 'gold', amount: 1.5 }];
const invalidTriggerBefore = structuredClone(invalidTriggerStat);
assert.throws(
  () => transactions.executeUnifiedRunTransactionInStat(invalidTriggerStat, {
    kind: 'reward_pool', mutation: { kind: 'disable_category', category: 'items' },
  }),
  /gold amount must be an integer/,
);
assert.deepEqual(
  invalidTriggerStat,
  invalidTriggerBefore,
  'a failed out-of-battle trigger rolls back the primary mutation, trigger state, and transaction journal',
);

const boundedTriggerStat = {
  battle: { core: { card_removal_count: 0 } },
  run_rules: [{
    id: 'bounded_rule', name: '限长规则',
    run_triggers: [{
      id: 'count', on: 'reward_pool_changed', actions: [{ op: 'card_removal', amount: 0 }],
    }],
  }],
};
for (let sequence = 1; sequence <= 205; sequence += 1) {
  triggerRuntime.executeRunTransactionTriggers(boundedTriggerStat, {
    id: `bounded:${sequence}`,
    sequence,
    type: 'reward_pool_changed',
    source: { kind: 'system', id: 'bounded-test' },
    nodeId: null,
    nodeKind: null,
    cardRunInstanceIds: [],
    goldDelta: 0,
  });
}
assert.equal(boundedTriggerStat.run_trigger_invocations.length, 200, 'run trigger invocation history is bounded');
assert.equal(boundedTriggerStat.run_trigger_counters.total, 205, 'bounded history does not erase aggregate counters');

const rewardTriggerStat = {
  battle: {
    core: { hp: 50, max_hp: 100 }, cards: [], items: [], statuses: [], player_abilities: [], player_status_effects: [],
    artifacts: [{
      id: 'reward_healer', name: '领奖恢复',
      run_triggers: [{ id: 'heal', on: 'reward_claimed', actions: [{ op: 'hp', amount: 5 }] }],
    }],
  },
  reward: {
    card: [{ id: 'reward_card', name: '领奖卡', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 5 } }],
    artifact: [], item: [], limits: { cards: 1 },
  },
};
const rewardTriggerResult = transactions.executeUnifiedRunTransactionInStat(rewardTriggerStat, {
  kind: 'reward_claim', selections: { cards: [0], artifacts: [], items: [] },
});
assert.equal(rewardTriggerStat.battle.core.hp, 55);
assert.equal(rewardTriggerResult.triggerInvocations[0].source.kind, 'artifact');

const shopTriggerStat = {
  run: reach('shop', 3),
  battle: {
    core: { card_removal_count: 0 }, cards: [], artifacts: [], items: [], statuses: [], player_status_effects: [],
    player_abilities: [{
      id: 'shop_training', name: '购物训练',
      run_triggers: [{ id: 'credit', on: 'shop_purchased', actions: [{ op: 'card_removal', amount: 1 }] }],
    }],
  },
  reward: {
    card: [{ id: 'shop_card', name: '商店卡', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 5 } }],
    artifact: [], item: [], limits: { cards: 1 },
  },
};
transactions.executeUnifiedRunTransactionInStat(shopTriggerStat, {
  kind: 'shop_purchase', selections: { cards: [0], artifacts: [], items: [] },
});
assert.equal(shopTriggerStat.battle.core.card_removal_count, 1);

const restTriggerRun = reach('rest', 2);
const restTriggerStat = {
  run: { ...restTriggerRun, gold: 10 },
  status: {
    permanent_status: [{
      id: 'rest_income', name: '休整收入',
      run_triggers: [{ id: 'income', on: 'rest_healed', actions: [{ op: 'gold', amount: 2 }] }],
    }],
    temporary_status: [],
  },
  battle: { core: { hp: 40, max_hp: 100 }, cards: [], artifacts: [], items: [], statuses: [], player_abilities: [], player_status_effects: [] },
};
const restTriggerResult = transactions.executeUnifiedRunTransactionInStat(restTriggerStat, { kind: 'rest_heal' });
assert.equal(restTriggerStat.run.gold, 12);
assert.equal(restTriggerResult.triggerInvocations[0].source.kind, 'status');

const battleExecutorSource = await readFile(resolve('src/fish/combat/unifiedEffectExecutor.ts'), 'utf8');
const battleEndHostSource = await readFile(resolve('src/fish/core/battleEndHost.ts'), 'utf8');
const battleSettlementSource = await readFile(resolve('src/runtime/battleSettlementAdapter.ts'), 'utf8');
const runTransactionsSource = await readFile(resolve('src/common/runTransactions.ts'), 'utf8');
assert.match(runTransactionsSource, /planRestHeal\(/);
assert.match(runTransactionsSource, /planShopPurchase\(/);
assert.doesNotMatch(runTransactionsSource, /function selectionPrice|recommendShopPrice\(/);
assert.match(battleExecutorSource, /battleEndHost\.presentBattleEnd\(result, narrativeText \|\| undefined\)/);
assert.match(battleEndHostSource, /confirmBattleEnd\([\s\S]*?result: BattleEndResult,[\s\S]*?battleSummary: string,[\s\S]*?rewardRequest\?: Record<string, unknown> \| null/);
assert.match(battleEndHostSource, /rewardRequest,[\s\S]*?await this\.continuationHost\.continueWithPrompt/);
assert.match(battleEndHostSource, /settleBattle: input => settleCurrentMessageBattle\(input\)/);
assert.match(battleSettlementSource, /settleBattleRunInStat\(/);
assert.match(battleSettlementSource, /battleResult\?\.outcome \|\| input\.result/);
assert.match(battleSettlementSource, /battleResult\?\.route\?\.nodeId/);
assert.match(battleEndHostSource, /await this\.ports\.clearBattleSession\(\)/);
assert.match(battleEndHostSource, /rollbackBeforeSend/);

console.log('Run adapter, battle settlement, rest upgrades, healing, and paid shop rewards are atomic.');
