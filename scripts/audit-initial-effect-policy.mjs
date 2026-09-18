import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createInitialDraftJsonSchema } = require('../src/game-core/initialDraftSchema.ts');
const { compileCompactEffectList } = require('../src/game-core/compactEffectDsl.ts');
const { validateEffectProgramPolicy } = require('../src/game-core/effectProgramPolicy.ts');
const { createProviderSafeJsonSchema } = require('../src/sillytavern-extension/towerGenerationHost.ts');
const schema = createInitialDraftJsonSchema({ includeNarrative: false }).value;
const cases = [
  ['block', { block: 2 }],
  ['modify', { modify: 'block', add: 2 }],
  ['card_rule', { card_rule: 'retain_hand' }],
  ['invented_counter', { block: 2, when: 'attacks_discarded_this_turn > 0' }],
  ['known_counter', { block: 2, when: 'turn_number > 0' }],
  ['generated_card_to_hand', { add_card: 'probe_template', to: 'hand', count: 1 }],
  ['generated_card_to_discard', { add_card: 'probe_template', to: 'discard', count: 1 }],
  ['copy_to_hand', { copy: 1, from: 'discard', to: 'hand' }],
];
const rows = [];
for (const definition of ['effectList', 'mwgCardEffectList', 'mwgPassiveEffectList']) {
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile({
    $defs: schema.$defs, $ref: `#/$defs/${definition}`,
  });
  for (const [name, effect] of cases) {
    const compiled = compileCompactEffectList([effect]);
    const runtime = compiled.ok ? validateEffectProgramPolicy(compiled.value, {
      triggerPolicy: 'forbid', modifierPolicy: definition === 'mwgPassiveEffectList' ? 'only' : 'forbid',
      allowCardDestination: definition === 'mwgCardEffectList',
      allowCurrentCardReplay: definition === 'mwgCardEffectList',
    }) : compiled;
    rows.push({ definition, case: name, schema: validate([effect]), runtime: runtime.ok });
  }
}
// Guard the audit itself: a generic-looking reference is not proof of permissive semantics.
assert.equal(rows.find(r => r.definition === 'effectList' && r.case === 'modify').schema, false);
assert.equal(rows.find(r => r.definition === 'effectList' && r.case === 'modify').runtime, false);
console.log(JSON.stringify({ rows, differences: rows.filter(r => r.schema !== r.runtime),
  scope: 'Canonical initial schema vs compact compiler and context policy; not provider projection, full request, or live acceptance.' }, null, 2));

const provider = createProviderSafeJsonSchema(createInitialDraftJsonSchema({ includeNarrative: false })).value;
const owners = [
  ['lust', s => s.properties.player.properties.player_lust_effect,
    effects => ({ name: 'probe', effects })],
  ['card', s => s.properties.player.properties.cards.items,
    effects => ({ id: 'probe', name: 'probe', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects })],
  ['item', s => s.properties.player.properties.items.items,
    effects => ({ id: 'probe', name: 'probe', count: 1, effects })],
];
const ownerRows = [];
for (const [owner, pick, wrap] of owners) {
  const checks = [schema, provider].map(s => new Ajv2020({ strict: false }).compile({
    ...(s.$defs ? { $defs: s.$defs } : {}), ...pick(s),
  }));
  for (const [name, effect] of cases) {
    const value = wrap([effect]);
    ownerRows.push({ owner, case: name, canonical: checks[0](value), provider: checks[1](value) });
  }
}
console.log(JSON.stringify({ ownerRows, projectionDifferences: ownerRows.filter(r => r.canonical !== r.provider),
  scope: 'Production provider factory, selected full owner wrappers. No model request; not full live wire.' }, null, 2));
