import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const run = require(resolve('src/game-core/runState.ts'));
const transactions = require(resolve('src/common/runTransactions.ts'));
const rewards = require(resolve('src/common/rewardTransactions.ts'));
const eventState = require(resolve('src/runtime/towerEventState.ts'));
const progression = require(resolve('src/game-core/cardProgression.ts'));
const acquisitionPreview = require(resolve('src/common/acquisitionPreview.ts'));
const settlementDisplay = require(resolve('src/game-core/nonCombatSettlementDisplay.ts'));
const contentDescription = require(resolve('src/game-core/contentDescription.ts'));
const effectDisplay = require(resolve('src/game-core/effectDisplay.ts'));

const reach = (kind, seed = 7) => {
  const initial = run.createRunState({ seed, routeMode: 'map' });
  for (const path of initial.map.acts[0].paths) {
    let state = initial;
    for (const nodeId of path) {
      const choice = state.choices.find(entry => entry.id === nodeId);
      if (!choice) break;
      if (choice.kind === kind) return run.enterRunNode(state, choice.id);
      state = run.completeRunNode(run.enterRunNode(state, nodeId), { outcome: 'cleared' });
    }
  }
  throw new Error(`seed ${seed} did not reach ${kind}`);
};
const card = (id, name = id, type = 'Skill') => ({
  id, name, type, rarity: 'Common', cost: 1, quantity: 1, effects: { block: 2 },
});
const item = (id, name = id) => ({ id, name, count: 1, effects: { heal: 2 } });
const baseStat = (event, seed = 7) => {
  const active = reach('event', seed);
  active.gold = 30;
  return {
    run: active,
    battle: { core: { hp: 25, max_hp: 30, lust: 0, max_lust: 100, card_removal_count: 0, resources: [{ id: 'spark', name: '火花', current: 3, max: 9 }] },
      cards: [card('remove_me', '待移除'), card('transform_me', '待变形'), card('spare', '备用')], artifacts: [], items: [], statuses: [] },
    reward: { card: [], artifact: [], item: [], limits: {} },
    run_event: event,
  };
};
const fullReplacement = card('replacement', '完全替换');
const twoStageEvent = {
  spec: 'mwg.tower-event/v2', start_stage: 'one', stages: [
    { id: 'one', choices: [{ id: 'pay_and_choose', label: '支付', next_stage: 'two', outcome: {
      outcome: 'cleared', cost: { gold: 5 }, card_removals: 1,
      deck_actions: [
        { id: 'remove', kind: 'remove', count: 1, pick: 'choose', filter: { ids: ['remove_me'] } },
        { id: 'transform', kind: 'transform', count: 1, pick: 'choose', filter: { ids: ['transform_me'] }, replacement: fullReplacement },
      ],
      grant: { cards: [card('grant_a', '赠卡甲'), card('grant_b', '赠卡乙')], items: [item('grant_item', '赠礼')], limits: { cards: 1, items: 1 } },
      reward: { card: [card('stage_reward', '阶段奖励')], artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 } },
    } }] },
    { id: 'two', choices: [{ id: 'finish', label: '结束', outcome: { outcome: 'cleared', gold: 2 } }] },
  ],
};

const stat = baseStat(structuredClone(twoStageEvent));
eventState.materializeTowerEventStageInStat(stat);
const ids = Object.fromEntries(stat.battle.cards.map(entry => [entry.id, entry.runInstanceId]));
const first = transactions.executeUnifiedRunTransactionInStat(stat, {
  kind: 'event_step', choiceId: 'pay_and_choose', stageId: 'one', expectedEventRevision: 0, expectedRevision: 0,
  answers: { deck: { remove: [ids.remove_me], transform: [ids.transform_me] }, grant: { cards: [1], items: [0] } },
});
assert.equal(first.value.pendingReward, true);
assert.equal(stat.run.gold, 25, 'cost commits before the held outer reward');
assert.equal(stat.battle.core.card_removal_count, 1);
assert.equal(stat.battle.cards.some(entry => entry.id === 'remove_me'), false);
assert.equal(stat.battle.cards.find(entry => entry.runInstanceId === ids.transform_me).id, 'replacement', 'transform replaces the selected persistent instance');
assert.ok(stat.battle.cards.some(entry => entry.id === 'grant_b'));
assert.ok(stat.battle.items.some(entry => entry.id === 'grant_item'));
assert.equal(stat.run_event_state.phase, 'reward');
assert.equal(stat.run_event_state.next_stage, 'two');
assert.equal(stat.run.currentNode.kind, 'event', 'an outer reward holds the stage route');
transactions.executeUnifiedRunTransactionInStat(stat, {
  kind: 'event_reward_claim', selections: { cards: [0], artifacts: [], items: [] }, expectedRevision: 1,
});
assert.equal(stat.run_event_state.phase, 'choosing');
assert.equal(stat.run_event_state.stage_id, 'two', 'claiming the intermediate reward advances to the next fixed stage');
transactions.executeUnifiedRunTransactionInStat(stat, {
  kind: 'event_step', choiceId: 'finish', stageId: 'two', expectedEventRevision: 2, expectedRevision: 2,
});
assert.equal(stat.run.phase, 'awaiting_choice', 'only the terminal stage consumes the route node');
assert.equal(stat.run_event, null);

