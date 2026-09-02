import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { createRunState } = require(resolve('src/game-core/runState.ts'));
const { createTowerRunScore, recordTowerEncounter } = require(resolve('src/game-core/towerRunScore.ts'));
const { createTowerFinale, createTowerRunShareSnapshot } = require(resolve('src/game-core/towerFinale.ts'));

let score = createTowerRunScore();
score = recordTowerEncounter(score, {
  nodeId: 'a1_f1_c0',
  act: 1,
  floor: 1,
  playerDeckScore: 100,
  enemyScore: 80,
  outcome: 'victory',
});
score = recordTowerEncounter(score, {
  nodeId: 'a3_boss',
  act: 3,
  floor: 16,
  playerDeckScore: 125,
  enemyScore: 137.5,
  outcome: 'victory',
});

const base = createRunState({ seed: 20260830 });
const completed = {
  ...base,
  phase: 'won',
  act: 3,
  floor: 16,
  currentNode: null,
  choices: [],
  visitedNodeIds: ['a1_f1_c0', 'a3_boss'],
  score,
};

const finale = createTowerFinale(completed);
assert.equal(finale.fishEmoji, '🐟');
assert.equal(finale.damage, 217.5);
assert.equal(finale.defeatedEnemyScore, 217.5);
assert.equal(finale.averageDifficultyPercent, 95);
assert.equal(finale.fishLine, createTowerFinale(structuredClone(completed)).fishLine);
assert.equal(finale.playerLine, createTowerFinale(structuredClone(completed)).playerLine);

const share = createTowerRunShareSnapshot(completed);
assert.equal(share.spec, 'mwg.tower-run-share/v1');
assert.equal(share.seed, 20260830);
assert.deepEqual(share.visitedNodeIds, ['a1_f1_c0', 'a3_boss']);
assert.equal(share.score.encounters.length, 2);
assert.equal(JSON.stringify(share).includes('fishLine'), false);

assert.throws(() => createTowerFinale(base), /completed map run/);

console.log('tower finale and future share snapshot are deterministic and score-backed');
