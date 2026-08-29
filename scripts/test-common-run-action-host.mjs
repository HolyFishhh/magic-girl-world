import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const { TavernRunActionHost } = require(resolve('src/common/runActionHost.ts'));

function reach(kind, seed = 1) {
  let state = core.createRunState({ seed, floorsPerAct: 8 });
  for (let guard = 0; guard < 80; guard += 1) {
    const choice = state.choices.find(entry => entry.kind === kind);
    if (choice) return core.enterRunNode(state, choice.id);
    state = core.completeRunNode(core.enterRunNode(state, state.choices[0].id), { outcome: 'cleared' });
    if (state.phase === 'won') break;
  }
  throw new Error(`seed ${seed} did not reach ${kind}`);
}

function createHarness(stat = {}, options = {}) {
  let variables = { stat_data: stat };
  const prompts = [];
  let updates = 0;
  const ports = {
    isLatest: () => options.latest !== false,
    updateVariablesWith: async updater => {
      updates += 1;
      variables = await updater(variables);
      return variables;
    },
    continueWithPrompt: async plan => {
      prompts.push(plan.prompt);
      const prepared = plan.prepare ? await plan.prepare() : undefined;
      if (options.failBeforeSend) {
        if (plan.rollbackBeforeSend) await plan.rollbackBeforeSend(prepared);
        throw new Error('simulated send failure');
      }
    },
  };
  return {
    host: new TavernRunActionHost(ports),
    stat: () => variables.stat_data,
    prompts,
    updates: () => updates,
  };
}

const initializedHarness = createHarness({
  status: { time: 'night', location: '白木市', profession: { name: '调查员' } },
  battle: { cards: [] },
});
const initialized = await initializedHarness.host.syncPendingRunState();
assert.deepEqual(initialized, {
  consumedRunResult: false,
  restUpgrade: null,
  restTransform: null,
  rewardReroll: false,
});
assert.equal(initializedHarness.stat().run, undefined, 'ordinary roleplay must not auto-create an expedition');
assert.equal(initializedHarness.updates(), 1, 'pending-state sync stays inside one bounded MUV transaction');
const started = await initializedHarness.host.startRun();
assert.equal(started.phase, 'awaiting_choice');
assert.equal(initializedHarness.stat().run.phase, 'awaiting_choice');

const historicalHarness = createHarness({}, { latest: false });
assert.deepEqual(await historicalHarness.host.syncPendingRunState(), {
  consumedRunResult: false,
  restUpgrade: null,
  restTransform: null,
  rewardReroll: false,
});
assert.equal(historicalHarness.updates(), 0, 'historical common floors remain read-only');

const flatRootHost = new TavernRunActionHost({
  isLatest: () => true,
  updateVariablesWith: updater => Promise.resolve(updater({ battle: {}, run: null })),
  continueWithPrompt: async () => undefined,
});
await assert.rejects(flatRootHost.syncPendingRunState(), /stat_data/);

const eventWithReward = reach('event', 7);
const deferredEventHarness = createHarness({
  run: eventWithReward,
  run_result: { node_id: eventWithReward.currentNode.id, outcome: 'cleared', gold: 5 },
  reward: { card: [{ id: 'pending' }], artifact: [], item: [] },
});
const deferredEvent = await deferredEventHarness.host.syncPendingRunState();
assert.equal(deferredEvent.consumedRunResult, false);
assert.ok(deferredEventHarness.stat().run_result, 'event rewards must settle atomically with the player selection');

const eventWithoutReward = reach('event', 7);
const consumedEventHarness = createHarness({
  run: eventWithoutReward,
  run_result: { node_id: eventWithoutReward.currentNode.id, outcome: 'cleared', gold: -5 },
  battle: { core: { hp: 50, max_hp: 80 } },
  reward: { card: [], artifact: [], item: [] },
});
const consumedEvent = await consumedEventHarness.host.syncPendingRunState();
assert.equal(consumedEvent.consumedRunResult, true);
assert.equal(consumedEventHarness.stat().run_result, null);
assert.equal(consumedEventHarness.stat().run.gold, eventWithoutReward.gold - 5);

const restWithUpgrade = reach('rest', 2);
const restUpgradeHarness = createHarness({
  run: restWithUpgrade,
  run_upgrade: { node_id: restWithUpgrade.currentNode.id, card_id: 'guard', effects: [{ block: 8 }] },
  battle: {
    cards: [{
      id: 'guard', name: '守护', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
      description: '获得5点格挡。', effects: [{ block: 5 }],
    }],
    statuses: [],
  },
});
const syncedUpgrade = await restUpgradeHarness.host.syncPendingRunState();
assert.equal(syncedUpgrade.restUpgrade.cardName, '守护+');
assert.equal(restUpgradeHarness.stat().battle.cards[0].effects[0].block, 8);
assert.equal(restUpgradeHarness.stat().run.phase, 'awaiting_choice');

const awaiting = core.createRunState({ seed: 42 });
const choice = awaiting.choices[0];
const enterHarness = createHarness({ run: structuredClone(awaiting) });
await enterHarness.host.enterRunNode(choice, 'route prompt');
assert.equal(enterHarness.stat().run.currentNode.id, choice.id);
assert.deepEqual(enterHarness.prompts, ['route prompt']);

