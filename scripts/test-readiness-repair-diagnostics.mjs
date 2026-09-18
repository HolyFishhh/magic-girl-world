import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const {
  assessInitialPlayerContent,
  createContentPack,
  formatPlayerContentReadiness,
} = require('../src/game-core/index.ts');
const { extractTowerInitialRepairSlotTargets } = require('../src/sillytavern-extension/controller.ts');

// A root-level modifier is not a legal card effects operation and cannot be
// converted into one of the finite safe repair slots without deleting it.
const initial = {
  narrative: '保留的剧情',
  status: {},
  player: {
    core: {},
    cards: [{
      id: 'bad_modifier', name: '错误修饰', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
      effects: { modify: { stat: 'damage', add: 1 } },
    }],
  },
  opening: { choices: [] },
};
const before = structuredClone(initial);
const readiness = assessInitialPlayerContent(createContentPack({ cards: initial.player.cards, statuses: [] }));
const diagnostic = formatPlayerContentReadiness(readiness, 8);

assert.match(
  diagnostic,
  /battle\.cards\[0\]\.effects\.modify：规则字段不符合浅层 effects 契约（校验代码：INVALID_MODIFIER，具体原因：Unsupported modifier: \[object Object\]）/,
);
assert.match(diagnostic, /battle\.cards\[0\]\.effects：.*校验代码：INVALID_MODIFIER_OPERATOR/);
assert.doesNotMatch(diagnostic, /校验代码：[^；]*；具体原因：/);
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(initial, diagnostic),
  [],
  'an unrepresentable compiler error must fail closed instead of opening or deleting a broader card slot',
);
assert.deepEqual(initial, before);

const lustInitial = {
  narrative: '保留的剧情',
  status: {},
  player: {
    core: { emoji: '🧙', hp: 50, max_hp: 50, lust: 0, max_lust: 100 },
    cards: [{
      id: 'pressure', name: '欲望施压', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
      effects: { lust: 8 },
    }],
  },
  opening: { choices: [] },
};
const lustDiagnostic = 'battle.player_lust_effect：缺少对应欲望满溢效果；';
const lustTargets = extractTowerInitialRepairSlotTargets(lustInitial, lustDiagnostic);
assert.equal(lustTargets.length, 1, 'missing overflow must open a bounded repair root');
assert.equal(lustTargets[0].path, 'player.player_lust_effect');
assert.deepEqual(lustTargets[0].slots.map(slot => [slot.kind, slot.path]), [
  ['missing_lust_effect', 'player.player_lust_effect'],
]);

console.log('PASS readiness fallback retains compiler path/code/reason while bounded repair rejects an unsafe root-effects rewrite.');
