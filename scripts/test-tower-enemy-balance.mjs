import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { balanceTowerGeneratedBattle } = require(resolve('src/sillytavern-extension/towerEnemyBalance.ts'));
const { parseTowerNodeResult } = require(resolve('src/game-core/towerRequest.ts'));
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
      id: 'clockwork_hunter', name: '发条猎手', emoji: '🤖', hp: 280, max_hp: 280, lust: 0, max_lust: 100,
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
const assessed = balanceTowerGeneratedBattle({
  variables,
  generatedBattle: source,
  settings: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS, difficultyPercent: 80, simulationSeeds: 8 },
});
assert.equal(assessed.audit.spec, 'mwg.tower-enemy-balance/v1');
assert.equal(assessed.requiresModelRepair, false);
assert.equal(assessed.calibration.requestedRatio, 80);
assert.equal(assessed.audit.appliedScale, 1, 'post-generation audit must not apply the counterfactual scale');
assert.deepEqual(assessed.audit.changedPaths, []);
assert.equal(assessed.audit.originalRatio, assessed.audit.finalRatio);
assert.equal(assessed.audit.originalEnemyScore, assessed.audit.finalEnemyScore);
assert.deepEqual(assessed.generatedBattle, sourceCopy, 'scoring must return the authored battle unchanged');
assert.deepEqual(source, sourceCopy, 'scoring must be pure over its input');
if (Math.abs(assessed.calibration.appliedScale - 1) >= 0.02) {
  assert.match(assessed.audit.warnings.join('\n'), /建议倍率/);
}

const extreme = generatedEnemy(999);
extreme.enemy.hp = 1_000_000_000;
extreme.enemy.max_hp = 1_000_000_000;
const extremeCopy = structuredClone(extreme);
const risky = balanceTowerGeneratedBattle({
  variables,
  generatedBattle: extreme,
  settings: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS, difficultyPercent: 80, simulationSeeds: 8 },
});
assert.equal(risky.requiresModelRepair, false, 'numeric strength must never enter a model-repair gate');
assert.equal(risky.audit.winnableAtCurrentResources, false);
assert.equal(risky.audit.appliedScale, 1);
assert.deepEqual(risky.audit.changedPaths, []);
assert.deepEqual(risky.generatedBattle, extremeCopy, 'even an extreme but executable enemy must remain authored content');

const nodeResult = {
  spec: 'mwg.tower-node-result/v1',
  node_id: 'act1-floor2-col1',
  request_id: 'request-1',
  based_on_revision: 2,
  kind: 'battle',
  title: '猎手拦路',
  narrative: '发条声在窄路上逼近。',
  payload: { battle: extreme },
  reward: {
    card: [{ id: 'reward_a' }, { id: 'reward_b' }, { id: 'reward_c' }],
    artifact: [],
    item: [{ id: 'reward_potion' }],
  },
};
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
assert.equal(parsed.program_balance, undefined, 'only the program may author the read-only balance audit');

console.log('Tower enemies are scored after authorship without numeric rewriting, rejection, or repair requests.');