const enterRollbackHarness = createHarness({ run: structuredClone(awaiting) }, { failBeforeSend: true });
await assert.rejects(enterRollbackHarness.host.enterRunNode(choice, 'route prompt'), /simulated send failure/);
assert.deepEqual(enterRollbackHarness.stat().run, awaiting, 'failed message creation restores the awaiting route');

const restRetry = reach('rest', 2);
const retryRollbackHarness = createHarness({ run: restRetry }, { failBeforeSend: true });
await assert.rejects(retryRollbackHarness.host.retryRunNode(restRetry.currentNode, 'retry rest'), /simulated send failure/);
assert.equal(Object.hasOwn(retryRollbackHarness.stat(), 'run_result'), false);
assert.equal(Object.hasOwn(retryRollbackHarness.stat(), 'run_upgrade'), false);

const upgradeRequestHarness = createHarness({
  run: restRetry,
  battle: {
    cards: [{
      id: 'guard', name: '守护', description: 'old prose', type: 'Skill', rarity: 'Common',
      cost: 1, effects: [{ block: 5 }], quantity: 2,
    }],
  },
}, { failBeforeSend: true });
await assert.rejects(
  upgradeRequestHarness.host.requestRestUpgrade(restRetry.currentNode, {
    id: 'guard', name: '守护', description: 'old prose', cost: 1, effects: [{ block: 5 }], quantity: 2,
  }),
  /simulated send failure/,
);
assert.equal(Object.hasOwn(upgradeRequestHarness.stat(), 'run_upgrade'), false);
assert.match(upgradeRequestHarness.prompts[0], /^\[营火升级\]/);
assert.doesNotMatch(upgradeRequestHarness.prompts[0], /old prose|quantity/);

const transformRollbackHarness = createHarness({
  run: restRetry,
  battle: {
    cards: [{
      id: 'guard', name: '守护', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
      description: '获得格挡。', effects: [{ block: 5 }],
    }],
    statuses: [],
  },
}, { failBeforeSend: true });
await assert.rejects(
  transformRollbackHarness.host.requestRestTransform(restRetry.currentNode, transformRollbackHarness.stat().battle.cards[0]),
  /simulated send failure/,
);
assert.equal(Object.hasOwn(transformRollbackHarness.stat(), 'run_transform'), false);
assert.equal(Object.hasOwn(transformRollbackHarness.stat(), 'run_transform_target'), false);
assert.equal(transformRollbackHarness.stat().battle.cards[0].runInstanceId, undefined, 'send rollback restores the legacy deck shape');

const transformCommitHarness = createHarness({
  run: restRetry,
  battle: {
    cards: [{
      id: 'guard', name: '守护', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
      description: '获得格挡。', effects: [{ block: 5 }],
    }],
    statuses: [],
    core: {},
  },
});
await transformCommitHarness.host.requestRestTransform(restRetry.currentNode, transformCommitHarness.stat().battle.cards[0]);
const transformTarget = transformCommitHarness.stat().run_transform_target.run_instance_id;
assert.equal(transformCommitHarness.stat().run_transform, null);
assert.match(transformCommitHarness.prompts[0], /^\[营火变形\]/);
transformCommitHarness.stat().run_transform = {
  id: 'rest_attack', name: '营火斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
  description: '造成伤害。', effects: [{ damage: 8 }],
};
const transformedSync = await transformCommitHarness.host.syncPendingRunState();
assert.deepEqual(transformedSync.restTransform, { runInstanceId: transformTarget, cardName: '营火斩击' });
assert.equal(transformCommitHarness.stat().battle.cards[0].id, 'rest_attack');
assert.equal(transformCommitHarness.stat().battle.cards[0].runInstanceId, transformTarget);
assert.equal(transformCommitHarness.stat().run_transform_target, undefined);
assert.equal(transformCommitHarness.stat().run.phase, 'awaiting_choice');

const rerollRun = core.createRunState({ seed: 63 });
rerollRun.gold = 20;
const rerollHarness = createHarness({
  run: rerollRun,
  battle: { cards: [], artifacts: [], items: [], statuses: [], core: {} },
  reward: {
    card: [{
      id: 'old_card', name: '旧候选', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
      effects: [{ damage: 5 }],
    }],
    artifact: [], item: [], limits: { cards: 1 },
    disabled_categories: [], pool_revision: 0, reroll_count: 0,
  },
});
await rerollHarness.host.requestRewardReroll(['cards'], '[奖励重投]', 5);
assert.deepEqual(rerollHarness.stat().reward.card, []);
assert.equal(rerollHarness.stat().run.gold, 20, 'reroll preparation never spends gold');
rerollHarness.stat().reward.card = [{
  id: 'new_card', name: '新候选', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
  effects: [{ block: 6 }],
}];
const rerolledSync = await rerollHarness.host.syncPendingRunState();
assert.equal(rerolledSync.rewardReroll, true);
assert.equal(rerollHarness.stat().run.gold, 15);
assert.equal(rerollHarness.stat().reward.card[0].id, 'new_card');
assert.equal(rerollHarness.stat().reward.reroll_count, 1);
assert.equal(rerollHarness.stat().run_reward_reroll, undefined);
assert.equal(rerollHarness.stat().run_transaction_events.at(-1).type, 'reward_pool_changed');

