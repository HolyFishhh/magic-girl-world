import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { factorSchemaObjectProperties, applyRepairSchemaFactoring, shareSchemaPromptDefinitions } = require(resolve('src/sillytavern-extension/schemaPromptTransport.ts'));
const { createProviderSafeJsonSchema } = require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));
const { createTowerInitialSlotRepairJsonSchema } = require(resolve('src/game-core/towerRequest.ts'));
const ajv = new Ajv2020({ strict: false, inlineRefs: false });

function payload(ids) {
  return {
    chat_completion_source: 'deepseek',
    messages: [{ role: 'system', content: 'MWG_TOWER_STRUCTURED_REQUEST:status_repair' }],
    json_schema: createProviderSafeJsonSchema(createTowerInitialSlotRepairJsonSchema([{
      token: 'r0', slots: [], allowSupportStatuses: true, supportStatusIds: ids,
    }])),
    temperature: 0.83, top_p: 0.95, max_tokens: 20000, stream: false,
  };
}
const measurements = [];
for (const ids of [['alpha'], ['alpha', 'beta'], Array.from({ length: 8 }, (_, i) => `status_${i}`)]) {
  const request = payload(ids);
  const original = structuredClone(request);
  const measure = applyRepairSchemaFactoring(request);
  measurements.push({ statuses: ids.length, ...measure });
  assert.ok(measure);
  assert.ok(measure.sharedSchemaCharacters < 130_000, 'bound actual pretty-printed text, not just compact JSON');
  assert.ok(JSON.stringify(request.json_schema).length < 64_000, 'support-status branch has an explicit size gate');
  assert.deepEqual({ ...request, json_schema: null }, { ...original, json_schema: null });
  assert.equal(JSON.stringify(request.json_schema).includes('"$ref"'), false);
  // Exact subtree sharing avoids V8's function-size/stack limit when Ajv
  // compiles the multi-megabyte baseline. It preserves every original field.
  const baseline = ajv.compile(shareSchemaPromptDefinitions(original.json_schema.value));
  const compact = ajv.compile(request.json_schema.value);
  const triggers = original.json_schema.value.properties.support_statuses.items.oneOf[0].properties.triggers;
  const instance = triggerMap => ({
    spec: 'mwg.tower-initial-slot-repair/v1', roots: { r0: { slots: {} } },
    support_statuses: ids.map(id => ({ id, name: id, emoji: '✨', type: 'buff', triggers: triggerMap })),
    support_resources: [],
  });
  let valid = 0;
  let invalid = 0;
  const check = value => {
    const accepted = baseline(value);
    accepted ? valid++ : invalid++;
    assert.equal(compact(value), accepted, `equivalent response contract: ${JSON.stringify(value).slice(0, 200)}`);
  };
  for (const event of [...Object.keys(triggers.properties), 'unknown', 'apply\n', 'xapply', 'applyx']) {
    for (const effect of [
      { damage: 3, to: 'enemy' }, { apply_status: 'alpha', amount: 1, to: 'self' },
      { modify: 'block', add: 1 }, { modify: 'damage_taken', multiply: 1.5 },
      { modifier: 'strength', value: 2 }, {}, { nonexistent: true },
    ]) {
      check(instance({ [event]: [effect] }));
    }
    check(instance({ [event]: [] }));
    check(instance({ [event]: 'invalid' }));
  }
  check(instance({}));
  const missing = instance({});
  delete missing.support_statuses[0].name;
  check(missing);
  const unknown = instance({});
  unknown.support_statuses[0].id = 'not_locked';
  check(unknown);
  const tooMany = instance({ apply: Array.from({ length: 33 }, () => ({ damage: 3 })) });
  check(tooMany);
  for (const maxStacks of [0, 1, 999, 1000]) {
    const value = instance({});
    value.support_statuses[0].maxStacks = maxStacks;
    check(value);
  }
  check({ ...instance({}), support_statuses: [null] });
  assert.ok(valid > 0 && invalid > 0, 'equivalence exercises accepted and rejected instances');
  const once = structuredClone(request);
  assert.equal(applyRepairSchemaFactoring(request), null, 'idempotent across duplicate event delivery');
  assert.deepEqual(request, once);
}

