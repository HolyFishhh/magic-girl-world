import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createInitialDraftJsonSchema } = require('../src/game-core/initialDraftSchema.ts');
const { createProviderSafeJsonSchema } = require('../src/sillytavern-extension/towerGenerationHost.ts');
const source = createInitialDraftJsonSchema({ includeNarrative: false });
const before = structuredClone(source);
const projected = createProviderSafeJsonSchema(source).value;
const compile = (schema, part) => new Ajv2020({ strict: false }).compile({
  ...(schema.$defs ? { $defs: schema.$defs } : {}), ...part,
});
const wrapCard = effects => ({ id: 'test', name: 'Test', rarity: 'Common', type: 'Skill', cost: 1, quantity: 1, effects });
const owners = [
  ['card', s => s.properties.player.properties.cards.items, wrapCard],
  ['lust', s => s.properties.player.properties.player_lust_effect, effects => ({ name: 'Test', effects })],
  ['item', s => s.properties.player.properties.items.items, effects => ({ id: 'test', name: 'Test', count: 1, effects })],
];
let checks = 0;
for (const [owner, pick, wrap] of owners) {
  const canonical = compile(source.value, pick(source.value));
  const provider = compile(projected, pick(projected));
  for (const effect of [{ block: 2 }, { add_card: 'spark', to: 'hand', count: 1 },
    { add_card: 'spark', to: 'discard', count: 1 }, { copy: 1, from: 'discard', to: 'hand' }]) {
    for (const effects of [effect, [effect]]) {
      const value = wrap(effects);
      assert.equal(canonical(value), true, `${owner}: positive must be canonical syntax`);
      assert.equal(provider(value), true, `${owner}: provider must retain legal ${JSON.stringify(effect)}`);
      checks++;
    }
  }
  for (const effect of [{ modify: 'block', add: 2 }, { card_rule: 'retain_hand' }]) {
    for (const effects of [effect, [effect]]) {
      const value = wrap(effects);
      assert.equal(canonical(value), false);
      assert.equal(provider(value), false, `${owner}: immediate effects must reject continuous rules`);
      checks++;
    }
  }
}
// Continuous rules remain legal in their actual owner, not globally prohibited.
for (const schema of [source.value, projected]) {
  const validate = compile(schema, schema.properties.player.properties.artifacts.items);
  assert.equal(validate({ id: 'passive', name: 'Passive', rarity: 'Common',
    trigger: { on: 'passive', effects: { modify: 'block', add: 2 } } }), true);
}
assert.deepEqual(source, before);
console.log(`provider context parity: ${checks} scalar/array cases plus passive and immutability passed`);
