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
const baseChoiceRewards = [
  guardReward,
  { ...guardReward, id: 'tower_lantern', name: '塔灯', emoji: '🏮', description: '点亮前路并获得格挡。' },
  { ...guardReward, id: 'tower_feather', name: '塔羽', emoji: '🪶', description: '轻盈地获得格挡。' },
];
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
          card: baseChoiceRewards,
          artifact: [],
          item: [],
          limits: { cards: 1, artifacts: 0, items: 0 },
          disabled_categories: [],
          pool_revision: 0,
          reroll_count: 0,
          gold: 37,
          gold_claimed: false,
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
  assert.equal(stat.reward.gold, 37);
  assert.equal(stat.reward.gold_claimed, false);
  assert.equal(stat.run_node, null);
  assert.equal(stat.run_node_reward, null);
  assert.deepEqual(stat.run, runBefore, 'the pure reward transaction does not settle the route');
}

// Special enemy loot is appended only from an actual defeat receipt. It shares
// the normal reward validator and never changes the program-authored base gold.
{
  const { stat, choice } = activeTowerStat(498);
  rewardSettlement.settleTowerBattleRewardInStat(stat, 'victory', choice.id, [{
    enemyId: 'chest_monster',
    reward: {
      cards: [{ ...guardReward, id: 'chest_guard', name: '宝箱壁垒' }],
      artifacts: [{ id: 'chest_relic', name: '宝箱棱镜', rarity: 'Common', emoji: '◇', trigger: { on: 'battle_start', effects: { block: 1 } } }],
      items: [{ id: 'chest_tonic', name: '宝箱药剂', count: 1, description: '回复生命。', effects: { heal: 4 } }],
      gold: 19,
    },
  }]);
  assert.equal(stat.reward.card.some(entry => entry.id === 'chest_guard'), true);
  assert.deepEqual(
    stat.reward.card_choice_groups,
    [
      { id: 'cards', indices: [0, 1, 2], pick: 1 },
      { id: 'defeat:chest_monster', indices: [3], pick: 1 },
    ],
    'the base three-choice pool and a defeated enemy card drop remain separate choice groups',
  );
  assert.equal(stat.reward.artifact.some(entry => entry.id === 'chest_relic'), true);
  assert.equal(stat.reward.item.some(entry => entry.id === 'chest_tonic'), true);
  assert.equal(stat.reward.gold, 56);
  assert.equal(stat.reward.gold_claimed, false);
}

// Base currency is owned by the original roster: escaped or spawned enemies
// do not create a receipt, while a partial real defeat earns only its share.
{
  const { stat, choice } = activeTowerStat(497);
  rewardSettlement.settleTowerBattleRewardInStat(stat, 'victory', choice.id, [], ['front'], ['front', 'runner']);
  assert.equal(stat.reward.gold, 18);
  const escaped = activeTowerStat(496);
  rewardSettlement.settleTowerBattleRewardInStat(escaped.stat, 'victory', escaped.choice.id, [], [], ['runner']);
  assert.equal(escaped.stat.reward.gold, 0);
  assert.equal(escaped.stat.reward.gold_claimed, true);
}

// Defeat and escape discard the hidden pool instead of exposing it.
for (const result of ['defeat', 'terminated']) {
  const { stat, choice } = activeTowerStat(result === 'defeat' ? 401 : 402);
  stat.reward.card = [{ id: 'stale' }];
  const settled = rewardSettlement.settleTowerBattleRewardInStat(stat, result, choice.id);
  assert.equal(settled.promoted, false);
  assert.deepEqual(stat.reward.card, []);
  assert.equal(stat.reward.gold, 0);
  assert.equal(stat.reward.gold_claimed, true);
  assert.equal(stat.run_node_reward, null);
}