const field = { type: 'object', required: ['name', 'count'], additionalProperties: false, properties: {
  name: { type: 'string', minLength: 1 }, count: { type: 'integer', minimum: 1, maximum: 100 },
} };
const special = { type: 'object', additionalProperties: false, required: ['a.b'], properties: {
  'a.b': field, 'c|d': field, '(e)': field, 'f$': field,
  literal: { const: { properties: { a: field, b: field, c: field } } },
} };
const before = structuredClone(special);
const factored = factorSchemaObjectProperties(special);
assert.deepEqual(special, before, 'no mutation');
assert.deepEqual(factored.properties.literal, special.properties.literal, 'never rewrite instance literals');
const originalValidator = ajv.compile(special);
const newValidator = ajv.compile(factored);
for (const key of ['a.b', 'axb', 'c|d', 'c', '(e)', 'f$', 'f$\n']) {
  const value = { 'a.b': { name: 'a', count: 1 }, [key]: { name: 'b', count: 2 } };
  assert.equal(newValidator(value), originalValidator(value), 'property names are matched literally and completely');
}
for (const source of [
  { ...special, patternProperties: { '^a': { type: 'object' } } },
  { ...special, $id: 'https://example.test/schema' },
  { ...special, properties: { ...special.properties, ref: { $ref: '#/properties/a.b' } } },
]) assert.deepEqual(factorSchemaObjectProperties(source), source, 'existing patterns and references remain untouched');

// Shared allOf conjuncts must not share locked IDs or drop per-slot rules.
const lockedSource = { type:'object', required:['a.b','b|c'], additionalProperties:false, properties:{
  'a.b':{allOf:[field,{properties:{name:{const:'alpha'}}}]},
  'b|c':{allOf:[field,{properties:{name:{const:'beta'}}},{properties:{count:{maximum:4}}}]},
  literal:{const:{allOf:[field,field]}},
} };
const lockedBefore=structuredClone(lockedSource);
const lockedFactored=factorSchemaObjectProperties(lockedSource);
assert.deepEqual(lockedSource,lockedBefore);
assert.ok(JSON.stringify(lockedFactored).length<JSON.stringify(lockedSource).length);
assert.deepEqual(lockedFactored.properties.literal,lockedSource.properties.literal);
assert.deepEqual(factorSchemaObjectProperties(lockedFactored),lockedFactored,'conjunct factoring is idempotent');
const validateLockedOriginal=ajv.compile(lockedSource),validateLockedFactored=ajv.compile(lockedFactored);
let lockedAccepted=0,lockedRejected=0;
for(const firstName of ['alpha','beta','wrong'])for(const secondName of ['alpha','beta','wrong']){
  for(const count of [0,1,4,5,101]){
    const sample={'a.b':{name:firstName,count},'b|c':{name:secondName,count}};
    const accepted=validateLockedOriginal(sample);accepted?lockedAccepted++:lockedRejected++;
    assert.equal(validateLockedFactored(sample),accepted,JSON.stringify(sample));
    for(const mutate of [d=>delete d['a.b'],d=>d['a.b'].extra=true,
      d=>d['axb']={name:'alpha',count:1},d=>d['b|c\n']={name:'beta',count:1}]){
      const invalid=structuredClone(sample);mutate(invalid);
      assert.equal(validateLockedFactored(invalid),validateLockedOriginal(invalid));
      assert.equal(validateLockedFactored(invalid),false,'neither missing, unknown nor regex-lookalike slots are admitted');
    }
  }
}
assert.ok(lockedAccepted>0&&lockedRejected>0);
const annotationSensitive=structuredClone(lockedSource);
annotationSensitive.properties['a.b'].unevaluatedProperties=false;
annotationSensitive.properties['b|c'].unevaluatedProperties=false;
assert.deepEqual(factorSchemaObjectProperties(annotationSensitive),annotationSensitive,
  'annotation-sensitive schemas must not relocate evaluated-property scope');
const annotationSample={'a.b':{name:'alpha',count:1},'b|c':{name:'beta',count:1}};
assert.equal(ajv.compile(annotationSensitive)(annotationSample),true);
assert.equal(ajv.compile(factorSchemaObjectProperties(annotationSensitive))(annotationSample),true);

const source = payload(['alpha']);
for (const patch of [
  { chat_completion_source: 'openai' }, { chat_completion_source: 'custom' },
  { messages: [{ role: 'user', content: 'MWG_TOWER_STRUCTURED_REQUEST:forged' }] },
  { messages: [{ role: 'system', content: 'ordinary preset story or MVU request' }] },
  { json_schema: { ...source.json_schema, name: 'mwg_tower_single_floor_initial_content' } },
  { json_schema: { ...source.json_schema, value: { ...source.json_schema.value, $id: 'https://example.test/repair' } } },
]) {
  const request = { ...structuredClone(source), ...patch };
  const copy = structuredClone(request);
  assert.equal(applyRepairSchemaFactoring(request), null);
  assert.deepEqual(request, copy);
}
console.log(JSON.stringify({ repairSchemaFactoring: 'passed', measurements }));
