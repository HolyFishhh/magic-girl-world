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
const { recommendTowerBattleGold, recommendTowerBattleRewardBudget } = require('../src/game-core/contentBudget.ts');

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

const clampedTreasureReward = activation.normalizeTowerReward(
  {
    cards: [],
    artifacts: [],
    items: [{ id: 'small_tonic', name: '小型药剂', count: 1, effects: { heal: 3 } }],
    limits: { cards: 0, artifacts: 1, items: 1 },
  },
  baseBattle(),
);
assert.deepEqual(
  clampedTreasureReward.limits,
  { cards: 0, artifacts: 0, items: 1 },
  'selection metadata is clamped to the candidates that actually exist',
);

const normalizedStatusReward = activation.normalizeTowerReward(
  {
    card: [
      {
        id: 'status_reward',
        name: '状态馈赠',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        effects: { apply_status: { id: 'reward_focus', stacks: 2, to: 'self' } },
        statuses: [
          {
            id: 'reward_focus',
            name: '专注',
            emoji: '✨',
            type: 'buff',
            triggers: { stacks_change: -1, hold: { modify: { stat: 'damage', add: 'stacks' } } },
          },
        ],
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1, artifacts: 0, items: 0 },
  },
  baseBattle(),
);
assert.deepEqual(normalizedStatusReward.card[0].effects, {
  apply_status: 'reward_focus',
  stacks: 2,
  to: 'self',
});
assert.equal(normalizedStatusReward.card[0].statuses[0].stacks_change, -1);
assert.deepEqual(normalizedStatusReward.card[0].statuses[0].triggers.hold, {
  modify: 'damage',
  add: 'stacks',
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

// Encounter and reward validation are independent authoring branches. A bad
// enemy must not hide a bad reward until the only bounded repair has finished.
{
  const generatedBattle = {
    enemy: {
      name: 'broken enemy',
      emoji: 'X',
      hp: 20,
      max_hp: 20,
      lust: 0,
      max_lust: 100,
      actions: [{ name: 'broken action', effects: { damage: { unsupported: true } } }],
      abilities: [],
      status_effects: [],
      lust_effect: { name: 'overflow', effects: { damage: 1 } },
      action_mode: 'random',
      action_config: {},
    },
  };
  const reward = {
    card: [
      {
        id: 'broken_reward',
        name: 'broken reward',
        type: 'Attack',
        rarity: 'Common',
        cost: 1,
        effects: { replay_current: 'skills_played_this_turn > 0 ? 1 : 0' },
      },
    ],
    artifact: [],
    item: [],
    limits: { cards: 1, artifacts: 0, items: 0 },
  };
  assert.throws(
    () => activation.validateTowerBattleNodeForActivation(baseBattle(), generatedBattle, reward),
    error => {
      assert.match(error.message, /tower battle content is invalid/);
      assert.match(error.message, /tower reward cards is invalid/);
      assert.match(error.message, /replay_current/);
      return true;
    },
  );
}

function reachableChoice(kind, requireFork = false) {
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
      if (choice.kind === kind && (!requireFork || state.choices.length > 1)) return { state, choice };
      state = runCore.completeRunNode(runCore.enterRunNode(state, nodeId), { outcome: 'cleared' });
    }
  }
  throw new Error(`unable to reach ${kind}`);
}

function readyNode(stat, choice, content, reward) {
  if (choice.kind === 'rest') {
    assert.equal(stat.run.nodeContent[choice.id].phase, 'ready');
    return;
  }
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
  artifact: [
    {
      id: 'normal_battle_extra_relic',
      name: '应被裁掉的遗物',
      rarity: 'Common',
      trigger: { on: 'battle_start', effects: { block: 1 } },
    },
  ],
  item: [{ id: 'mist_salve', name: '雾露药剂', count: 1, effects: { heal: 6 } }],
  limits: { cards: 3, artifacts: 1, items: 1 },
};

// New generators reference ordered/weighted actions by stable English id,
// while old cards reference the visible name. Both spellings must activate
// the exact same executable action rather than trigger a repair request.
{
  const prepared = activation.prepareTowerBattleForActivation(baseBattle(), {
    enemies: [
      {
        ...validEnemy,
        id: 'id_ordered_enemy',
        actions: [
          { id: 'strike', name: '扑击', effects: { damage: 7 } },
          { id: 'guard', name: '蓄势', effects: { block: 5 } },
        ],
        action_mode: 'sequence_then_probability',
        action_config: {
          sequence: ['guard', 'strike'],
          probability: { strike: 3, guard: 1 },
        },
      },
    ],
  });
  assert.deepEqual(prepared.enemy.action_config, {
    sequence: ['蓄势', '扑击'],
    probability: { 扑击: 3, 蓄势: 1 },
  });
}

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
  assert.deepEqual(
    prepared.items.map(item => item.id),
    ['spare_tonic'],
  );
  assert.equal(prepared.enemy.id, 'tower_enemy_1');
  assert.equal(prepared.enemies[0].id, 'tower_enemy_1');
}

