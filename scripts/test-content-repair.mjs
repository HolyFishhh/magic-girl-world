import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const prompt = core.formatBoundedContentRepairPrompt(
  '[战斗场景修复]',
  [
    { path: 'battle.enemy.action_config.probability.危险行动', code: 'INVALID_WEIGHT' },
    { path: 'battle.enemy.actions[0].effects.damage', code: 'UNKNOWN_VARIABLE' },
    { path: 'battle.enemy.actions[0].effects.damage', code: 'UNKNOWN_VARIABLE' },
    { path: 'bad path with user text', code: 'not-a-stable-code' },
  ],
  4,
);
assert.equal(
  prompt,
  '[战斗场景修复]\n问题=battle.enemy.action_config.probability(INVALID_WEIGHT),battle.enemy.actions[0].effects.damage(UNKNOWN_VARIABLE)',
);
assert.doesNotMatch(prompt, /危险行动|user text|not-a-stable-code/);
const summary = core.formatBoundedContentIssueSummary([
  { path: 'battle.enemy.action_config.probability.危险行动', code: 'INVALID_WEIGHT' },
  { path: 'battle.enemy.actions[0].effects.damage.left', code: 'UNKNOWN_VARIABLE' },
]);
assert.equal(
  summary,
  'battle.enemy.action_config.probability(INVALID_WEIGHT)；battle.enemy.actions[0].effects.damage.left(UNKNOWN_VARIABLE)',
);
assert.doesNotMatch(summary, /危险行动/);
assert.throws(
  () => core.formatBoundedContentRepairPrompt('[bad marker!]', [{ path: 'battle.enemy' }]),
  /repair marker is invalid/,
);

const bounded = core.formatBoundedContentRepairPrompt(
  '[战斗场景修复]',
  Array.from({ length: 7 }, (_, index) => ({ path: `battle.enemy.actions[${index}]`, code: 'INVALID_ENTRY' })),
  4,
);
assert.match(bounded, /,\+3$/);

console.log('One bounded repair prompt formatter hides AI-controlled values for every host.');
