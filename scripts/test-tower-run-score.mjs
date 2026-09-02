import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const score = require('../src/game-core/towerRunScore.ts');
const { createRunState, enterRunNode } = require('../src/game-core/runState.ts');
const { settleBattleRunInStat } = require('../src/runtime/runStateAdapter.ts');

let run = score.createTowerRunScore();
run = score.recordTowerEncounter(run, {
  nodeId: 'a1_f1_battle_1',
  act: 1,
  floor: 1,
  playerDeckScore: 100,
  enemyScore: 80,
  outcome: 'victory',
});
run = score.recordTowerEncounter(run, {
  nodeId: 'a1_f6_elite_2',
  act: 1,
  floor: 6,
  playerDeckScore: 120,
  enemyScore: 132,
  outcome: 'victory',
});
run = score.recordTowerEncounter(run, {
  nodeId: 'a1_f8_battle_3',
  act: 1,
  floor: 8,
  playerDeckScore: 125,
  enemyScore: 90,
  outcome: 'escaped',
});

assert.equal(run.defeatedEnemyScore, 212);
assert.equal(run.averageDifficultyRatio, 0.95);
assert.equal(run.averageDifficultyPercent, 95);
assert.equal(score.validateTowerRunScore(run), true);
assert.throws(() => score.recordTowerEncounter(run, {
  nodeId: 'a1_f1_battle_1',
  act: 1,
  floor: 1,
  playerDeckScore: 100,
  enemyScore: 80,
  outcome: 'victory',
}), /already recorded/);
assert.throws(() => score.recordTowerEncounter(run, {
  nodeId: 'bad',
  act: 1,
  floor: 1,
  playerDeckScore: 0,
  enemyScore: 80,
  outcome: 'defeat',
}), /greater than zero/);

const tampered = structuredClone(run);
tampered.averageDifficultyPercent = 1;
assert.equal(score.validateTowerRunScore(tampered), false);

const towerStat = { run: createRunState({ seed: 77 }) };
towerStat.run = enterRunNode(towerStat.run, towerStat.run.choices[0].id);
const activeNodeId = towerStat.run.currentNode.id;
settleBattleRunInStat(towerStat, 'victory', activeNodeId, {
  playerDeckScore: 140,
  enemyScore: 112,
});
assert.equal(towerStat.run.score.encounters.length, 1);
assert.equal(towerStat.run.score.encounters[0].nodeId, activeNodeId);
assert.equal(towerStat.run.score.averageDifficultyPercent, 80);
assert.equal(towerStat.run.score.defeatedEnemyScore, 112);

console.log('tower run score tests passed');
