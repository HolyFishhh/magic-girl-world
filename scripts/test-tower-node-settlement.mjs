import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const runCore = require('../src/game-core/runState.ts');
const contentCore = require('../src/game-core/towerContentState.ts');
const { migratePersistentRunDeck } = require('../src/game-core/cardIdentity.ts');
const { activateTowerNodeInStat } = require('../src/runtime/towerContentActivation.ts');
const {
  executeUnifiedRunTransactionInStat,
  settleTowerEventChoiceInStat,
} = require('../src/common/runTransactions.ts');

const baseBattle = () => ({
  core: { emoji: '✨', hp: 70, max_hp: 80, card_removal_count: 1, resources: [] },
  cards: [
    {
      id: 'starter_strike',
      name: '起手斩',
      type: 'Attack',
      rarity: 'Common',
      cost: 1,
      quantity: 2,
      description: '挥出稳定的一击。',
      effects: { damage: 6 },
    },
  ],
  statuses: [],
  artifacts: [],
  items: [],
});

function towerStat(run) {
  run.opening = {
    ...run.opening,
    phase: 'consumed',
    attempts: Math.max(1, run.opening.attempts),
    content: run.opening.content ?? { title: '已完成的开局馈赠', narrative: '', choices: [] },
  };
  return {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    run,
    battle: baseBattle(),
    reward: { card: [], artifact: [], item: [], limits: {} },
    run_node: null,
    run_node_reward: null,
    run_event: null,
    run_shop: null,
    run_treasure: null,
    run_rest: null,
  };
}

function reachableChoice(kind) {
  for (let seed = 1; seed <= 180; seed += 1) {
    let state = runCore.createRunState({ seed });
    const path = state.map.acts[0].paths.find(candidate =>
      candidate.some(nodeId => state.map.nodes.find(node => node.id === nodeId)?.kind === kind),
    );
    if (!path) continue;
    for (const nodeId of path) {
      const choice = state.choices.find(entry => entry.id === nodeId);
      assert.ok(choice);
      if (choice.kind === kind) return { state, choice };
      state = runCore.completeRunNode(runCore.enterRunNode(state, nodeId), { outcome: 'cleared' });
    }
  }
  throw new Error(`unable to reach ${kind}`);
}

function readyNode(stat, choice, content, reward) {
  let store = contentCore.queueTowerNodeContent(stat.run.nodeContent, choice.id, stat.run.stateRevision).store;
  store = contentCore.claimTowerGeneration(store, choice.id).store;
  const envelope = store[choice.id];
  store = contentCore.commitTowerGeneration(store, {
    nodeId: choice.id,
    requestId: envelope.requestId,
    basedOnRevision: envelope.basedOnRevision,
    content,
    ...(reward === undefined ? {} : { reward }),
  }).store;
  stat.run = { ...stat.run, nodeContent: store };
  activateTowerNodeInStat(stat, choice.id);
}

function assertNodePayloadCleared(stat) {
  for (const key of ['run_node', 'run_node_reward', 'run_event', 'run_shop', 'run_treasure', 'run_rest']) {
    assert.equal(stat[key], null, `${key} should be cleared after completing a node`);
  }
}

// Event scalars apply exactly once; its reward continues through the existing
// selectable reward transaction and then clears every temporary node payload.
{
  const reached = reachableChoice('event');
  const stat = towerStat(reached.state);
  readyNode(stat, reached.choice, {
    title: '星井的代价',
    narrative: '井中倒映出尚未发生的道路。',
    payload: {
      event: {
        choices: [
          {
            id: 'drink',
            label: '饮下星水',
            outcome: {
              hp: -5,
              max_hp: 4,
              gold: 7,
              card_removals: 1,
              reward: {
                items: [{ id: 'star_water', name: '星水', count: 1, effects: { heal: 5 } }],
              },
            },
          },
          { id: 'leave', label: '离开', outcome: {} },
        ],
      },
    },
  });
  const beforeGold = stat.run.gold;
  const result = settleTowerEventChoiceInStat(stat, 'drink');
  assert.equal(result.pendingReward, true);
  assert.equal(stat.battle.core.hp, 65);
  assert.equal(stat.battle.core.max_hp, 84);
  assert.equal(stat.battle.core.card_removal_count, 2);
  assert.equal(stat.run.gold, beforeGold + 7);
  assert.equal(stat.run.phase, 'in_node');
  assert.equal(stat.run_result.node_id, reached.choice.id);
  assert.equal(stat.run_event.selected_choice_id, 'drink');
  assert.equal(stat.reward.item[0].id, 'star_water');
  assert.throws(() => settleTowerEventChoiceInStat(stat, 'drink'), /已经选择/);

  executeUnifiedRunTransactionInStat(stat, {
    kind: 'event_reward_claim',
    selections: { cards: [], artifacts: [], items: [0] },
  });
  assert.equal(stat.run.phase, 'awaiting_choice');
  assert.equal(stat.battle.items[0].id, 'star_water');
  assertNodePayloadCleared(stat);
}

// A reward-free option completes immediately and cannot leave stale content.
{
  const reached = reachableChoice('event');
  const stat = towerStat(reached.state);
  readyNode(stat, reached.choice, {
    title: '安静岔路',
    payload: {
      event: {
        choices: [
          { id: 'continue', label: '继续', outcome: { gold: 3 } },
          { id: 'retreat', label: '退开', outcome: { outcome: 'escaped' } },
        ],
      },
    },
  });
  const result = settleTowerEventChoiceInStat(stat, 'continue');
  assert.equal(result.pendingReward, false);
  assert.equal(stat.run.phase, 'awaiting_choice');
  assert.equal(stat.run_result, null);
  assertNodePayloadCleared(stat);
}

// Shop leave, treasure claim, and rest settlement share the same cleanup rule.
{
  const reached = reachableChoice('shop');
  const stat = towerStat(reached.state);
  readyNode(
    stat,
    reached.choice,
    { title: '旅商', payload: { shop: { description: '旧毯上摆着货物。' } } },
    {
      cards: [],
      artifacts: [],
      items: [],
    },
  );
  executeUnifiedRunTransactionInStat(stat, { kind: 'shop_leave' });
  assert.equal(stat.run.phase, 'awaiting_choice');
  assertNodePayloadCleared(stat);
}
{
  const reached = reachableChoice('treasure');
  const stat = towerStat(reached.state);
  readyNode(
    stat,
    reached.choice,
    { title: '宝箱', payload: { treasure: { description: '锁扣弹开。' } } },
    {
      cards: [],
      artifacts: [],
      items: [{ id: 'small_tonic', name: '小药剂', count: 1, effects: { heal: 3 } }],
    },
  );
  executeUnifiedRunTransactionInStat(stat, {
    kind: 'treasure_reward_claim',
    selections: { cards: [], artifacts: [], items: [] },
  });
  assert.equal(stat.run.phase, 'awaiting_choice');
  assertNodePayloadCleared(stat);
}
{
  const reached = reachableChoice('rest');
  const stat = towerStat(reached.state);
  readyNode(stat, reached.choice, { title: '余烬', payload: { rest: { description: '火光温暖。' } } });
  executeUnifiedRunTransactionInStat(stat, { kind: 'rest_heal' });
  assert.equal(stat.run.phase, 'awaiting_choice');
  assertNodePayloadCleared(stat);
}

console.log('Tower event choices and non-battle node cleanup are atomic.');
