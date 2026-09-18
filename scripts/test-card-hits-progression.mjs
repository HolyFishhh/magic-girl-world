import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const compactSchema = JSON.parse(await readFile(resolve('schemas/mwg-card-effects-v1.schema.json'), 'utf8'));
const validateCompactSchema = new Ajv2020({ strict: false, allErrors: true }).compile(compactSchema);
const flatten = steps => steps.flatMap(step => step.op === 'if'
  ? [...flatten(step.then), ...flatten(step.else || [])]
  : step.op === 'register_trigger' ? flatten(step.effects) : [step]);
const damageGroups = program => {
  const groups = new Map();
  for (const step of flatten(program.steps)) {
    if (step.op === 'damage') groups.set(step.hitGroup, (groups.get(step.hitGroup) || 0) + 1);
  }
  return groups;
};

const authoredEffects = [
  { damage: 3 },
  { damage: 5, hits: 2, when: 'self.hp > 0' },
  { block: 4 },
  { draw: 1 },
];
const compiled = core.compileCompactEffectList(authoredEffects);
assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
assert.deepEqual([...damageGroups(compiled.value).values()].sort(), [1, 2],
  'the compiler must mark default and explicit damage groups independently');
assert.equal(core.validateEffectProgram(compiled.value).ok, true,
  'compiler-only hit metadata must remain valid portable AST data');

const card = {
  id: 'dual_strike', originalId: 'dual_strike', templateId: 'dual_strike', runInstanceId: 'dual_strike__run__1',
  effectProgram: compiled.value,
};
const upgraded = core.applyCardUpgradeBundle(card, {
  source: { kind: 'system', id: 'test' }, scope: 'permanent', createdTurn: 1,
  changes: [{ kind: 'hits', add: 1 }],
});
assert.deepEqual([...damageGroups(upgraded.effectProgram).values()].sort(), [2, 3],
  'each independently authored damage group gains exactly one hit');
const upgradedSteps = flatten(upgraded.effectProgram.steps);
assert.equal(upgradedSteps.filter(step => step.op === 'gain_block').length, 1,
  'hits growth must not repeat block side effects');
assert.equal(upgradedSteps.filter(step => step.op === 'draw_cards').length, 1,
  'hits growth must not replay draw side effects, including conditional damage branches');

const saved = core.serializePersistentCardProgression({ id: 'dual_strike', name: '双段试炼', effects: authoredEffects }, upgraded);
const restored = core.restorePersistentCardProgression(card, JSON.parse(JSON.stringify(saved)));
assert.deepEqual([...damageGroups(restored.effectProgram).values()].sort(), [2, 3],
  'validated persistent progression must restore hit growth from the canonical compiled card');

const capped = core.compileCompactEffectList({ damage: 1, hits: 20 });
assert.equal(capped.ok, true, JSON.stringify(capped.issues));
assert.deepEqual([...damageGroups(core.transformCardHitGroups(capped.value, 1)).values()], [20],
  'each group is bounded at 20 hits');
const noDamage = core.compileCompactEffectList([{ block: 3 }, { draw: 1 }]);
assert.equal(noDamage.ok, true, JSON.stringify(noDamage.issues));
assert.equal(core.hasCardHitTarget(noDamage.value), false,
  'hit patch/upgrade selection must skip cards with no owned damage groups');

assert.equal(validateCompactSchema({ effects: { patch_card: 'hits', add: 1 } }), true,
  JSON.stringify(validateCompactSchema.errors));
assert.equal(validateCompactSchema({ effects: { patch_card: 'hits', add: 1.5 } }), false,
  'AI schema exposes only positive integer hit growth');
assert.equal(validateCompactSchema({ effects: { upgrade_card: 1, changes: [{ kind: 'hits', add: 1 }] } }), true,
  JSON.stringify(validateCompactSchema.errors));

console.log('Card hits progression is compiler-marked, bounded, side-effect-safe, schema-constrained, and persistent.');
