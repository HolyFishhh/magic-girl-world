import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const runCore = require('../src/game-core/runState.ts');
const contentCore = require('../src/game-core/towerContentState.ts');
const progressionCore = require('../src/game-core/cardProgression.ts');
const activation = require('../src/runtime/towerContentActivation.ts');
const runAdapter = require('../src/runtime/runStateAdapter.ts');

const baseBattle = () => ({
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
  player_lust_effect: { name: '清醒', description: '抓住敌人的破绽。', effects: { draw: 1 } },
  enemy: null,
  enemies: [],
  level: 1,
  exp: 0,
});

function towerStat(run) {
  return {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    run,
    battle: baseBattle(),
    reward: { card: [], artifact: [], item: [], limits: {} },
  };
}

function reachableChoice(kind) {
  for (let seed = 1; seed <= 100; seed += 1) {
    let state = runCore.createRunState({ seed });
    const path = state.map.acts[0].paths.find(candidate =>
      candidate.some(nodeId => {
        const node = state.map.nodes.find(entry => entry.id === nodeId);
        return node?.kind === kind;
      }),
    );
    if (!path) continue;
    for (const nodeId of path) {
      const choice = state.choices.find(entry => entry.id === nodeId);
      assert.ok(choice, `${nodeId} should remain selectable along its generated path`);
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
}

const validEnemy = {
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
};

const validReward = {
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
      description: '从雾中切出一道短促的锋芒。',
      effects: { damage: 7 },
    },
    {
      id: 'mist_cycle',
      name: '雾流',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 1,
      quantity: 1,
      description: '让雾气带来新的战术选择。',
      effects: { draw: 1 },
    },
  ],
  artifact: [{
    id: 'normal_battle_extra_relic',
    name: '应被裁掉的遗物',
    rarity: 'Common',
    trigger: { on: 'battle_start', effects: { block: 1 } },
  }],
  item: [{ id: 'mist_salve', name: '雾露药剂', count: 1, effects: { heal: 6 } }],
  limits: { cards: 3, artifacts: 1, items: 1 },
};

// A previous battle may have persisted the final use of a consumable as
// count=0. Entering the next prepared room self-heals that legacy record
// instead of rejecting valid enemy content.
{
  const battle = baseBattle();
  battle.items = [
    { id: 'empty_tonic', name: 'Empty tonic', count: 0, effects: { heal: 4 } },
    { id: 'spare_tonic', name: 'Spare tonic', count: 1, effects: { heal: 4 } },
  ];
  const prepared = activation.prepareTowerBattleForActivation(battle, { enemy: validEnemy });
  assert.deepEqual(prepared.items.map(item => item.id), ['spare_tonic']);
  assert.equal(prepared.enemy.id, 'tower_enemy_1');
  assert.equal(prepared.enemies[0].id, 'tower_enemy_1');
}

// Provider-friendly namespaced enemy IDs are made runtime-safe at the tower
// boundary, including exact references to those IDs. Distinct IDs that
// normalize to the same stem remain deterministic and unique.
{
  const prepared = activation.prepareTowerBattleForActivation(baseBattle(), {
    enemies: [
      { ...validEnemy, id: 'machine:front:1' },
      {
        ...validEnemy,
        id: 'machine-front-1',
        name: 'rear unit',
        actions: [{ name: 'mark front', effects: { damage: 2 } }],
      },
    ],
  });
  assert.deepEqual(prepared.enemies.map(enemy => enemy.id), ['machine_front_1', 'machine_front_1_2']);
  assert.equal(prepared.enemy.id, 'machine_front_1');

  const referenced = activation.normalizeTowerBattleEnemyIdentifiers({
    enemies: [
      { ...validEnemy, id: 'machine:front:1' },
      { ...validEnemy, id: 'machine-front-1', linkage: { id: 'machine:front:1' } },
    ],
  });
  assert.equal(referenced.enemies[1].linkage.id, 'machine_front_1');
}

