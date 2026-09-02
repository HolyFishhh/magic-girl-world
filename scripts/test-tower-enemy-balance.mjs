import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { balanceTowerGeneratedBattle } = require(resolve('src/sillytavern-extension/towerEnemyBalance.ts'));
const {
  formatTowerBattleBalanceRepairPrompt,
  parseTowerNodeResult,
} = require(resolve('src/game-core/towerRequest.ts'));
const { DEFAULT_DESIGN_ASSISTANT_SETTINGS } = require(resolve('src/sillytavern-extension/types.ts'));

const variables = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    battle: {
      core: { emoji: '🧙', hp: 74, max_hp: 80, lust: 8, max_lust: 100 },
      cards: [
        { id: 'strike', name: '攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
        { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
      ],
      statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
      player_lust_effect: { name: '反击', effects: { damage: 8 } },
      enemy: null, enemies: [],
    },
  },
};

function generatedEnemy(damage = 34) {
  return {
    enemy: {
      id: 'clockwork_hunter', name: '发条猎手', emoji: '🦾', hp: 280, max_hp: 280, lust: 0, max_lust: 100,
      description: '沿用剧情身份与行动节奏的机械猎手。',
      actions: [
        { id: 'saw', name: '锯轮突进', weight: 2, description: `锯轮高速逼近，造成 ${damage} 点伤害。`, effects: { damage } },
        { id: 'guard', name: '蒸汽护壳', weight: 1, description: '蒸汽撑起 16 点护盾。', effects: { block: 16 } },
      ],
      abilities: [], status_effects: [], action_mode: 'probability',
      action_config: { probability: { 锯轮突进: 2, 蒸汽护壳: 1 } },
      lust_effect: { name: '过热追击', description: '过热时抓住破绽。', effects: { damage: 18 } },
    },
  };
}

const source = generatedEnemy();
const sourceCopy = structuredClone(source);
const balanced = balanceTowerGeneratedBattle({
  variables,
  generatedBattle: source,
  settings: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS, difficultyPercent: 80, simulationSeeds: 8 },
});
assert.equal(balanced.audit.spec, 'mwg.tower-enemy-balance/v1');
assert.equal(balanced.audit.winnableAtCurrentResources, true);
assert.equal(balanced.requiresModelRepair, false);
assert.equal(balanced.generatedBattle.enemy.name, '发条猎手');
assert.equal(balanced.generatedBattle.enemy.description, source.enemy.description);
assert.equal(balanced.generatedBattle.enemy.actions[0].name, '锯轮突进');
assert.equal(balanced.generatedBattle.enemy.actions[0].weight, 2, 'numeric calibration must preserve cadence');
assert.ok(balanced.audit.changedPaths.length > 0);
assert.ok(balanced.audit.finalEnemyScore < balanced.audit.originalEnemyScore);
assert.equal(Number.isInteger(balanced.generatedBattle.enemy.hp), true, 'scaled enemy hp should remain an integer');
assert.equal(Number.isInteger(balanced.generatedBattle.enemy.max_hp), true, 'scaled enemy max hp should remain an integer');
assert.ok(
  Math.abs(balanced.audit.finalRatio - balanced.audit.effectiveRatio) < 1.5,
  'tower calibration must reach the requested/effective difficulty even when deck coverage is low',
);
assert.ok(
  Math.abs(balanced.audit.finalRatio - balanced.calibration.appliedScale / balanced.calibration.frontierScale * 100) < 0.2,
  'tower score must use the same simulated clean-play frontier as numeric calibration',
);
const balancedSawEffects = Array.isArray(balanced.generatedBattle.enemy.actions[0].effects)
  ? balanced.generatedBattle.enemy.actions[0].effects[0]
  : balanced.generatedBattle.enemy.actions[0].effects;
assert.equal(Number.isInteger(balancedSawEffects.damage), true, 'scaled action values should remain integers');
assert.match(
  balanced.generatedBattle.enemy.actions[0].description,
  new RegExp(String(balancedSawEffects.damage)),
  'scaled action prose must show the calibrated damage',
);
assert.doesNotMatch(
  balanced.generatedBattle.enemy.actions[0].description,
  new RegExp(`(^|[^\\d.])${source.enemy.actions[0].effects.damage}(?=$|[^\\d.])`),
  'scaled action prose must not keep the authored damage',
);
assert.deepEqual(source, sourceCopy, 'tower calibration must be pure over generated content');

const unscalable = generatedEnemy('999');
unscalable.enemy.hp = 1_000_000_000;
unscalable.enemy.max_hp = 1_000_000_000;
const unsafe = balanceTowerGeneratedBattle({
  variables,
  generatedBattle: unscalable,
  settings: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS, difficultyPercent: 80, simulationSeeds: 8 },
});
assert.equal(unsafe.requiresModelRepair, true, 'unscalable lethal mechanics must enter the single repair gate');
assert.equal(unsafe.audit.winnableAtCurrentResources, false);

const nodeResult = {
  spec: 'mwg.tower-node-result/v1',
  node_id: 'act1-floor2-col1',
  request_id: 'request-1',
  based_on_revision: 2,
  kind: 'battle',
  title: '猎手拦路',
  narrative: '发条声在窄路上逼近。',
  payload: { battle: unscalable },
  reward: {
    card: [{ id: 'reward_a' }, { id: 'reward_b' }, { id: 'reward_c' }],
    artifact: [],
    item: [{ id: 'reward_potion' }],
  },
};
const prompt = formatTowerBattleBalanceRepairPrompt(nodeResult, unsafe.audit);
assert.match(prompt, /只修复 payload\.battle/);
assert.match(prompt, /保留敌人的剧情身份/);
assert.match(prompt, /不得修改玩家、地图、run/);
assert.match(prompt, /request-1/);

const spoofed = `<TOWER_NODE_RESULT>${JSON.stringify({
  ...nodeResult,
  program_balance: { winnableAtCurrentResources: true },
})}</TOWER_NODE_RESULT>`;
const parsed = parseTowerNodeResult(spoofed, {
  nodeId: nodeResult.node_id,
  requestId: nodeResult.request_id,
  basedOnRevision: nodeResult.based_on_revision,
  kind: nodeResult.kind,
  act: 1,
  floor: 2,
});
assert.equal(parsed.program_balance, undefined, 'only the program may author the balance audit');

console.log('Tower enemies are scored after authorship, minimally calibrated, and gated by one constrained repair when still unwinnable.');