// Provider-friendly namespaced enemy IDs are made runtime-safe at the tower
// boundary, including exact references to those IDs. The shared compact
// normalizer may hash unreferenced IDs first; activation must preserve the
// resulting deterministic, unique runtime identities rather than a spelling.
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
  const ids = prepared.enemies.map(enemy => enemy.id);
  assert.equal(new Set(ids).size, 2);
  ids.forEach(id => assert.match(id, /^[A-Za-z_][A-Za-z0-9_]*$/));
  assert.equal(prepared.enemy.id, ids[0]);
  const again = activation.prepareTowerBattleForActivation(baseBattle(), {
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
  assert.deepEqual(
    again.enemies.map(enemy => enemy.id),
    ids,
  );

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
  const normalized = activation.normalizeTowerReward(
    {
      ...validReward,
      request: { kind: 'runtime-only' },
      disabled_categories: ['items'],
      pool_revision: 9,
      reroll_count: 3,
    },
    baseBattle(),
  );
  assert.equal(normalized.card[0].id, 'mist_guard');
  assert.equal(normalized.pool_revision, 0);
  assert.equal(normalized.reroll_count, 0);
  assert.deepEqual(normalized.disabled_categories, []);
  assert.throws(
    () => activation.normalizeTowerReward({ ...validReward, invented_pool_field: true }, baseBattle()),
    /unsupported field: invented_pool_field/,
  );
}

// An exact relic duplicate incorrectly echoed into the card category is pure
// transport noise: keep the correctly categorized artifact. A lone Relic card
// remains invalid and is not silently reinterpreted.
{
  const relic = {
    id: 'star_lantern_artifact',
    name: '星灯',
    emoji: '🏮',
    rarity: 'Common',
    description: '每回合开始获得1点能量。',
    trigger: { on: 'turn_start', effects: { energy: 1 } },
  };
  const normalized = activation.normalizeTowerReward(
    {
      cards: [{ ...structuredClone(relic), id: 'star_lantern_card', type: 'Relic' }],
      artifacts: [relic],
      items: [],
      limits: { cards: 1, artifacts: 1, items: 0 },
    },
    baseBattle(),
  );
  assert.deepEqual(normalized.card, []);
  assert.equal(normalized.artifact[0].id, 'star_lantern_artifact');
  assert.deepEqual(normalized.limits, { cards: 0, artifacts: 1, items: 0 });
  assert.throws(
    () =>
      activation.normalizeTowerReward(
        {
          cards: [{ ...structuredClone(relic), id: 'orphan_relic_card', type: 'Relic' }],
          artifacts: [],
          items: [],
        },
        baseBattle(),
      ),
    /unsupported card type: Relic/,
  );
}

// Future nodes can be generated before the player acquires an identically
// named card or consumable. Different rules receive a deterministic fresh ID
// at activation instead of blocking the route, while owned content is left
// untouched.
{
  const battle = baseBattle();
  const normalized = activation.normalizeTowerReward(
    {
      card: [
        {
          id: 'starter_strike',
          name: '璧锋墜鏂?鍙樺紡',
          type: 'Attack',
          rarity: 'Common',
          cost: 1,
          quantity: 1,
          effects: { damage: 11 },
        },
      ],
      artifact: [],
      item: [],
    },
    battle,
  );
  assert.match(normalized.card[0].id, /^starter_strike__tower_[a-z0-9]+$/);
  assert.equal(battle.cards[0].id, 'starter_strike');

  battle.items.push({
    id: 'repair_kit',
    name: '旧修理包',
    count: 1,
    description: '恢复少量生命。',
    effects: { heal: 5 },
  });
  const normalizedItem = activation.normalizeTowerReward(
    {
      card: [],
      artifact: [],
      item: [
        {
          id: 'repair_kit',
          name: '应急修复包',
          count: 1,
          description: '恢复更多生命。',
          effects: { heal: 10 },
        },
      ],
    },
    battle,
  );
  assert.match(normalizedItem.item[0].id, /^repair_kit__tower_[a-z0-9]+$/);
  assert.equal(battle.items[0].id, 'repair_kit');
}

// Lookahead offers are generated before the current room is settled. A relic
// obtained in the meantime makes the matching future candidate stale, not the
// whole route invalid. Other categories remain available and the pick limit
// is reconciled to the filtered pool.
{
  const battle = baseBattle();
  const owned = structuredClone(validReward.artifact[0]);
  battle.artifacts.push(owned);
  const normalized = activation.normalizeTowerReward(
    {
      card: [validReward.card[0]],
      artifact: [structuredClone(owned)],
      item: [validReward.item[0]],
      limits: { cards: 1, artifacts: 1, items: 1 },
    },
    battle,
  );
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
    () =>
      activation.normalizeTowerReward(
        {
          card: [],
          artifact: [{ ...owned, trigger: { on: 'unknown_trigger', effects: { block: 1 } } }],
          item: [],
        },
        battle,
      ),
    /reward artifacts is invalid/,
  );
}
{
  const duplicate = structuredClone(validReward.artifact[0]);
  assert.throws(
    () =>
      activation.normalizeTowerReward(
        {
          card: [],
          artifact: [duplicate, structuredClone(duplicate)],
          item: [],
        },
        baseBattle(),
      ),
    /遗物已持有/,
  );
}