// Known live reward-pool bookkeeping may be echoed by older prompts/providers;
// it is ignored without weakening rejection of unknown authored fields.
{
  const normalized = activation.normalizeTowerReward({
    ...validReward,
    request: { kind: 'runtime-only' },
    disabled_categories: ['items'],
    pool_revision: 9,
    reroll_count: 3,
  }, baseBattle());
  assert.equal(normalized.card[0].id, 'mist_guard');
  assert.equal(normalized.pool_revision, 0);
  assert.equal(normalized.reroll_count, 0);
  assert.deepEqual(normalized.disabled_categories, []);
  assert.throws(
    () => activation.normalizeTowerReward({ ...validReward, invented_pool_field: true }, baseBattle()),
    /unsupported field: invented_pool_field/,
  );
}

// Future nodes can be generated before the player acquires an identically
// named card. Different rules receive a deterministic fresh ID at activation
// instead of blocking the route, while the persistent deck is left untouched.
{
  const battle = baseBattle();
  const normalized = activation.normalizeTowerReward({
    card: [{
      id: 'starter_strike',
      name: '璧锋墜鏂?鍙樺紡',
      type: 'Attack',
      rarity: 'Common',
      cost: 1,
      quantity: 1,
      effects: { damage: 11 },
    }],
    artifact: [],
    item: [],
  }, battle);
  assert.match(normalized.card[0].id, /^starter_strike__tower_[a-z0-9]+$/);
  assert.equal(battle.cards[0].id, 'starter_strike');
}

// Lookahead offers are generated before the current room is settled. A relic
// obtained in the meantime makes the matching future candidate stale, not the
// whole route invalid. Other categories remain available and the pick limit
// is reconciled to the filtered pool.
{
  const battle = baseBattle();
  const owned = structuredClone(validReward.artifact[0]);
  battle.artifacts.push(owned);
  const normalized = activation.normalizeTowerReward({
    card: [validReward.card[0]],
    artifact: [structuredClone(owned)],
    item: [validReward.item[0]],
    limits: { cards: 1, artifacts: 1, items: 1 },
  }, battle);
  assert.equal(normalized.card.length, 1);
  assert.deepEqual(normalized.artifact, []);
  assert.equal(normalized.item.length, 1);
  assert.deepEqual(normalized.limits, { cards: 1, artifacts: 0, items: 1 });
}

// Filtering is limited to an otherwise valid relic that was already owned
// before activation. Malformed candidates and duplicate IDs created inside a
// fresh pool remain strict generation errors.
{
  const battle = baseBattle();
  const owned = structuredClone(validReward.artifact[0]);
  battle.artifacts.push(owned);
  assert.throws(
    () => activation.normalizeTowerReward({
      card: [],
      artifact: [{ ...owned, trigger: { on: 'unknown_trigger', effects: { block: 1 } } }],
      item: [],
    }, battle),
    /reward artifacts is invalid/,
  );
}
{
  const duplicate = structuredClone(validReward.artifact[0]);
  assert.throws(
    () => activation.normalizeTowerReward({
      card: [],
      artifact: [duplicate, structuredClone(duplicate)],
      item: [],
    }, baseBattle()),
    /遗物已持有/,
  );
}

