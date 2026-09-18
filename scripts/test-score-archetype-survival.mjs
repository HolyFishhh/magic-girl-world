import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/index.ts');

const compactEffects = [
  { heal: 4 },
  { damage: 12, lifesteal: 0.5 },
  { modify: 'damage_taken', multiply: 0.75 },
  { spawn_summon: { id: 'guard', name: '护卫', emoji: '🛡️', max_hp: 10, intercept: { mode: 'unblocked_attack', max_per_turn: 1 }, actions: [{ id: 'guard_action', name: '护卫动作', effects: [{ block: 1, to: 'self' }] }] } },
];
const compiledResult = core.compileCompactEffectList(compactEffects);
assert.equal(compiledResult.ok, true, compiledResult.ok ? '' : JSON.stringify(compiledResult.issues));
const compactFeatures = core.extractContentMechanicFeatures({ effects: compactEffects });
const compiledFeatures = core.extractContentMechanicFeatures({ effectProgram: compiledResult.value });
for (const operation of ['heal', 'lifesteal', 'damage_taken_reduction', 'summon_intercept']) {
  assert.ok(compactFeatures.operations.includes(operation), `compact recognizes ${operation}`);
  assert.ok(compiledFeatures.operations.includes(operation), `compiled recognizes ${operation}`);
}
assert.deepEqual(compiledFeatures.operations.sort(), compactFeatures.operations.sort(), '合法 compact/compiled 识别一致');
assert.ok(compactFeatures.axes.includes('生存'));

for (const effect of [
  { modify: 'damage_taken', add: 1 },
  { modify: 'damage_taken', multiply: 1.25 },
  { modify: 'damage_taken', divide: 0.5 },
]) {
  const result = core.compileCompactEffectList(effect);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  const negative = core.extractContentMechanicFeatures({ effects: effect });
  const negativeCompiled = core.extractContentMechanicFeatures({ effectProgram: result.value });
  assert.ok(!negative.operations.includes('damage_taken_reduction'), `not mitigation: ${JSON.stringify(effect)}`);
  assert.ok(!negativeCompiled.operations.includes('damage_taken_reduction'), `not compiled mitigation: ${JSON.stringify(effect)}`);
}
assert.ok(!core.extractContentMechanicFeatures({ capabilities: { intercepts: true } }).operations.includes('summon_intercept'));
assert.ok(!core.extractContentMechanicFeatures({ intercept: { mode: 'unblocked_attack' } }).operations.includes('summon_intercept'));

const profile = core.profileDeckArchetypes(core.createContentPack({ cards: [
  { id: 'drain', name: '汲取', type: 'Attack', cost: 1, quantity: 3, effects: { damage: 8, lifesteal: 0.5 } },
] }));
assert.ok(profile.affinities.some(entry => entry.id === 'healing-engine' || entry.id === 'healing-conversion'));

const score = core.scoreDeckPower({ pack: core.createContentPack({ cards: [
  { id: 'drain', name: '汲取', type: 'Attack', cost: 1, quantity: 3, effects: { damage: 8, lifesteal: 0.5 } },
] }), maxHp: 80 });
assert.ok(score.reasons.some(reason => reason.includes('生存识别')));
assert.ok(score.reasons.some(reason => reason.includes('治疗') || reason.includes('吸血')));
assert.ok(score.reasons.every(reason => !reason.includes('damage_taken_reduction') && !reason.includes('lifesteal')));
console.log('PASS survival recognition: lifesteal, healing, mitigation and summon interception are classified without changing execution data.');
