import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const adapter = require(resolve('src/runtime/contentDesignContextAdapter.ts'));
const runtimeSettings = require(resolve('src/runtime/contentDesignSettings.ts'));
const settlement = require(resolve('src/runtime/battleSettlementAdapter.ts'));

assert.deepEqual(runtimeSettings.readRuntimeContentDesignSettings({ getItem: () => null }), {
  difficultyPercent: 80,
  autoCalibration: true,
});
assert.deepEqual(
  runtimeSettings.readRuntimeContentDesignSettings({
    getItem: key =>
      key === runtimeSettings.CONTENT_DESIGN_SETTINGS_STORAGE_KEY
        ? JSON.stringify({ difficultyPercent: 110, autoCalibration: false })
        : null,
  }),
  { difficultyPercent: 110, autoCalibration: false },
);
assert.deepEqual(runtimeSettings.readRuntimeContentDesignSettings({ getItem: () => '{invalid' }), {
  difficultyPercent: 80,
  autoCalibration: true,
});
assert.equal(runtimeSettings.isExternalDesignAssistantActive({ parent: null }), false);
const extensionRoot = { MagicGirlDesignAssistant: { getSettings: () => ({ enabled: true }) } };
assert.equal(
  runtimeSettings.isExternalDesignAssistantActive({ parent: extensionRoot }),
  true,
  '角色 iframe 应识别顶层设计辅助扩展并停止重复深模拟',
);
extensionRoot.MagicGirlDesignAssistant.getSettings = () => ({ enabled: false });
assert.equal(runtimeSettings.isExternalDesignAssistantActive({ parent: extensionRoot }), false);

