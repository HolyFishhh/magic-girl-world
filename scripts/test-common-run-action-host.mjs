import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const { TavernRunActionHost, createRewardPoolFingerprint } = require(resolve('src/common/runActionHost.ts'));
const towerAdapter = require(resolve('src/runtime/towerStateAdapter.ts'));

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
  const towerWakeReasons = [];
  let failedUpdateAfterApply = false;
  const ports = {
    isLatest: () => options.latest !== false,
    updateVariablesWith: async updater => {
      updates += 1;
      variables = await updater(variables);
      if (options.failUpdateAfterApplyOnce && !failedUpdateAfterApply) {
        failedUpdateAfterApply = true;
        throw new Error('simulated update failure after apply');
      }
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
    scheduleTowerGeneration: async reason => {
      towerWakeReasons.push(reason);
      if (options.failTowerWake) throw new Error('simulated tower wake failure');
      return true;
    },
  };
  return {
    host: new TavernRunActionHost(ports),
    stat: () => variables.stat_data,
    prompts,
    updates: () => updates,
    towerWakeReasons,
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
assert.deepEqual(initializedHarness.towerWakeReasons, ['run-created']);

const wakeFailureHarness = createHarness({ battle: { cards: [] } }, { failTowerWake: true });
const wakeFailureRun = await wakeFailureHarness.host.startRun();
assert.equal(wakeFailureRun.phase, 'awaiting_choice', 'background wake failure must not roll back a created run');

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
    cards: [
      {
        id: 'guard',
        name: '守护',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        description: '获得5点格挡。',
        effects: [{ block: 5 }],
      },
    ],
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

const towerAwaiting = core.createRunState({ seed: 4242 });
const towerChoice = towerAwaiting.choices[0];
const towerHarness = createHarness({
  game_mode: 'tower',
  game_mode_lock: { schemaVersion: 1, mode: 'tower' },
  run: structuredClone(towerAwaiting),
});
await towerHarness.host.enterTowerRunNode(towerChoice, 'tower route prompt');
assert.equal(towerHarness.stat().run.currentNode.id, towerChoice.id);
assert.deepEqual(towerHarness.prompts, ['tower route prompt']);
assert.ok(
  towerHarness.stat().run.choices.length === 0 &&
    Object.values(towerHarness.stat().run.nodeContent).some(envelope => envelope.phase === 'abandoned'),
  'tower entry should reconcile discarded DAG branches atomically',
);

const towerRollbackHarness = createHarness(
  {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    run: structuredClone(towerAwaiting),
  },
  { failBeforeSend: true },
);
await assert.rejects(
  towerRollbackHarness.host.enterTowerRunNode(towerChoice, 'tower route prompt'),
  /simulated send failure/,
);
assert.deepEqual(towerRollbackHarness.stat().run, towerAwaiting, 'failed tower continuation restores the whole DAG');

function readyTowerBattleStat() {
  const run = core.createRunState({ seed: 5151 });
  const choice = run.choices[0];
  const stat = {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    run,
    battle: {
      core: { emoji: '🧙', hp: 80, max_hp: 100, lust: 0, max_lust: 100, resources: [] },
      cards: [
        {
          id: 'starter_strike',
          name: '起手斩',
          type: 'Attack',
          rarity: 'Common',
          cost: 1,
          quantity: 4,
          description: '挥出稳定的一击。',
          effects: { damage: 6 },
        },
      ],
      statuses: [],
      artifacts: [],
      items: [],
      player_abilities: [],
      player_status_effects: [],
      player_lust_effect: null,
      enemy: null,
      enemies: [],
      level: 1,
      exp: 0,
    },
    reward: { card: [], artifact: [], item: [], limits: {} },
  };
  const queued = towerAdapter.queueTowerLookaheadInStat(stat, 1);
  const request = queued.queued.find(entry => entry.nodeId === choice.id);
  assert.ok(request, 'the selected tower node should be queued');
  towerAdapter.claimTowerGenerationInStat(stat, request.nodeId, request.requestId);
  towerAdapter.commitTowerGenerationInStat(stat, {
    ...request,
    content: {
      title: '雾路伏击',
      narrative: '雾气中亮起一双冷眼。',
      payload: {
        battle: {
          enemy: {
            name: '雾中猎手',
            emoji: '🐺',
            hp: 32,
            max_hp: 32,
            lust: 0,
            max_lust: 100,
            actions: [{ name: '扑击', effects: { damage: 7 } }],
            abilities: [],
            status_effects: [],
            action_mode: 'random',
            action_config: {},
          },
        },
      },
    },
    reward: {
      card: [
        {
          id: 'mist_guard',
          name: '雾隐',
          type: 'Skill',
          rarity: 'Common',
          cost: 1,
          quantity: 1,
          description: '借雾势保护自己。',
          effects: { block: 7 },
        },
        {
          id: 'mist_cut',
          name: '雾切',
          type: 'Attack',
          rarity: 'Common',
          cost: 1,
          quantity: 1,
          description: '沿雾隙斩击敌人。',
          effects: { damage: 8 },
        },
        {
          id: 'mist_cycle',
          name: '雾循',
          type: 'Skill',
          rarity: 'Common',
          cost: 1,
          quantity: 1,
          description: '借雾重整手牌。',
          effects: { draw: 1 },
        },
      ],
      artifact: [],
      item: [{ id: 'mist_salve', name: '雾露', count: 1, effects: { heal: 6 } }],
      limits: { cards: 1, artifacts: 0, items: 1 },
    },
  });
  return { stat, choice };
}

const readyTower = readyTowerBattleStat();
const readyTowerHarness = createHarness(readyTower.stat);
const activatedTower = await readyTowerHarness.host.activateTowerRunNode(readyTower.choice.id);
assert.equal(activatedTower.run.currentNode.id, readyTower.choice.id);
assert.equal(readyTowerHarness.stat().run.nodeContent[readyTower.choice.id].phase, 'consumed');
assert.equal(readyTowerHarness.stat().battle.enemy.name, '雾中猎手');
assert.equal(readyTowerHarness.stat().run_node.node_id, readyTower.choice.id);
assert.equal(readyTowerHarness.stat().run_node_reward.reward.card[0].id, 'mist_guard');
assert.deepEqual(readyTowerHarness.prompts, [], 'ready nodes must not ask AI to generate the same content again');
assert.deepEqual(readyTowerHarness.towerWakeReasons, ['node-activated'], 'route changes must wake stale-branch cancellation');

const rollbackReadyTower = readyTowerBattleStat();
const rollbackReadySnapshot = structuredClone(rollbackReadyTower.stat);
const activationRollbackHarness = createHarness(rollbackReadyTower.stat, { failUpdateAfterApplyOnce: true });
await assert.rejects(
  activationRollbackHarness.host.activateTowerRunNode(rollbackReadyTower.choice.id),
  /simulated update failure after apply/,
);
assert.deepEqual(
  activationRollbackHarness.stat(),
  rollbackReadySnapshot,
  'failed persistence restores battle, rewards, temporary node state, and the complete map snapshot',
);

const unavailableTower = readyTowerBattleStat();
unavailableTower.stat.run.nodeContent[unavailableTower.choice.id] = {
  ...unavailableTower.stat.run.nodeContent[unavailableTower.choice.id],
  phase: 'failed',
  content: undefined,
  error: 'generation failed',
};
const unavailableSnapshot = structuredClone(unavailableTower.stat);
const unavailableHarness = createHarness(unavailableTower.stat);
await assert.rejects(
  unavailableHarness.host.activateTowerRunNode(unavailableTower.choice.id),
  /content is not ready/,
);
assert.equal(unavailableHarness.updates(), 1, 'validation failure must not issue a compensating MVU write');
assert.deepEqual(unavailableHarness.stat(), unavailableSnapshot);

const staleRewardTower = readyTowerBattleStat();
delete staleRewardTower.stat.run.nodeContent[staleRewardTower.choice.id].reward.card[0].effects;
const staleRewardHarness = createHarness(staleRewardTower.stat);
await assert.rejects(
  staleRewardHarness.host.activateTowerRunNode(staleRewardTower.choice.id),
  /旧版或不完整内容已自动重新生成/,
);
assert.equal(staleRewardHarness.stat().run.nodeContent[staleRewardTower.choice.id].phase, 'queued');
assert.equal(staleRewardHarness.stat().run.nodeContent[staleRewardTower.choice.id].content, undefined);
assert.equal(staleRewardHarness.stat().run.nodeContent[staleRewardTower.choice.id].reward, undefined);
assert.deepEqual(staleRewardHarness.towerWakeReasons, ['invalid-ready-node-requeued']);

const towerRetryStat = {
  game_mode: 'tower',
  game_mode_lock: { schemaVersion: 1, mode: 'tower' },
  run: core.createRunState({ seed: 7373 }),
};
const queuedTower = towerAdapter.queueTowerLookaheadInStat(towerRetryStat);
const failedTowerRequest = queuedTower.queued[0];
towerAdapter.claimTowerGenerationInStat(towerRetryStat, failedTowerRequest.nodeId, failedTowerRequest.requestId);
towerAdapter.failTowerGenerationInStat(towerRetryStat, { ...failedTowerRequest, error: 'test failure' });
const towerRetryHarness = createHarness(towerRetryStat);
const retriedTowerRequest = await towerRetryHarness.host.retryTowerNodeGeneration(failedTowerRequest.nodeId);
assert.equal(retriedTowerRequest.nodeId, failedTowerRequest.nodeId);
assert.notEqual(retriedTowerRequest.requestId, failedTowerRequest.requestId);
assert.equal(towerRetryHarness.stat().run.nodeContent[failedTowerRequest.nodeId].phase, 'queued');

const restRetry = reach('rest', 2);
const retryRollbackHarness = createHarness({ run: restRetry }, { failBeforeSend: true });
await assert.rejects(
  retryRollbackHarness.host.retryRunNode(restRetry.currentNode, 'retry rest'),
  /simulated send failure/,
);
assert.equal(Object.hasOwn(retryRollbackHarness.stat(), 'run_result'), false);
assert.equal(Object.hasOwn(retryRollbackHarness.stat(), 'run_upgrade'), false);

const upgradeRequestHarness = createHarness(
  {
    run: restRetry,
    battle: {
      cards: [
        {
          id: 'guard',
          name: '守护',
          description: 'old prose',
          type: 'Skill',
          rarity: 'Common',
          cost: 1,
          effects: [{ block: 5 }],
          quantity: 2,
        },
      ],
    },
  },
  { failBeforeSend: true },
);
await assert.rejects(
  upgradeRequestHarness.host.requestRestUpgrade(restRetry.currentNode, {
    id: 'guard',
    name: '守护',
    description: 'old prose',
    cost: 1,
    effects: [{ block: 5 }],
    quantity: 2,
  }),
  /simulated send failure/,
);
assert.equal(Object.hasOwn(upgradeRequestHarness.stat(), 'run_upgrade'), false);
assert.match(upgradeRequestHarness.prompts[0], /^\[营火升级\]/);
assert.doesNotMatch(upgradeRequestHarness.prompts[0], /old prose|quantity/);

const transformRollbackHarness = createHarness(
  {
    run: restRetry,
    battle: {
      cards: [
        {
          id: 'guard',
          name: '守护',
          type: 'Skill',
          rarity: 'Common',
          cost: 1,
          quantity: 1,
          description: '获得格挡。',
          effects: [{ block: 5 }],
        },
      ],
      statuses: [],
    },
  },
  { failBeforeSend: true },
);
await assert.rejects(
  transformRollbackHarness.host.requestRestTransform(
    restRetry.currentNode,
    transformRollbackHarness.stat().battle.cards[0],
  ),
  /simulated send failure/,
);
assert.equal(Object.hasOwn(transformRollbackHarness.stat(), 'run_transform'), false);
assert.equal(Object.hasOwn(transformRollbackHarness.stat(), 'run_transform_target'), false);
assert.equal(
  transformRollbackHarness.stat().battle.cards[0].runInstanceId,
  undefined,
  'send rollback restores the legacy deck shape',
);

const transformCommitHarness = createHarness({
  run: restRetry,
  battle: {
    cards: [
      {
        id: 'guard',
        name: '守护',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        description: '获得格挡。',
        effects: [{ block: 5 }],
      },
    ],
    statuses: [],
    core: {},
  },
});
await transformCommitHarness.host.requestRestTransform(
  restRetry.currentNode,
  transformCommitHarness.stat().battle.cards[0],
);
const transformTarget = transformCommitHarness.stat().run_transform_target.run_instance_id;
assert.equal(transformCommitHarness.stat().run_transform, null);
assert.match(transformCommitHarness.prompts[0], /^\[营火变形\]/);
transformCommitHarness.stat().run_transform = {
  id: 'rest_attack',
  name: '营火斩击',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  quantity: 1,
  description: '造成伤害。',
  effects: [{ damage: 8 }],
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
    card: [
      {
        id: 'old_card',
        name: '旧候选',
        type: 'Attack',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        effects: [{ damage: 5 }],
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1 },
    disabled_categories: [],
    pool_revision: 0,
    reroll_count: 0,
  },
});
await rerollHarness.host.requestRewardReroll(['cards'], '[奖励重投]', 5);
assert.deepEqual(rerollHarness.stat().reward.card, []);
assert.equal(rerollHarness.stat().run.gold, 20, 'reroll preparation never spends gold');
rerollHarness.stat().reward.card = [
  {
    id: 'new_card',
    name: '新候选',
    type: 'Skill',
    rarity: 'Common',
    cost: 1,
    quantity: 1,
    effects: [{ block: 6 }],
  },
];
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
    card: [
      {
        id: 'spark',
        name: '火花',
        type: 'Attack',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        effects: [{ damage: 5 }],
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1, artifacts: 0, items: 0 },
  },
});
const normalReward = await normalRewardHarness.host.settleRewardSelections({ cards: [0], artifacts: [], items: [] });
assert.equal(normalReward.kind, 'reward');
assert.deepEqual(normalReward.summary.cards, ['火花']);