for (const request of [
  { kind: 'event_step', choiceId: 'pay_and_choose', stageId: 'one', expectedEventRevision: 0, expectedRevision: 0, answers: {} },
  { kind: 'event_step', choiceId: 'pay_and_choose', stageId: 'wrong', expectedEventRevision: 0, expectedRevision: 0, answers: { deck: {}, grant: { cards: [0], items: [0] } } },
  { kind: 'event_step', choiceId: 'pay_and_choose', stageId: 'one', expectedEventRevision: 0, expectedRevision: 1, answers: { deck: {}, grant: { cards: [0], items: [0] } } },
]) {
  const rejected = baseStat(structuredClone(twoStageEvent));
  eventState.materializeTowerEventStageInStat(rejected);
  const before = structuredClone(rejected);
  assert.throws(() => transactions.executeUnifiedRunTransactionInStat(rejected, request));
  assert.deepEqual(rejected, before, 'cancelled, stale, or incomplete event choices must not mutate');
}
const poor = baseStat(structuredClone(twoStageEvent)); poor.run.gold = 4; eventState.materializeTowerEventStageInStat(poor);
const poorBefore = structuredClone(poor);
const poorIds = Object.fromEntries(poor.battle.cards.map(entry => [entry.id, entry.runInstanceId]));
assert.throws(() => transactions.executeUnifiedRunTransactionInStat(poor, { kind: 'event_step', choiceId: 'pay_and_choose', stageId: 'one', expectedEventRevision: 0, expectedRevision: 0, answers: { deck: { remove: [poorIds.remove_me], transform: [poorIds.transform_me] }, grant: { cards: [0], items: [0] } } }), /金币成本不可支付/);
assert.deepEqual(poor, poorBefore, 'an unaffordable event leaves its cost, deck, pool, and route intact');

const randomEvent = { spec: 'mwg.tower-event/v2', start_stage: 'only', stages: [{ id: 'only', choices: [{ id: 'frozen', label: '固定', outcome: { outcome: 'cleared', deck_actions: [{ id: 'random_remove', kind: 'remove', count: 1, pick: 'random' }] } }] }] };
const randomStat = baseStat(randomEvent, 31);
eventState.materializeTowerEventStageInStat(randomStat);
const frozen = structuredClone(randomStat.run_event_state.random_targets);
const restored = JSON.parse(JSON.stringify(randomStat));
assert.deepEqual(restored.run_event_state.random_targets, frozen, 'save restoration keeps preplanned random identities');
transactions.executeUnifiedRunTransactionInStat(restored, { kind: 'event_step', choiceId: 'frozen', stageId: 'only', expectedEventRevision: 0, expectedRevision: 0 });
const chosen = frozen[JSON.stringify(['frozen', 'random_remove'])][0];
assert.equal(restored.battle.cards.some(entry => entry.runInstanceId === chosen), false, 'event execution consumes the frozen identity without rerolling');

// Sequential random actions use the deck left by the preceding action.
for (const firstPick of ['random', 'choose']) {
  const sequentialEvent = structuredClone(randomEvent);
  sequentialEvent.stages[0].choices[0].outcome.deck_actions = [
    { id: 'first', kind: 'remove', count: 1, pick: firstPick },
    { id: 'second', kind: 'remove', count: 1, pick: 'random' },
  ];
  const sequential = baseStat(sequentialEvent, 31);
  eventState.materializeTowerEventStageInStat(sequential);
  const saved = JSON.parse(JSON.stringify(sequential));
  const firstId = firstPick === 'choose' ? saved.battle.cards[0].runInstanceId
    : saved.run_event_state.random_targets[JSON.stringify(['frozen', 'first'])][0];
  const left = saved.battle.cards.filter(entry => entry.runInstanceId !== firstId);
  const seed = saved.run_event_state.random_seeds?.[JSON.stringify(['frozen', 'second'])];
  const secondIds = seed
    ? require(resolve('src/game-core/nonCombatDeckActions.ts')).planNonCombatDeckAction(left,
      sequentialEvent.stages[0].choices[0].outcome.deck_actions[1], seed).selectedIds
    : saved.run_event_state.random_targets[JSON.stringify(['frozen', 'second'])];
  assert.notEqual(secondIds[0], firstId, 'the second action cannot consume an already removed instance');
  transactions.executeUnifiedRunTransactionInStat(saved, {
    kind: 'event_step', choiceId: 'frozen', stageId: 'only', expectedEventRevision: 0, expectedRevision: 0,
    answers: { deck: { first: [firstId], second: secondIds } },
  });
  assert.equal(saved.battle.cards.length, 1, `${firstPick} then random commits both actions after JSON restore`);
  assert.deepEqual(sequential.run_event_state, JSON.parse(JSON.stringify(sequential.run_event_state)), 'preview/restore never redraws stage state');
}