const battle = {
  core: { emoji: '🧙', hp: 80, max_hp: 80, lust: 0, max_lust: 100, card_removal_count: 1 },
  cards: [
    { id: 'spark', name: '火花', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
    { id: 'guard', name: '屏障', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
  ],
  artifacts: [],
  items: [],
  statuses: [],
  player_abilities: [],
  player_status_effects: [],
  player_lust_effect: { name: '回响', effects: { damage: 6 } },
  level: 1,
  exp: 0,
  design_context: null,
  enemy: {
    id: 'shade',
    name: '影兽',
    emoji: '👤',
    hp: 42,
    max_hp: 42,
    lust: 0,
    max_lust: 100,
    actions: [
      { name: '扑击', weight: 2, effects: { damage: 7 } },
      { name: '潜伏', weight: 1, effects: { block: 6 } },
    ],
    abilities: [],
    status_effects: [],
    lust_effect: { name: '失衡', effects: { damage: 5 } },
    action_mode: 'random',
    action_config: {},
  },
  enemies: [],
};
const variables = { stat_data: { battle: structuredClone(battle), reward: { request: null } } };
const first = adapter.refreshMvuContentDesignContext(variables);
assert.equal(first.changed, true);
assert.equal(variables.stat_data.battle.design_context.spec, 'mwg.content-design/v3');
assert.equal(variables.stat_data.battle.design_context.settings.difficultyPercent, 80);
assert.ok(variables.stat_data.battle.design_context.balance.deck.totalScore > 0);
assert.equal(variables.stat_data.battle.design_context.balance.target.difficultyPercent, 80);
assert.equal(variables.stat_data.battle.design_context.archetypes.spec, 'mwg.archetype-graph/v1');
assert.equal(variables.stat_data.battle.design_context.lineage.spec, 'mwg.encounter-lineage/v1');
assert.equal(variables.stat_data.battle.lineage_memory.spec, 'mwg.encounter-lineage/v1');
assert.equal(variables.stat_data.battle.design_context.recentEnemySignatures.length, 1);
const second = adapter.refreshMvuContentDesignContext(variables);
assert.equal(second.changed, false);
assert.equal(variables.stat_data.battle.design_context.recentEnemySignatures.length, 1);

const difficultyVariables = {
  stat_data: { battle: structuredClone(battle), reward: { request: null } },
};
const highPressure = adapter.refreshMvuContentDesignContext(difficultyVariables, {
  difficultyPercent: 110,
  autoCalibration: true,
});
assert.equal(highPressure.changed, true);
assert.equal(difficultyVariables.stat_data.battle.design_context.settings.difficultyPercent, 110);
assert.equal(difficultyVariables.stat_data.battle.design_context.settings.autoCalibration, true);
assert.equal(difficultyVariables.stat_data.battle.design_context.balance.target.difficultyPercent, 110);

const simulatedProfile = adapter.profileMvuDeckPower(variables, { simulationSeeds: 8 });
assert.equal(simulatedProfile.spec, 'mwg.deck-power/v2');
assert.equal(adapter.isMvuDeckPowerProfileCurrent(variables, simulatedProfile, { simulationSeeds: 8 }), true);
const profiled = adapter.refreshMvuContentDesignContext(variables, {
  simulationSeeds: 8,
  deckPowerProfile: simulatedProfile,
});
assert.equal(profiled.changed, true);
assert.equal(variables.stat_data.battle.design_context.balance.deckProfile.fingerprint, simulatedProfile.fingerprint);
assert.equal(variables.stat_data.battle.design_context.balance.targetEnvelope.spec, 'mwg.enemy-budget/v2');
assert.equal(variables.stat_data.battle.design_context.balance.targetEnvelope.requestedRatio, 80);

const fingerprintBeforeReward = variables.stat_data.battle.design_context.fingerprint;
const briefBeforeReward = variables.stat_data.battle.design_context.brief;
variables.stat_data.battle.cards.push({
  id: 'reward_bridge',
  name: '余烬桥接',
  type: 'Skill',
  rarity: 'Uncommon',
  cost: 0,
  quantity: 1,
  effects: { draw: 1, energy: 1 },
});
const afterReward = adapter.refreshMvuContentDesignContext(variables);
assert.equal(afterReward.changed, true);
assert.equal(
  variables.stat_data.battle.design_context.balance.deckProfile,
  undefined,
  'a changed deck must invalidate the persisted simulation instead of reusing a stale score',
);
assert.notEqual(variables.stat_data.battle.design_context.fingerprint, fingerprintBeforeReward);
assert.notEqual(variables.stat_data.battle.design_context.brief, briefBeforeReward);
assert.equal(variables.stat_data.battle.design_context.build.deckSize, 11);
assert.equal(
  variables.stat_data.battle.design_context.recentEnemySignatures.length,
  1,
  'claiming a reward must refresh the build without duplicating enemy history',
);

variables.stat_data.reward.card = [
  { id: 'choice_a', name: '候选甲', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 8 } },
  { id: 'choice_b', name: '候选乙', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 8 } },
  { id: 'choice_c', name: '候选丙', type: 'Skill', rarity: 'Uncommon', cost: 1, quantity: 1, effects: { draw: 2 } },
];
adapter.refreshMvuContentDesignContext(variables);
assert.equal(variables.stat_data.battle.design_context.rewardReview.candidateCount, 3);
assert.ok(
  variables.stat_data.battle.design_context.rewardReview.diagnosticCodes.includes('REWARD_MECHANICAL_DUPLICATES'),
);
variables.stat_data.reward.card = [];
adapter.refreshMvuContentDesignContext(variables);
assert.equal(variables.stat_data.battle.design_context.rewardReview, undefined, 'one-shot reward review must not persist');

const request = core.createBattleRequest({
  content: require(resolve('src/runtime/contentPackAdapter.ts')).createContentPackFromMvuBattle(battle),
  player: { emoji: '🧙', hp: 80, maxHp: 80, lust: 0, maxLust: 100, level: 1 },
  seed: 7,
});
settlement.settleTavernBattleVariables(variables, {
  result: 'defeat',
  request,
  player: { currentHp: 0, currentLust: 55 },
  turns: 2,
  items: [],
  rewardRequest: { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'defeat' },
});
assert.equal(variables.stat_data.battle.design_context.lastBattle.outcome, 'defeat');
assert.equal(variables.stat_data.battle.design_context.lastBattle.turns, 2);
assert.match(variables.stat_data.battle.design_context.brief, /降低首轮爆发/);

console.log('MVU design context persists build, encounter history, and post-battle feedback without duplicate growth.');
