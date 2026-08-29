import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const pool = { energy: 3, stars: 2, charge: 5 };
let payment = core.resolveCardResourcePayment({ energy: 1, stars: 2 }, pool);
assert.equal(payment.affordable, true);
assert.deepEqual(payment.spent, { energy: 1, stars: 2 });
assert.deepEqual(core.applyCardResourcePayment(pool, payment), { energy: 2, stars: 0, charge: 5 });

payment = core.resolveCardResourcePayment({ energy: 'all', stars: 1 }, pool, undefined, 2);
assert.equal(payment.xValue, 5);
assert.deepEqual(payment.xValues, { energy: 5 });
assert.deepEqual(payment.spent, { energy: 3, stars: 1 });

const free = core.resolveCardResourcePayment({ energy: 2, stars: 1 }, pool, 'all');
assert.deepEqual(free.spent, { energy: 0, stars: 0 });
const energyOnlyFree = core.resolveCardResourcePayment({ energy: 2, stars: 1 }, pool, ['energy']);
assert.deepEqual(energyOnlyFree.spent, { energy: 0, stars: 1 });

const shortage = core.resolveCardResourcePayment({ energy: 1, stars: 3 }, pool);
assert.equal(shortage.affordable, false);
assert.deepEqual(shortage.shortage, { resource: 'stars', required: 3, available: 2 });
assert.throws(() => core.applyCardResourcePayment(pool, shortage), /unaffordable/);

const states = core.normalizeCombatResourceStates([
  { id: 'stars', name: '星能', emoji: '⭐', current: 2, max: 5, refresh: 'retain' },
  { id: 'charge', name: '充能', emoji: '⚡', current: 1, max: 3, refresh: 'reset' },
]);
assert.deepEqual(core.resourcePoolFromCombatant(3, states), { energy: 3, stars: 2, charge: 1 });
assert.equal(core.refreshCombatResourceStates(states).stars.current, 2);
assert.equal(core.refreshCombatResourceStates(states).charge.current, 3);
assert.equal(core.describeCardCost({ energy: 1, stars: 'all' }, states), '1💎能量 + X⭐星能');
assert.equal(core.estimateCardCostWeight({ energy: 1, stars: 'all' }, pool), 3);
assert.equal(core.estimateCardCostWeight({ stars: 'all' }, {}, 4), 4);

assert.deepEqual(core.validateCombatResourceDefinitions([
  { id: 'stars', name: '星能', emoji: '⭐', current: 2, max: 5, refresh: 'retain' },
]), []);
const definitionIssues = core.validateCombatResourceDefinitions([
  { id: 'energy', name: '', emoji: '', current: -1, max: 0, refresh: 'daily', extra: true },
  { id: 'stars', name: '星能', emoji: '⭐', current: 2, max: 5, refresh: 'retain' },
  { id: 'stars', name: '星能', emoji: '⭐', current: 6, max: 5, refresh: 'retain' },
]);
for (const code of ['INVALID_RESOURCE_ID', 'INVALID_RESOURCE_NAME', 'INVALID_RESOURCE_EMOJI', 'INVALID_RESOURCE_VALUE', 'INVALID_RESOURCE_REFRESH', 'UNKNOWN_RESOURCE_FIELD', 'DUPLICATE_RESOURCE_ID']) {
  assert.equal(definitionIssues.some(issue => issue.code === code), true, code);
}

for (const invalid of [-1, 1.5, {}, { 'bad-id': 1 }, { stars: -1 }, { stars: 1.5 }, { stars: 'some' }]) {
  assert.ok(core.validateCardCost(invalid), `invalid cost must be rejected: ${JSON.stringify(invalid)}`);
}

const astSchema = JSON.parse(await readFile(resolve('schemas/mwg-effect-v1.schema.json'), 'utf8'));
const compactSchema = JSON.parse(await readFile(resolve('schemas/mwg-card-effects-v1.schema.json'), 'utf8'));
for (const schema of [astSchema, compactSchema]) {
  assert.ok(schema.$defs.cardCost);
  assert.equal(schema.$defs.cardCost.oneOf[2].minProperties, 1);
  assert.equal(schema.$defs.cardCost.oneOf[2].maxProperties, 16);
}
assert.ok(astSchema.$defs.resourceEffect);
assert.ok(compactSchema.$defs.resourceEffect);
assert.ok(astSchema.$defs.cardPlayRuleEffect.properties.freeResources);
assert.ok(compactSchema.$defs.cardPlayRuleEffect.properties.resources);

console.log('Composite resources resolve fixed, retained, partial-free, all-resource X, and atomic payment semantics.');
