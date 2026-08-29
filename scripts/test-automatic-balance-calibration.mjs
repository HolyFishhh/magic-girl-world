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
function enemy(hp, damage) {
  return {
    id: 'overlord', name: '试炼领主', emoji: '👁️', hp, max_hp: hp, lust: 0, max_lust: 100,
    actions: [
      { id: 'hit', name: '压击', weight: 2, description: '挥出沉重一击。', effects: { damage } },
      { id: 'guard', name: '蓄势', weight: 1, description: '暂时收势观察。', effects: { block: Math.max(1, Math.round(damage / 2)) } },
    ],
    abilities: [], status_effects: [], action_mode: 'probability', action_config: { probability: { 压击: 2, 蓄势: 1 } },
    lust_effect: { name: '终局追击', description: '抓住失衡时机追击。', effects: { damage: Math.max(1, damage) } },
  };
}
const originalBattle = {
  core: { emoji: '✨', hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
  cards,
  statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
  player_lust_effect: { name: '反击', effects: { damage: 12 } },
  enemy: enemy(260, 28), enemies: [], design_context: null,
};
const originalPack = core.createContentPack({
  cards,
  statuses: [],
  enemy: originalBattle.enemy,
  playerDesireEffect: originalBattle.player_lust_effect,
});
const budget = core.summarizeBuildBudget(originalPack, { hp: 80, maxHp: 80 });
const assessment = core.assessContentDesign({
  pack: originalPack,
  budget,
  player: { hp: 80, maxHp: 80, lust: 0, maxLust: 100 },
  difficultyPercent: 80,
  autoCalibration: true,
  simulationSeeds: 8,
});
assert.equal(assessment.context.settings.autoCalibration, true);
assert.equal(assessment.calibration.requiresCorrection, true);
assert.match(runtime.formatAutomaticBalanceCalibrationPrompt(assessment), /只对当前 battle\.enemy/);

const target = assessment.difficulty;
const repairedEnemy = enemy(
  Math.round((target.enemyHp.min + target.enemyHp.max) / 2),
  Math.max(1, Math.round((target.expectedActionDamage.min + target.expectedActionDamage.max) / 2)),
);
const originalVariables = { stat_data: { battle: structuredClone(originalBattle), status: { time: '00年01月01日 00:00' } } };
const modelVariables = structuredClone(originalVariables);
modelVariables.stat_data.battle.enemy = repairedEnemy;
modelVariables.stat_data.battle.cards = [{ id: 'illegal_rewrite' }];
modelVariables.stat_data.status.time = '被模型误改';
const reconciled = runtime.reconcileAutomaticBalanceCalibration(originalVariables, modelVariables);
assert.deepEqual(reconciled.stat_data.battle.cards, cards, 'repair scope must preserve the player deck');
assert.equal(reconciled.stat_data.status.time, '00年01月01日 00:00', 'repair scope must preserve story state');
assert.deepEqual(reconciled.stat_data.battle.enemy, repairedEnemy);
runtime.validateAutomaticBalanceCalibration(reconciled, assessment);

const programCalibration = runtime.calibrateMvuEncounterNumbers(originalVariables, assessment);
assert.equal(programCalibration.spec, 'mwg.encounter-calibration/v1');
assert.equal(programCalibration.winnableAtCurrentResources, true);
assert.equal(programCalibration.calibratedPack.enemy.name, originalBattle.enemy.name);
assert.equal(programCalibration.calibratedPack.enemy.actions[0].name, originalBattle.enemy.actions[0].name);
assert.ok(programCalibration.changedPaths.length > 0);

globalThis.MagicGirlDesignAssistant = { getSettings: () => ({ enabled: true }) };
assert.equal(
  await runtime.maybeRequestAutomaticBalanceCalibration(originalVariables, assessment),
  false,
  '顶层扩展启用时角色卡不得运行第二套自动校准',
);
delete globalThis.MagicGirlDesignAssistant;

console.log('Automatic balance calibration is one-scope, executable, programmatic, and keeps authored enemy identity.');