const staleRandom = baseStat(randomEvent, 31);
eventState.materializeTowerEventStageInStat(staleRandom);
const staleBefore = structuredClone(staleRandom);
assert.throws(() => transactions.executeUnifiedRunTransactionInStat(staleRandom, {
  kind: 'event_step', choiceId: 'frozen', stageId: 'only', expectedEventRevision: 0, expectedRevision: 0,
  answers: { deck: { random_remove: ['different-preview-instance'] } },
}), /随机选牌结果已变化/);
assert.deepEqual(staleRandom, staleBefore, 'a changed random preview is rejected without cost/deck writes');

const pickup = {
  id: 'pickup_only', name: '领取遗物', rarity: 'Rare', on_acquire: {
    max_hp: 3, gold: 6, card_removals: 1, gain_cards: [card('acquired_card', '获得卡')],
    deck_actions: [{ id: 'delete', kind: 'remove', count: 1, pick: 'choose', filter: { ids: ['remove_me'] } }],
    grant: { cards: [card('pick_card', '选择卡')], items: [item('pick_item', '选择物')], limits: { cards: 1, items: 1 } },
  },
};
const dual = { ...structuredClone(pickup), id: 'dual_relic', trigger: { on: 'battle_start', effects: { block: 2 } } };
dual.on_acquire.deck_actions[0].filter.ids = ['transform_me'];
const rewardStat = baseStat({});
rewardStat.reward = { card: [], artifact: [pickup, dual], item: [], limits: { cards: 0, artifacts: 2, items: 0 } };
rewardStat.battle.cards = progression.migratePersistentRunDeck(rewardStat.battle.cards);
const rewardIds = Object.fromEntries(rewardStat.battle.cards.map(entry => [entry.id, entry.runInstanceId]));
const summary = rewards.applyRewardSelectionsToStat(rewardStat, { cards: [], artifacts: [0, 1], items: [] }, {
  acquisitionAnswers: {
    pickup_only: { deck: { delete: [rewardIds.remove_me] }, grant: { cards: [0], items: [0] } },
    dual_relic: { deck: { delete: [rewardIds.transform_me] }, grant: { cards: [0], items: [0] } },
  },
});
assert.deepEqual(summary.artifacts, ['领取遗物', '领取遗物']);
assert.equal(rewardStat.run.gold, 42, 'each acquired relic settles gold exactly once');
assert.equal(rewardStat.battle.core.max_hp, 36);
assert.equal(rewardStat.battle.core.card_removal_count, 2);
assert.equal(rewardStat.battle.cards.some(entry => entry.id === 'remove_me'), false);
assert.equal(rewardStat.battle.cards.some(entry => entry.id === 'transform_me'), false);
assert.equal(rewardStat.battle.artifacts.length, 2);
assert.equal(rewardStat.battle.items.find(entry => entry.id === 'pick_item').count, 2, 'matching item grants stack while both acquisitions remain atomic');

const failedPickup = baseStat({});
failedPickup.reward = { card: [], artifact: [pickup], item: [], limits: { cards: 0, artifacts: 1, items: 0 } };
const failedBefore = structuredClone(failedPickup);
assert.throws(() => rewards.applyRewardSelectionsToStat(failedPickup, { cards: [], artifacts: [0], items: [] }), /请先完成选牌/);
assert.deepEqual(failedPickup, failedBefore, 'failed relic acquisition preserves the pool, gold, ownership, and every other write');

const previewPickup = { ...structuredClone(pickup), id: 'preview_pickup' };
previewPickup.on_acquire.deck_actions[0].filter.ids = ['preview_card'];
const previewStat = baseStat({});
previewStat.reward = {
  card: [card('preview_card', '刚获得的卡')], artifact: [previewPickup], item: [],
  limits: { cards: 1, artifacts: 1, items: 0 },
};
const previewBefore = structuredClone(previewStat);
const preview = acquisitionPreview.previewAcquisition(previewStat, {
  kind: 'reward', selections: { cards: [0], artifacts: [0], items: [] },
});
assert.deepEqual(previewStat, previewBefore, 'acquisition preview never writes the live stat');
const previewCard = progression.migratePersistentRunDeck(preview.stat.battle.cards).find(entry => entry.id === 'preview_card');
assert.ok(previewCard?.runInstanceId, 'preview contains the newly selected card with its deterministic persistent identity');
assert.equal(preview.artifacts[0].id, 'preview_pickup');
rewards.applyRewardSelectionsToStat(previewStat, { cards: [0], artifacts: [0], items: [] }, {
  acquisitionAnswers: { preview_pickup: { deck: { delete: [previewCard.runInstanceId] }, grant: { cards: [0], items: [0] } } },
});
assert.equal(previewStat.battle.cards.some(entry => entry.id === 'preview_card'), false, 'the answer collected from preview commits against the same identity');

