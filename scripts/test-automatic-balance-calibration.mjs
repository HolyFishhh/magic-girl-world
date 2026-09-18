import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const runtime = require(resolve('src/runtime/automaticBalanceCalibration.ts'));

const cards = [
  { id: 'strike', name: '攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
  { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
];
const enemy = {
  id: 'overlord', name: '试炼领主', emoji: '👁️', hp: 260, max_hp: 260, lust: 0, max_lust: 100,
  actions: [
    { id: 'hit', name: '压击', weight: 2, description: '挥出沉重一击。', effects: { damage: 28 } },
    { id: 'guard', name: '蓄势', weight: 1, description: '暂时收势观察。', effects: { block: 14 } },
  ],
  abilities: [], status_effects: [], action_mode: 'probability', action_config: { probability: { 压击: 2, 蓄势: 1 } },
  lust_effect: { name: '终局追击', description: '抓住失衡时机追击。', effects: { damage: 28 } },
};
const originalBattle = {
  core: { emoji: '✨', hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
  cards,
  statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
  player_lust_effect: { name: '反击', effects: { damage: 12 } },
  enemy, enemies: [], design_context: null,
};
const originalPack = core.createContentPack({ cards, statuses: [], enemy, playerDesireEffect: originalBattle.player_lust_effect });
const budget = core.summarizeBuildBudget(originalPack, { hp: 80, maxHp: 80 });
const assessment = core.assessContentDesign({
  pack: originalPack,
  budget,
  player: { hp: 80, maxHp: 80, lust: 0, maxLust: 100 },
  difficultyPercent: 80,
  autoCalibration: true,
  simulationSeeds: 8,
});

assert.match(runtime.formatAutomaticBalanceCalibrationPrompt(assessment), /只.*参考|参考/);
assert.match(runtime.formatAutomaticBalanceCalibrationPrompt(assessment), /不修改当前敌人/);

const originalVariables = { stat_data: { battle: structuredClone(originalBattle), status: { time: '00年01月01日 00:00' } } };
const modelVariables = structuredClone(originalVariables);
modelVariables.stat_data.battle.enemy.max_hp = 1;
modelVariables.stat_data.battle.cards = [{ id: 'illegal_rewrite' }];
modelVariables.stat_data.status.time = '被模型误改';
const reconciled = runtime.reconcileAutomaticBalanceCalibration(originalVariables, modelVariables);
assert.deepEqual(reconciled, originalVariables, 'legacy reconciliation must discard every post-generation rewrite');
assert.notEqual(reconciled, originalVariables, 'legacy reconciliation should still return a defensive clone');
runtime.validateAutomaticBalanceCalibration(reconciled, assessment);

const analysis = runtime.calibrateMvuEncounterNumbers(originalVariables, assessment);
assert.equal(analysis.spec, 'mwg.encounter-calibration/v1');
assert.equal(analysis.calibratedPack.enemy.name, originalBattle.enemy.name);
assert.ok(analysis.changedPaths.length > 0, 'counterfactual analysis may still calculate suggested changes');
assert.deepEqual(originalVariables.stat_data.battle, originalBattle, 'analysis must not mutate the current battle');
assert.equal(
  await runtime.maybeRequestAutomaticBalanceCalibration(originalVariables, assessment),
  false,
  'the deprecated mutation entry point must always be a no-op',
);

console.log('Enemy balance analysis is pure and advisory; no post-generation rewrite is applied.');