// Currency is generated from the durable node plan and finalized roster, not
// from reward JSON.  The same save context restores exactly the same payout.
{
  const context = { nodeId: 'gold-node', kind: 'battle', act: 2, floor: 5, rewardSeed: 913, enemyCount: 3 };
  const planned = core.recommendTowerBattleRewardBudget(context);
  assert.equal(planned.gold, core.recommendTowerBattleRewardBudget(context).gold);
  assert.equal(planned.gold, core.recommendTowerBattleGold(context));
  assert.notEqual(planned.gold, core.recommendTowerBattleGold({ ...context, enemyCount: 1 }), 'roster size participates in the saved payout plan');
  assert.ok(core.recommendTowerBattleGold({ ...context, kind: 'elite' }) > planned.gold);
  assert.ok(core.recommendTowerBattleGold({ ...context, kind: 'boss' }) > core.recommendTowerBattleGold({ ...context, kind: 'elite' }));
}

// An in-flight legacy save has no currency receipt; preserve its old reward
// rather than inventing money while migrating the staged pool.
{
  const { stat, choice } = activeTowerStat(499);
  delete stat.run_node_reward.reward.gold;
  delete stat.run_node_reward.reward.gold_claimed;
  rewardSettlement.settleTowerBattleRewardInStat(stat, 'victory', choice.id);
  assert.equal(stat.reward.gold, 0);
  assert.equal(stat.reward.gold_claimed, true);
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
  const played = core.appendBattleEvent(core.createBattleEventJournal(), {
    turn: 1,
    phase: 'after',
    kind: 'card_played',
    cause: { source: { kind: 'card', id: 'strike' }, reason: 'player_choice' },
    actorId: 'player',
    cardInstanceId: 'strike__combat__1',
    templateId: 'strike',
    cardType: 'Attack',
    automatic: false,
    replayIndex: 0,
  });
  assert.equal(played.ok, true);
  battleSettlement.settleTavernBattleVariables(variables, {
    result: 'victory',
    request,
    player: { currentHp: 73, currentLust: 4 },
    items: [],
    turns: 4,
    eventJournal: played.state,
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
  assert.equal(variables.stat_data.run_event_history.records.length, 1);
  assert.equal(variables.stat_data.run_event_history.records[0].encounterId, choice.id);

  const experienceAfterFirstSettlement = variables.stat_data.battle.exp;
  assert.equal(experienceAfterFirstSettlement, 0, 'tower victory does not grant experience');
  const afterFirstSettlement = structuredClone(variables);
  battleSettlement.settleTavernBattleVariables(variables, {
    result: 'victory',
    request,
    player: { currentHp: 1, currentLust: 99 },
    items: [],
    turns: 4,
    eventJournal: played.state,
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

// A migrated tower save without pre-generation staging remains playable without
// granting or consuming its legacy experience.
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
  assert.equal(variables.stat_data.battle.exp, 0, 'legacy tower victory does not award EXP');
  assert.equal(variables.stat_data.run.phase, 'awaiting_choice');
}

console.log('Tower battle reward promotion, cleanup, scope guard, and Tavern settlement integration passed.');

// An elite payout is staged currency, and claiming currency alone must not be
// reported as skipping all rewards (the production feedback case).
{
 const {stat}=activeTowerStat();stat.reward={card:[],artifact:[],item:[],limits:{cards:0,artifacts:0,items:0},gold:74,gold_claimed:false};
 const before=stat.run.gold;
 const {executeUnifiedRunTransactionInStat}=require('../src/common/runTransactions.ts');
 executeUnifiedRunTransactionInStat(stat,{kind:'reward_claim',selections:{cards:[],artifacts:[],items:[]},partial:true,claimGold:true});
 assert.equal(stat.run.gold,before+74);assert.match(stat.run_transaction_log.at(-1).summary,/74 金币/);assert.doesNotMatch(stat.run_transaction_log.at(-1).summary,/跳过/);
 assert.throws(()=>executeUnifiedRunTransactionInStat(stat,{kind:'reward_claim',selections:{cards:[],artifacts:[],items:[]},partial:true,claimGold:true}));
}
