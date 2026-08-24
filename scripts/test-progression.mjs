import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const progression = require(resolve('src/game-core/index.ts'));
const hostProgression = require(resolve('src/common/progression.ts'));

assert.equal(progression.requiredExperienceForLevel(1), 100);
assert.equal(progression.requiredExperienceForLevel(2), 150);
assert.equal(progression.requiredExperienceForLevel(4), 250);
assert.equal(progression.totalExperienceAt(4, 50), 500);
assert.deepEqual(progression.progressionFromTotalExperience(500), { level: 4, exp: 50 });
assert.deepEqual(progression.planProgressionSettlement({ level: 1, exp: 500, core: { card_removal_count: 1 } }), {
  before: { level: 1, exp: 500 },
  after: { level: 4, exp: 50 },
  promotions: 3,
  cardRemovalsGranted: 2,
  changed: true,
  nextCardRemovalCount: 3,
});

const battle = {
  level: 1,
  exp: 500,
  core: { card_removal_count: 1 },
};
assert.equal(hostProgression.needsProgressionSettlement(battle), true);
assert.deepEqual(hostProgression.settleBattleProgression(battle), {
  before: { level: 1, exp: 500 },
  after: { level: 4, exp: 50 },
  promotions: 3,
  cardRemovalsGranted: 2,
});
assert.deepEqual(battle, {
  level: 4,
  exp: 50,
  core: { card_removal_count: 3 },
});
assert.equal(hostProgression.needsProgressionSettlement(battle), false);
assert.equal(hostProgression.settleBattleProgression(battle).promotions, 0);

const numericStrings = { level: '1', exp: '100', core: { card_removal_count: '0' } };
assert.equal(hostProgression.needsProgressionSettlement(numericStrings), true);
hostProgression.settleBattleProgression(numericStrings);
assert.deepEqual(numericStrings, { level: 2, exp: 0, core: { card_removal_count: 1 } });

const commonSource = await readFile(resolve('src/common/progression.ts'), 'utf8');
assert.match(commonSource, /planProgressionSettlement/);
assert.doesNotMatch(commonSource, /while\s*\(exp\s*>=/);

console.log('Progression thresholds, multi-level settlement, and idempotency passed.');