// A finished battle may remain visible below a newer story continuation.  Its
// reward controls must update the newest message, but only when the reward
// pool is still exactly the one that the old panel rendered.
const historicalDisplayedStat = {
  battle: { cards: [], artifacts: [], items: [], statuses: [], core: {} },
  reward: {
    card: [
      {
        id: 'history_spark',
        name: '旧楼层火花',
        type: 'Attack',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        effects: [{ damage: 5 }],
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1, artifacts: 0, items: 0 },
    pool_revision: 7,
  },
};
const historicalFingerprint = createRewardPoolFingerprint(historicalDisplayedStat);
let latestRewardVariables = structuredClone({ stat_data: historicalDisplayedStat });
let historicalWriteCalls = 0;
let latestRewardWriteCalls = 0;
const historicalRewardHost = new TavernRunActionHost({
  isLatest: () => false,
  updateVariablesWith: async () => {
    historicalWriteCalls += 1;
    throw new Error('historical message must remain read-only');
  },
  updateLatestVariablesWith: async updater => {
    latestRewardWriteCalls += 1;
    latestRewardVariables = await updater(latestRewardVariables);
    return latestRewardVariables;
  },
  continueWithPrompt: async () => undefined,
});
const historicalSettlement = await historicalRewardHost.settleRewardSelections(
  { cards: [0], artifacts: [], items: [] },
  { expectedReward: historicalFingerprint },
);
assert.deepEqual(historicalSettlement.summary.cards, ['旧楼层火花']);
assert.equal(historicalWriteCalls, 0, 'an old iframe must never write its own message variables');
assert.equal(latestRewardWriteCalls, 1, 'fingerprint-matched reward settles into the newest message');
assert.equal(latestRewardVariables.stat_data.battle.cards[0].id, 'history_spark');
assert.deepEqual(latestRewardVariables.stat_data.reward.card, []);

let changedLatestVariables = structuredClone({ stat_data: historicalDisplayedStat });
changedLatestVariables.stat_data.reward.card[0].id = 'replacement_pool_card';
const changedPoolHost = new TavernRunActionHost({
  isLatest: () => false,
  updateVariablesWith: async updater => updater(historicalDisplayedStat),
  updateLatestVariablesWith: async updater => {
    changedLatestVariables = await updater(changedLatestVariables);
    return changedLatestVariables;
  },
  continueWithPrompt: async () => undefined,
});
await assert.rejects(
  changedPoolHost.settleRewardSelections(
    { cards: [0], artifacts: [], items: [] },
    { expectedReward: historicalFingerprint },
  ),
  /奖励已经更新/,
);
assert.equal(changedLatestVariables.stat_data.battle.cards.length, 0, 'a changed pool must not grant a stale reward');
assert.equal(changedLatestVariables.stat_data.reward.card[0].id, 'replacement_pool_card');

const shopRun = reach('shop', 3);
const shopHarness = createHarness({
  run: shopRun,
  battle: { cards: [], artifacts: [], items: [], statuses: [], core: {} },
  reward: {
    card: [
      {
        id: 'shop_guard',
        name: '商店守护',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        effects: [{ block: 5 }],
        price: 999,
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1, artifacts: 0, items: 0 },
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
    card: [],
    artifact: [],
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