// A ready battle enters atomically, preserves the deck, consumes content, and
// keeps its already-validated reward hidden until the victory settlement.
{
  const reached = reachableChoice('battle');
  const stat = towerStat(reached.state);
  stat.battle.core.hp = 97.3;
  stat.battle.core.lust = 2.7;
  stat.battle.cards = progressionCore.migratePersistentRunDeck(stat.battle.cards);
  assert.equal(stat.battle.cards.length, 4, 'tower rewards preserve one record per owned card');
  readyNode(
    stat,
    reached.choice,
    {
      title: '雾路伏击',
      narrative: '雾气中亮起一双冷眼。',
      payload: { battle: { enemy: validEnemy } },
      program_balance: { playerDeckScore: 140, finalEnemyScore: 112, finalRatio: 80 },
    },
    validReward,
  );
  const previous = stat.run;
  const result = activation.activateTowerNodeInStat(stat, reached.choice.id);
  assert.equal(result.previous, previous);
  assert.equal(result.run.phase, 'in_node');
  assert.equal(result.run.currentNode.id, reached.choice.id);
  assert.equal(result.run.nodeContent[reached.choice.id].phase, 'consumed');
  assert.equal(stat.battle.enemy.name, '雾中猎手');
  assert.equal(stat.battle.enemies.length, 1);
  assert.equal(stat.battle.core.hp, 97, 'tower entry clears fractional hp left by older scaled encounters');
  assert.equal(stat.battle.core.lust, 3, 'tower entry clears fractional desire left by older scaled encounters');
  assert.equal(stat.battle.cards[0].id, 'starter_strike', 'background content cannot replace the deck');
  assert.equal(stat.reward.card.length, 0, 'battle rewards must not be claimable before victory');
  assert.equal(stat.run_node_reward.node_id, reached.choice.id);
  assert.equal(stat.run_node_reward.reward.card[0].id, 'mist_guard');
  assert.equal(stat.run_node_reward.reward.card.length, 3);
  assert.equal(stat.run_node_reward.reward.artifact.length, 0, 'normal battles cannot stage relic rewards');
  assert.equal(stat.run_node_reward.reward.item.length, 1);
  assert.deepEqual(stat.run_node_reward.reward.limits, { cards: 1, artifacts: 0, items: 1 });
  assert.equal(stat.run_node.title, '雾路伏击');
  assert.equal(stat.run_node.program_balance.playerDeckScore, 140);
  assert.equal(stat.run_node.program_balance.finalEnemyScore, 112);
  assert.equal(result.rewardStaged, true);
  const sibling = previous.choices.find(choice => choice.id !== reached.choice.id);
  assert.equal(stat.run.nodeContent[sibling.id].phase, 'abandoned');
}

// Activation persists normalized enemy IDs back into the consumed lookahead
// envelope, so reload/restoration does not depend on repeating the repair.
{
  const reached = reachableChoice('battle');
  const stat = towerStat(reached.state);
  const first = { ...structuredClone(validEnemy), id: 'machine:front:1', name: 'Front machine' };
  const second = { ...structuredClone(validEnemy), id: 'machine-back-1', name: 'Back machine' };
  readyNode(
    stat,
    reached.choice,
    { payload: { battle: { enemies: [first, second] } } },
    validReward,
  );
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  const persisted = stat.run.nodeContent[reached.choice.id].content.payload.battle.enemies;
  assert.deepEqual(persisted.map(enemy => enemy.id), ['machine_front_1', 'machine_back_1']);
  assert.deepEqual(stat.battle.enemies.map(enemy => enemy.id), ['machine_front_1', 'machine_back_1']);
}

// Common model aliases are converted to the executable weighted probability
// contract before the enemy is persisted.
{
  const reached = reachableChoice('battle');
  const stat = towerStat(reached.state);
  const weightedEnemy = structuredClone(validEnemy);
  weightedEnemy.actions = [
    { name: '轻击', weight: 3, effects: { damage: 4 } },
    { name: '重击', weight: 1, effects: { damage: 9 } },
  ];
  weightedEnemy.action_mode = 'weighted';
  weightedEnemy.action_config = {};
  readyNode(stat, reached.choice, { payload: { battle: { enemy: weightedEnemy } } }, validReward);
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  assert.equal(stat.battle.enemy.action_mode, 'probability');
  assert.deepEqual(stat.battle.enemy.action_config, { probability: { 轻击: 3, 重击: 1 } });
  assert.deepEqual(stat.battle.enemies[0], stat.battle.enemy);
}

// Invalid battle content and invalid rewards both leave every stat field and
// the ready envelope untouched.
{
  const reached = reachableChoice('battle');
  const stat = towerStat(reached.state);
  readyNode(
    stat,
    reached.choice,
    {
      payload: { battle: { enemy: { name: '无行动敌人', actions: [] } } },
    },
    validReward,
  );
  const before = structuredClone(stat);
  assert.throws(() => activation.activateTowerNodeInStat(stat, reached.choice.id), /battle content is invalid/);
  assert.deepEqual(stat, before);
  assert.equal(stat.run.nodeContent[reached.choice.id].phase, 'ready');
}
{
  const reached = reachableChoice('battle');
  const stat = towerStat(reached.state);
  readyNode(
    stat,
    reached.choice,
    { payload: { battle: { enemy: validEnemy } } },
    {
      card: [
        {
          id: 'broken_reward',
          name: '错误奖励',
          type: 'Attack',
          rarity: 'Common',
          cost: 1,
          quantity: 1,
          effects: { damage: 'unknown + 1' },
        },
        validReward.card[1],
        validReward.card[2],
      ],
      artifact: [],
      item: validReward.item,
    },
  );
  const before = structuredClone(stat);
  assert.throws(() => activation.activateTowerNodeInStat(stat, reached.choice.id), /reward cards is invalid/);
  assert.deepEqual(stat, before);
}

