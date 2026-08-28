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
