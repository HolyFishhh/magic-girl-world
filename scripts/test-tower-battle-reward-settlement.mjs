import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require('../src/game-core/index.ts');
const runCore = require('../src/game-core/runState.ts');
const rewardSettlement = require('../src/runtime/towerBattleRewardSettlement.ts');
const battleSettlement = require('../src/runtime/battleSettlementAdapter.ts');

const strike = {
  id: 'strike',
  name: '斩击',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  quantity: 4,
  description: '向敌方挥出一剑。',
  effects: { damage: 6 },
};
const guardReward = {
  id: 'tower_guard',
  name: '塔盾',
  type: 'Skill',
  rarity: 'Common',
  cost: 1,
  quantity: 1,
  description: '稳住脚步抵挡冲击。',
  effects: { block: 8 },
};
const enemy = {
  name: '试炼魔偶',
  emoji: '🗿',
  hp: 35,
  max_hp: 35,
  lust: 0,
  max_lust: 100,
  actions: [{ name: '石拳', effects: { damage: 7 } }],
  abilities: [],
  status_effects: [],
  action_mode: 'random',
  action_config: {},
};

function activeTowerStat(seed = 400) {
  let awaiting = runCore.createRunState({ seed });
  awaiting = {
    ...awaiting,
    opening: { ...awaiting.opening, phase: 'skipped' },
  };
  awaiting = runCore.completeRunNode(
    runCore.enterRunNode(awaiting, awaiting.choices[0].id),
    { outcome: 'cleared' },
  );
  const choice = awaiting.choices[0];
  const run = runCore.enterRunNode(awaiting, choice.id);
  return {
    choice,
    stat: {
      game_mode: 'tower',
      game_mode_lock: { schemaVersion: 1, mode: 'tower' },
      run,
      run_node: {
        schemaVersion: 1,
        node_id: choice.id,
        kind: choice.kind,
        program_balance: {
          playerDeckScore: 150,
          finalEnemyScore: 120,
          finalRatio: 80,
        },
        title: '试炼遭遇',
        narrative: '魔偶挡住了去路。',
      },
      run_node_reward: {
        schemaVersion: 1,
        node_id: choice.id,
        kind: choice.kind,
        reward: {
          card: [guardReward],
          artifact: [],
          item: [],
          limits: { cards: 1, artifacts: 0, items: 0 },
          disabled_categories: [],
          pool_revision: 0,
          reroll_count: 0,
        },
      },
      run_event: null,
      run_shop: null,
      run_treasure: null,
      run_rest: null,
      battle: {
        core: { emoji: '⚔️', hp: 80, max_hp: 100, lust: 0, max_lust: 100, resources: [] },
        cards: [strike],
        statuses: [],
        artifacts: [],
        items: [],
        player_abilities: [],
        player_status_effects: [],
        player_lust_effect: null,
        enemy,
        enemies: [enemy],
        level: 1,
        exp: 0,
      },
      reward: { card: [], artifact: [], item: [], limits: {}, request: null },
    },
  };
}

// Pure promotion keeps route settlement separate while atomically exposing the
// validated pool and clearing all active-node staging fields.
{
  const { stat, choice } = activeTowerStat();
  const runBefore = stat.run;
  const settled = rewardSettlement.settleTowerBattleRewardInStat(stat, 'victory', choice.id);
  assert.equal(settled.promoted, true);
  assert.equal(settled.nodeId, choice.id);
  assert.equal(stat.reward.card[0].id, 'tower_guard');
  assert.equal(stat.reward.limits.cards, 1);
  assert.equal(stat.run_node, null);
  assert.equal(stat.run_node_reward, null);
  assert.deepEqual(stat.run, runBefore, 'the pure reward transaction does not settle the route');
}

// Defeat and escape discard the hidden pool instead of exposing it.
for (const result of ['defeat', 'terminated']) {
  const { stat, choice } = activeTowerStat(result === 'defeat' ? 401 : 402);
  stat.reward.card = [{ id: 'stale' }];
  const settled = rewardSettlement.settleTowerBattleRewardInStat(stat, result, choice.id);
  assert.equal(settled.promoted, false);
  assert.deepEqual(stat.reward.card, []);
  assert.equal(stat.run_node_reward, null);
}

// Every scope mismatch is rejected before any mutation.
{
  const { stat, choice } = activeTowerStat(403);
  const before = structuredClone(stat);
  assert.throws(() => rewardSettlement.settleTowerBattleRewardInStat(stat, 'victory', 'another-node'), /node is stale/);
  assert.deepEqual(stat, before);
  stat.run_node_reward.node_id = 'another-node';
  const mismatched = structuredClone(stat);
  assert.throws(
    () => rewardSettlement.settleTowerBattleRewardInStat(stat, 'victory', choice.id),
    /belongs to another node/,
  );
  assert.deepEqual(stat, mismatched);
}