// One bounded repair must see every malformed candidate in the same pool.
// Optional status wrappers are omitted when unused; null is not a request to
// invent a state for an otherwise ordinary card.
{
  const cards = ['status_null_a', 'status_null_b', 'status_null_c'].map((id, index) => ({
    id,
    name: `空状态候选${index + 1}`,
    type: 'Skill',
    rarity: 'Common',
    cost: 1,
    quantity: 1,
    effects: { block: 4 + index },
    status: null,
  }));
  assert.throws(
    () => activation.normalizeTowerReward({ card: cards, artifact: [], item: [] }, baseBattle()),
    error => {
      assert.match(error.message, /cards\[0\].*候选 status 必须是一个状态定义对象/);
      assert.match(error.message, /cards\[1\].*候选 status 必须是一个状态定义对象/);
      assert.match(error.message, /cards\[2\].*候选 status 必须是一个状态定义对象/);
      return true;
    },
  );
}

// A ready battle enters atomically, preserves the deck, consumes content, and
// keeps its already-validated reward hidden until the victory settlement.
{
  const reached = reachableChoice('battle', true);
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
  const plannedItems =
    recommendTowerBattleRewardBudget({
      nodeId: reached.choice.id,
      kind: reached.choice.kind,
      act: reached.choice.act,
      floor: reached.choice.floor,
      rewardSeed: reached.choice.rewardSeed,
    }).items?.pick || 0;
  assert.equal(stat.run_node_reward.reward.item.length, plannedItems, 'activation uses the seeded extra-drop plan');
  assert.deepEqual(stat.run_node_reward.reward.limits, { cards: 1, artifacts: 0, items: plannedItems });
  assert.equal(
    stat.run_node_reward.reward.gold,
    recommendTowerBattleGold({
      nodeId: reached.choice.id,
      kind: reached.choice.kind,
      act: reached.choice.act,
      floor: reached.choice.floor,
      enemyCount: 1,
    }),
  );
  assert.equal(stat.run_node_reward.reward.gold_claimed, false);
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
  readyNode(stat, reached.choice, { payload: { battle: { enemies: [first, second] } } }, validReward);
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  const persisted = stat.run.nodeContent[reached.choice.id].content.payload.battle.enemies;
  assert.deepEqual(
    persisted.map(enemy => enemy.id),
    ['machine_front_1', 'machine_back_1'],
  );
  assert.deepEqual(
    stat.battle.enemies.map(enemy => enemy.id),
    ['machine_front_1', 'machine_back_1'],
  );
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
  assert.throws(
    () => activation.activateTowerNodeInStat(stat, reached.choice.id),
    /reward cards is invalid at cards\[0\] \(broken_reward\)/,
  );
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
  stat.battle.core.resources = [
    { id: 'star_charge', name: '星辉', emoji: '⭐', current: 2, max: 5, refresh: 'retain' },
  ];
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
              resources: { star_charge: 2 },
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
  assert.deepEqual(stat.run_event.choices[0].outcome.resources, { star_charge: 2 });
  assert.equal(stat.run_event.choices[0].outcome.reward.item[0].id, 'whisper_draught');
  assert.equal(stat.run_node_reward, null);
}
{
  const battle = baseBattle();
  battle.core.resources = [{ id: 'star_charge', name: '星辉', emoji: '⭐', current: 2, max: 5, refresh: 'retain' }];
  assert.throws(
    () =>
      activation.validateTowerEventNodeForActivation(battle, {
        choices: [
          { id: 'unknown', label: '触碰', outcome: { resources: { invented_charge: 1 } } },
          { id: 'leave', label: '离开', outcome: {} },
        ],
      }),
    /未注册的玩家资源：invented_charge/,
  );
  assert.throws(
    () =>
      activation.validateTowerEventNodeForActivation(battle, {
        choices: [
          { id: 'misplaced', label: '触碰', outcome: { reward: { resources: { star_charge: 1 } } } },
          { id: 'leave', label: '离开', outcome: {} },
        ],
      }),
    /reward.*不支持字段.*resources|unsupported.*resources/i,
  );
  assert.throws(
    () => activation.validateTowerEventNodeForActivation(battle, {
      choices: [
        { id: 'cost_unknown', label: '支付', outcome: { cost: { resources: { invented_charge: 1 } } } },
        { id: 'leave', label: '离开', outcome: {} },
      ],
    }),
    /未注册的玩家资源：invented_charge/,
    'event costs must use the same registered resource namespace as resource gains',
  );
}
{
  const reached = reachableChoice('rest');
  const stat = towerStat(reached.state);
  readyNode(stat, reached.choice, { title: '余烬营火', payload: { rest: { description: '火光稳定地摇曳。' } } });
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  assert.equal(stat.run_node.narrative_source, 'program');
  assert.equal(stat.run_rest.healRatio, 0.3);
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

for (const outcome of ['victory', 'defeat', 'terminated']) {
  const reached = reachableChoice('battle');
  const stat = towerStat(reached.state);
  const before = structuredClone(stat.battle.player_lust_effect);
  const growth = { effect: { name: '胜利觉醒', effects: [{ damage: 50, to: 'opponent' }] } };
  readyNode(stat, reached.choice, { payload: { battle: { enemy: validEnemy }, desire_growth: growth } }, validReward);
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  assert.deepEqual(stat.battle.player_lust_effect, before, 'growth must not apply on entering battle');
  assert.deepEqual(stat.run_node_reward.desire_growth, growth);
  const { settleTowerBattleRewardInStat } = require('../src/runtime/towerBattleRewardSettlement.ts');
  settleTowerBattleRewardInStat(stat, outcome, reached.choice.id);
  assert.deepEqual(stat.battle.player_lust_effect, outcome === 'victory' ? growth.effect : before);
  if (outcome === 'victory') assert.equal(stat.reward.card.length, validReward.card.length);
  assert.equal(stat.run_node_reward, null);
}
console.log('Tower node activation validation, atomicity, staging, and settlement-boundary tests passed.');

// V2 stages are validated and normalized before they enter the stat. The
// first reachable stage freezes any random deck targets in run_event_state.
{
  const reached = reachableChoice('event');
  const stat = towerStat(reached.state);
  readyNode(stat, reached.choice, {
    title: '双段契约',
    payload: {
      event: {
        spec: 'mwg.tower-event/v2',
        start_stage: 'offer',
        stages: [
          {
            id: 'offer',
            narrative: '先做选择。',
            choices: [
              {
                id: 'accept',
                label: '接受',
                outcome: { gold: 4, cost: { gold: 0 } },
                next_stage: 'resolve',
              },
            ],
          },
          {
            id: 'resolve',
            choices: [
              {
                id: 'finish',
                label: '结束',
                outcome: { max_lust: 2, grant: { cards: [], items: [], limits: { cards: 0, items: 0 } } },
              },
            ],
          },
        ],
      },
    },
  });
  activation.activateTowerNodeInStat(stat, reached.choice.id);
  assert.equal(stat.run_event.spec, 'mwg.tower-event/v2');
  assert.equal(stat.run_event.stages[0].choices[0].next_stage, 'resolve');
  assert.equal(stat.run_event_state.stage_id, 'offer');
  assert.deepEqual(stat.run_event_state.random_targets, {});
}
for (const invalidEvent of [
  {
    spec: 'mwg.tower-event/v2',
    start_stage: 'first',
    stages: [{ id: 'first', choices: [{ id: 'go', label: '继续', outcome: {}, next_stage: 'missing' }] }],
  },
  {
    spec: 'mwg.tower-event/v2',
    start_stage: 'first',
    stages: [{ id: 'first', choices: [{ id: 'loop', label: '循环', outcome: {}, next_stage: 'first' }] }],
  },
  {
    choices: [
      { id: 'one', label: '一', outcome: {}, unexpected: true },
      { id: 'two', label: '二', outcome: {} },
    ],
  },
  {
    spec: 'mwg.tower-event/v2',
    start_stage: 'first',
    stages: [{ id: 'first', choices: [{ id: 'bad', label: '错误', outcome: {}, unknown: true }] }],
  },
]) {
  assert.throws(
    () => activation.validateTowerEventNodeForActivation(baseBattle(), invalidEvent),
    /事件|tower|unsupported|不支持/i,
  );
}
