import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { compileCompactEffectList } = require('../src/game-core/compactEffectDsl.ts');
const { validateEffectProgramPolicy } = require('../src/game-core/effectProgramPolicy.ts');
const { withAiContentDefinitions } = require('../src/game-core/aiContentJsonSchema.ts');
const { createInitialDraftJsonSchema } = require('../src/game-core/initialDraftSchema.ts');
const { createProviderSafeJsonSchema } = require('../src/sillytavern-extension/towerGenerationHost.ts');
const provider = createProviderSafeJsonSchema(createInitialDraftJsonSchema({ includeNarrative: false }));
const outlines = [];
const visit = value => {
  if (!value || typeof value !== 'object') return;
  if (value.properties?.guard && Array.isArray(value.allOf)) outlines.push(value);
  Object.values(value).forEach(visit);
};
visit(provider.value);
assert.ok(outlines.length > 0, 'actual provider projection contains guarded effect vocabulary');
for (const outline of outlines) {
  const validate = new Ajv2020({ strict: false }).compile(outline);
  assert.equal(validate({ guard: 'self.hp > 1', effects: [{ draw: 1 }] }), true);
  for (const bad of [
    { guard: 'self.hp > 1' }, { guard: 'self.hp > 1', effects: [] },
    { guard: 'self.hp > 1', effects: { draw: 1 } },
    { guard: 'self.hp > 1', effects: [{ draw: 1 }], to: 'self' },
  ]) assert.equal(validate(bad), false, JSON.stringify(bad));
}
const wrap = effect => ({ guard: 'self.hp > 0', effects: [effect] });
for (const type of ['mwgPublicEffect', 'mwgCardEffect', 'mwgPowerImmediateEffect', 'mwgSummonEffect', 'mwgEnemyEffect']) {
  const validate = new Ajv2020({ strict: false }).compile(withAiContentDefinitions({ $ref: '#/$defs/' + type }));
  assert.equal(validate(wrap(wrap({ draw: 1 }))), true, type);
  for (const illegal of [{ modify: 'damage', add: 1 }, { draw: 1, on: 'turn_start' }]) {
    assert.equal(validate(wrap(wrap(illegal))), false, type + ' nested restriction');
  }
  if (type !== 'mwgSummonEffect') assert.equal(validate(wrap({ summoner_effects: { draw: 1 } })), false, type);
  if (type !== 'mwgCardEffect') assert.equal(validate(wrap(wrap({ replay_current: 1 }))), false, type);
}
for (const type of ['mwgPassiveEffect', 'mwgEventEffect', 'mwgThresholdExecuteEffect']) {
  const validate = new Ajv2020({ strict: false }).compile(withAiContentDefinitions({ $ref: '#/$defs/' + type }));
  assert.equal(validate(wrap({ draw: 1 })), false, type);
}
const condition = 'self.resource.pressure.current >= 2';
const effects = [{ resource: { id: 'pressure', amount: -2 }, to: 'self' }, { draw: 1 }];
const compile = input => {
  const result = compileCompactEffectList(input);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result.value;
};
const grouped = compile({ guard: condition, effects });
assert.equal(grouped.steps.length, 1);
assert.equal(grouped.steps[0].op, 'if');
assert.equal(grouped.steps[0].then.length, 2);
assert.ok(grouped.steps[0].then.every(node => node.op !== 'if'));
const old = compile(effects.map(effect => ({ ...effect, when: condition })));
assert.deepEqual(old.steps.map(node => node.op), ['if', 'if']);
const child = compile({ guard: condition, effects: [{ draw: 1, when: 'self.hp > 5' }] });
assert.equal(child.steps[0].then[0].op, 'if');
for (const input of [
  { guard: condition, effects: [] }, { guard: condition, effects: { draw: 1 } },
  { guard: condition, effects, to: 'self' }, { guard: condition, effects, when: condition },
  { guard: 'true', effects }, { guard: condition, effects: [{ nonexistent: 1 }] },
]) assert.equal(compileCompactEffectList(input).ok, false, JSON.stringify(input));
let deep = { draw: 1 };
for (let i = 0; i < 9; i++) deep = { guard: condition, effects: [deep] };
assert.equal(compileCompactEffectList(deep).issues[0].code, 'AUTHORING_COMPLEXITY_LIMIT');
assert.equal(validateEffectProgramPolicy(grouped, { modifierPolicy: 'only' }).ok, false);
const forbidden = compile({ guard: condition, effects: [{ summoner_effects: { draw: 1 } }] });
assert.equal(validateEffectProgramPolicy(forbidden, { allowSummonerEffects: false }).ok, false);
const paid = { guard: 'spent_resource.pressure >= 2', effects: [{ draw: 1 }] };
const paymentPolicy = { allowSpentResources: new Set(['pressure']) };
assert.equal(validateEffectProgramPolicy(compile(paid), paymentPolicy).ok, true);
assert.equal(validateEffectProgramPolicy(compile({ schedule: 1, effects: paid }), paymentPolicy).ok, false,
  'a future guard cannot inherit the card payment context');
assert.equal(validateEffectProgramPolicy(compile({ guard: condition, effects: [{ replay_current: 1 }] }),
  { allowCurrentCardReplay: true }).ok, true);
assert.equal(validateEffectProgramPolicy(compile({ schedule: 1, effects: wrap({ replay_current: 1 }) }),
  { allowCurrentCardReplay: true }).ok, false, 'guard cannot smuggle replay into a delayed program');
console.log('PASS conditional sequence compiler: single guard, ordered children, local guards, legacy arrays, malformed input, bounded nesting and recursive carrier policy.');