// Each non-battle node receives only its own temporary payload. Shop and
// treasure expose validated candidates immediately; treasure never settles as battle.
{
  const reached = reachableChoice('shop');
  const stat = towerStat(reached.state);
  readyNode(
    stat,
    reached.choice,
    {
      title: '旅商帐篷',
      payload: { shop: { description: '几件货物摆在旧毯上。' } },
    },
    { card: [], artifact: [], item: [{ id: 'salve', name: '伤药', count: 1, effects: { heal: 8 } }] },
  );
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  assert.equal(stat.run_shop.description, '几件货物摆在旧毯上。');
  assert.equal(stat.reward.item[0].id, 'salve');
  assert.equal(stat.run_node_reward, null);
}
{
  const reached = reachableChoice('treasure');
  const stat = towerStat(reached.state);
  const battleBefore = structuredClone(stat.battle);
  readyNode(
    stat,
    reached.choice,
    {
      title: '尘封宝箱',
      payload: { treasure: { description: '锁扣自行弹开。' } },
    },
    { card: [], artifact: [], item: [{ id: 'ether', name: '以太露', count: 1, effects: { heal: 5 } }] },
  );
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  assert.equal(stat.run.currentNode.kind, 'treasure');
  assert.equal(stat.run_treasure.description, '锁扣自行弹开。');
  assert.equal(stat.reward.item[0].id, 'ether');
  assert.deepEqual(stat.battle, battleBefore, 'treasure activation must not mutate battle content');
  assert.equal(runAdapter.settleBattleRunInStat(stat, 'victory'), null, 'treasure must not use battle settlement');
}
{
  const reached = reachableChoice('event');
  const stat = towerStat(reached.state);
  readyNode(stat, reached.choice, {
    title: '岔路低语',
    payload: {
      event: {
        choices: [
          {
            id: 'listen',
            label: '聆听',
            outcome: {
              gold: 5,
              reward: {
                cards: [],
                artifacts: [],
                items: [{ id: 'whisper_draught', name: '低语药剂', count: 1, effects: { heal: 4 } }],
              },
            },
          },
          { id: 'leave', label: '离开', outcome: {} },
        ],
      },
    },
  });
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  assert.deepEqual(
    stat.run_event.choices.map(choice => choice.id),
    ['listen', 'leave'],
  );
  assert.equal(stat.run_event.choices[0].outcome.reward.item[0].id, 'whisper_draught');
  assert.equal(stat.run_node_reward, null);
}
{
  const reached = reachableChoice('rest');
  const stat = towerStat(reached.state);
  readyNode(stat, reached.choice, { title: '余烬营火', payload: { rest: { description: '火光稳定地摇曳。' } } });
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  assert.equal(stat.run_rest.description, '火光稳定地摇曳。');
  assert.equal(stat.reward.card.length, 0);
}

// Not-ready, unreachable, and story-mode activations are rejected without writes.
{
  const run = runCore.createRunState({ seed: 808 });
  const stat = towerStat(run);
  const before = structuredClone(stat);
  assert.throws(() => activation.activateTowerNodeInStat(stat, run.choices[0].id), /not ready/);
  assert.deepEqual(stat, before);
  assert.throws(
    () => activation.activateTowerNodeInStat(stat, run.map.acts[1].startNodeIds[0]),
    /not currently reachable/,
  );
  assert.deepEqual(stat, before);
}
{
  const run = runCore.createRunState({ seed: 909 });
  const stat = towerStat(run);
  stat.game_mode = 'story';
  stat.game_mode_lock = { schemaVersion: 1, mode: 'story' };
  const before = structuredClone(stat);
  assert.throws(() => activation.activateTowerNodeInStat(stat, run.choices[0].id), /story mode/);
  assert.deepEqual(stat, before);
}

console.log('Tower node activation validation, atomicity, staging, and settlement-boundary tests passed.');