// Story mode is a no-op even if similarly named fields exist.
{
  const { stat, choice } = activeTowerStat(404);
  stat.game_mode = 'story';
  stat.game_mode_lock = { schemaVersion: 1, mode: 'story' };
  const before = structuredClone(stat);
  const settled = rewardSettlement.settleTowerBattleRewardInStat(stat, 'victory', choice.id);
  assert.equal(settled.changed, false);
  assert.deepEqual(stat, before);
}

// Tavern settlement performs reward promotion and scored route completion on
// one draft, retaining the newly added tower score snapshot arguments.
{
  const { stat, choice } = activeTowerStat(405);
  const pack = core.createContentPack({ cards: [strike], enemy });
  const request = core.createBattleRequest({
    content: pack,
    player: { emoji: '⚔️', hp: 80, maxHp: 100, lust: 0, maxLust: 100, level: 1 },
    route: {
      nodeId: choice.id,
      kind: choice.kind,
      danger: choice.danger,
      act: choice.act,
      floor: choice.floor,
      actCount: stat.run.actCount,
      floorsPerAct: stat.run.floorsPerAct,
      nodeCounts: stat.run.nodeCounts,
    },
    runSeed: stat.run.seed,
  });
  const variables = { stat_data: stat };
  battleSettlement.settleTavernBattleVariables(variables, {
    result: 'victory',
    request,
    player: { currentHp: 73, currentLust: 4 },
    items: [],
    turns: 4,
    rewardRequest: null,
  });
  assert.equal(variables.stat_data.reward.card[0].id, 'tower_guard');
  assert.equal(variables.stat_data.run_node_reward, null);
  assert.equal(variables.stat_data.run.phase, 'awaiting_choice');
  assert.equal(variables.stat_data.run.score.encounters.length, 1);
  assert.equal(variables.stat_data.run.score.encounters[0].nodeId, choice.id);
  assert.equal(variables.stat_data.run.score.encounters[0].playerDeckScore, 150);
  assert.equal(variables.stat_data.run.score.encounters[0].enemyScore, 120);
  assert.equal(variables.stat_data.run.score.encounters[0].relativeDifficulty, 0.8);

  const experienceAfterFirstSettlement = variables.stat_data.battle.exp;
  const afterFirstSettlement = structuredClone(variables);
  battleSettlement.settleTavernBattleVariables(variables, {
    result: 'victory',
    request,
    player: { currentHp: 1, currentLust: 99 },
    items: [],
    turns: 4,
    rewardRequest: null,
    persistentCards: [{ ...strike, id: 'stale_card', quantity: 1 }],
  });
  assert.deepEqual(
    variables,
    afterFirstSettlement,
    'an already-settled tower callback must not overwrite newer vitals, cards, enemies or rewards',
  );
  assert.equal(
    variables.stat_data.battle.exp,
    experienceAfterFirstSettlement,
    'a duplicate tower callback must not award victory experience twice',
  );
  assert.equal(variables.stat_data.run.score.encounters.length, 1);
  assert.equal(variables.stat_data.reward.card[0].id, 'tower_guard');
}

// A migrated tower save without pre-generation staging still receives its
// first victory EXP; only a genuinely repeated route callback is suppressed.
{
  const { stat, choice } = activeTowerStat(406);
  stat.run_node = null;
  stat.run_node_reward = null;
  const pack = core.createContentPack({ cards: [strike], enemy });
  const request = core.createBattleRequest({
    content: pack,
    player: { emoji: '⚔️', hp: 80, maxHp: 100, lust: 0, maxLust: 100, level: 1 },
    route: {
      nodeId: choice.id,
      kind: choice.kind,
      danger: choice.danger,
      act: choice.act,
      floor: choice.floor,
      actCount: stat.run.actCount,
      floorsPerAct: stat.run.floorsPerAct,
      nodeCounts: stat.run.nodeCounts,
    },
    runSeed: stat.run.seed,
  });
  const variables = { stat_data: stat };
  battleSettlement.settleTavernBattleVariables(variables, {
    result: 'victory',
    request,
    player: { currentHp: 75, currentLust: 0 },
    items: [],
    turns: 3,
  });
  assert.ok(variables.stat_data.battle.exp > 0, 'legacy tower victory still awards EXP once');
  assert.equal(variables.stat_data.run.phase, 'awaiting_choice');
}

console.log('Tower battle reward promotion, cleanup, scope guard, and Tavern settlement integration passed.');