const normalRewardHarness = createHarness({
  battle: { cards: [], artifacts: [], items: [], statuses: [], core: {} },
  reward: {
    card: [{
      id: 'spark', name: '火花', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
      effects: [{ damage: 5 }],
    }],
    artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 },
  },
});
const normalReward = await normalRewardHarness.host.settleRewardSelections({ cards: [0], artifacts: [], items: [] });
assert.equal(normalReward.kind, 'reward');
assert.deepEqual(normalReward.summary.cards, ['火花']);

const shopRun = reach('shop', 3);
const shopHarness = createHarness({
  run: shopRun,
  battle: { cards: [], artifacts: [], items: [], statuses: [], core: {} },
  reward: {
    card: [{
      id: 'shop_guard', name: '商店守护', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
      effects: [{ block: 5 }], price: 999,
    }],
    artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 },
  },
});
const shopSettlement = await shopHarness.host.settleRewardSelections({ cards: [0], artifacts: [], items: [] });
assert.equal(shopSettlement.kind, 'shop');
assert.equal(shopSettlement.spentGold, 45);
assert.equal(shopHarness.stat().battle.cards[0].price, undefined);

const eventRewardRun = reach('event', 7);
const eventRewardHarness = createHarness({
  run: eventRewardRun,
  run_result: { node_id: eventRewardRun.currentNode.id, outcome: 'cleared', hp: -3 },
  battle: { core: { hp: 50, max_hp: 80 }, cards: [], artifacts: [], items: [], statuses: [] },
  reward: {
    card: [], artifact: [],
    item: [{ id: 'tonic', name: '星露', rarity: 'Common', count: 1, effects: [{ heal: 3 }] }],
    limits: { cards: 0, artifacts: 0, items: 1 },
  },
});
const eventSettlement = await eventRewardHarness.host.settleRewardSelections({ cards: [], artifacts: [], items: [0] });
assert.equal(eventSettlement.kind, 'event');
assert.equal(eventRewardHarness.stat().battle.core.hp, 47);
assert.equal(eventRewardHarness.stat().run_result, null);

const healRun = reach('rest', 2);
const healHarness = createHarness({ run: healRun, battle: { core: { hp: 40, max_hp: 100 } } });
const healed = await healHarness.host.healAtRest();
assert.equal(healed.healed, 30);
assert.equal(healHarness.stat().battle.core.hp, 70);

const leaveShopHarness = createHarness({
  run: reach('shop', 3),
  reward: { card: [{ id: 'x' }], artifact: [], item: [], limits: { cards: 1 } },
});
await leaveShopHarness.host.leaveShop();
assert.equal(leaveShopHarness.stat().run.phase, 'awaiting_choice');
assert.deepEqual(leaveShopHarness.stat().reward.card, []);

const restartHarness = createHarness({
  run: core.createRunState({ seed: 9 }),
  battle: { core: { hp: 1, max_hp: 80, lust: 50, max_lust: 100 } },
  reward: { card: [], artifact: [], item: [], limits: {} },
  run_trigger_invocations: [{ id: 'old' }],
  run_trigger_counters: { total: 1, by_trigger: { old: 1 } },
});
const restarted = await restartHarness.host.restartRun();
assert.notEqual(restarted.seed, 9);
assert.equal(restartHarness.stat().battle.core.hp, 80);
assert.equal(restartHarness.stat().battle.core.lust, 0);
assert.deepEqual(restartHarness.stat().run_trigger_invocations, []);
assert.deepEqual(restartHarness.stat().run_trigger_counters, {
  total: 0,
  by_trigger: {},
  by_source_kind: {},
  by_source: {},
});

const removalHarness = createHarness({
  battle: {
    core: { card_removal_count: 1 },
    cards: [{ id: 'strike', name: '打击', quantity: 2 }],
  },
});
const removed = await removalHarness.host.removeCard('strike');
assert.equal(removed.remainingQuantity, 1);
assert.equal(removalHarness.stat().battle.core.card_removal_count, 0);

const commonSource = await readFile(resolve('src/common/index.ts'), 'utf8');
const hostSource = await readFile(resolve('src/common/runActionHost.ts'), 'utf8');
assert.match(commonSource, /TavernRunActionHost/);
assert.doesNotMatch(
  commonSource,
  /settle(?:RestHeal|RestUpgrade|ShopSelections|EventRewardSelections)InStat|enterRunNodeInStat|restartRunInStat|removeOneCardFromBattleDeck/,
);
assert.doesNotMatch(hostSource, /document\.|window\.|\$\(|toastr|innerHTML|querySelector/);
assert.match(hostSource, /formatRestUpgradePrompt/);

console.log('One Tavern run host owns route, reward, campfire, shop, restart, and removal transactions.');