const shopStat = baseStat({});
shopStat.run = reach('shop', 51); shopStat.run.gold = 200;
shopStat.reward = { card: [], artifact: [{ ...structuredClone(previewPickup), price: 7 }], item: [], limits: { cards: 0, artifacts: 1, items: 0 } };
const shopBefore = structuredClone(shopStat);
const shopPreview = acquisitionPreview.previewAcquisition(shopStat, { kind: 'shop', selections: { cards: [], artifacts: [0], items: [] } });
assert.deepEqual(shopStat, shopBefore, 'shop acquisition preview does not pre-charge gold');
assert.ok(shopPreview.stat.run.gold < 200, 'shop preview collects answers after the real purchase cost is applied');

const openingRun = run.createRunState({ seed: 61 });
openingRun.opening = { phase: 'ready', requestId: 'opening', basedOnRevision: 0, attempts: 1, content: {
  title: '开局', narrative: '', choices: [{ id: 'take', label: '拿取', outcome: { max_hp: 4, reward: { cards: [], artifacts: [previewPickup], items: [] } } }],
} };
const openingStat = { run: openingRun, battle: { core: { hp: 20, max_hp: 30, lust: 0, max_lust: 100, card_removal_count: 0, resources: [] }, cards: [], artifacts: [], items: [], statuses: [] }, reward: { card: [], artifact: [], item: [], limits: {} } };
const openingBefore = structuredClone(openingStat);
const openingPreview = acquisitionPreview.previewAcquisition(openingStat, { kind: 'opening', choiceId: 'take' });
assert.deepEqual(openingStat, openingBefore, 'opening preview does not consume the gift');
assert.equal(openingPreview.stat.battle.core.max_hp, 34);
assert.equal(openingPreview.stat.battle.core.hp, 34, 'opening preview exposes the restored post-growth HP used by acquisition');

const namedFilter = settlementDisplay.describeNonCombatSettlement({ deck_actions: [{ id: 'named', kind: 'remove', count: 1, pick: 'choose', filter: { ids: ['preview_card'] } }] }, { cardNames: { preview_card: '刚获得的卡' } });
const typedFilter = settlementDisplay.describeNonCombatSettlement({ deck_actions: [{ id: 'typed', kind: 'duplicate', count: 1, pick: 'choose', filter: { types: ['Attack', 'Skill'] } }] });
assert.match(namedFilter, /刚获得的卡/);
assert.match(typedFilter, /攻击牌、技能牌/);
const displayArtifact = { id: 'display_pickup', name: '显示遗物', on_acquire: { deck_actions: [{ id: 'display', kind: 'remove', count: 1, pick: 'choose', filter: { ids: ['preview_card'] } }] } };
assert.match(contentDescription.describeCompactContent(displayArtifact, { cardNames: { preview_card: '刚获得的卡' } }), /刚获得的卡/);
assert.match(effectDisplay.compactContentToDisplayTags(displayArtifact, { cardNames: { preview_card: '刚获得的卡' } }).map(tag => tag.text).join('；'), /刚获得的卡/);

console.log('Non-combat event and relic transactions preserve stage, frozen-target, and atomic acquisition contracts.');
// Combat multiplier output is valid input to free and paid event settlement.
for(const hp of [20.2,0.2]){
 const fractional=baseStat({choices:[{id:'take',label:'领取',outcome:{gain_cards:[card('fractional_gift')],card_removals:1}},{id:'leave',label:'离开',outcome:{}}]});
 fractional.battle.core.hp=hp;fractional.battle.core.lust=1.5;
 eventState.materializeTowerEventStageInStat(fractional);
 const restored=JSON.parse(JSON.stringify(fractional));
 transactions.executeUnifiedRunTransactionInStat(restored,{kind:'event_step',choiceId:'take',expectedRevision:0});
 assert.equal(restored.battle.core.hp,hp,'free rewards do not reject or round fractional combat HP');
 assert.equal(restored.battle.core.lust,1.5);assert.equal(restored.battle.core.card_removal_count,1);
 assert.ok(restored.battle.cards.some(c=>c.id==='fractional_gift'));
}

