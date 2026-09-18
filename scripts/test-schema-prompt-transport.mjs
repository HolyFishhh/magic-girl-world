import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { shareSchemaPromptDefinitions, applySchemaPromptTransport, createEmptyJsonModeFallbackMessage, SCHEMA_PROMPT_MARKER } = require(resolve('src/sillytavern-extension/schemaPromptTransport.ts'));
const { createProviderSafeJsonSchema } = require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));
const { createInitialDraftJsonSchema } = require(resolve('src/game-core/initialDraftSchema.ts'));
const { createTowerInitialContentJsonSchema, createTowerNodeJsonSchema, createTowerNodeBatchJsonSchema, createTowerInitialSlotRepairJsonSchema } = require(resolve('src/game-core/towerRequest.ts'));

// Independently expand only the generated reference values. Exact round-trip
// equality proves that no constraint, literal value or property disappeared.
function restore(document) {
  const { $defs, ...root } = document;
  const expand = value => {
    if (Array.isArray(value)) return value.map(expand);
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1 && /^#\/\$defs\/S\d+$/.test(value.$ref || '')) {
      return expand($defs[value.$ref.split('/').at(-1)]);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
  };
  return expand(root);
}
const sourceSchemas = [
  createTowerInitialContentJsonSchema(),
  createInitialDraftJsonSchema({ includeNarrative: false }),
  createTowerNodeJsonSchema('battle', { nodeId: 'node_a', act: 1, floor: 1 }),
  createTowerInitialSlotRepairJsonSchema([{
    token: 'r0', slots: [
      { token: 's0', kind: 'status_trigger_effect_item', action: 'replace_effect' },
      { token: 's1', kind: 'status_hold_effect_item', action: 'replace_effect' },
    ],
  }]),
];
for (const source of sourceSchemas) {
  const schema = createProviderSafeJsonSchema(source).value;
  const before = structuredClone(schema);
  const shared = shareSchemaPromptDefinitions(schema);
  assert.deepEqual(restore(shared), schema, `${source.name}: lossless schema round trip`);
  assert.deepEqual(schema, before, 'sharing does not mutate the canonical provider contract');
  assert.deepEqual(shareSchemaPromptDefinitions(schema), shared, 'sharing is deterministic');
}

const repeated = { type: 'object', additionalProperties: false, required: ['name', 'count'], properties: {
  name: { type: 'string', minLength: 1 }, count: { type: 'integer', minimum: 1, maximum: 100 },
} };
const sample = { type: 'object', additionalProperties: false, required: ['a', 'b'], properties: {
  a: repeated, b: repeated,
  literal: { const: { type: 'object', properties: repeated } },
  enumLiteral: { enum: [{ type: 'object', properties: repeated }] },
} };
const ajv = new Ajv2020({ strict: false });
const originalValidator = ajv.compile(sample);
const shared = shareSchemaPromptDefinitions(sample);
const sharedValidator = ajv.compile(shared);
assert.deepEqual(shared.properties.literal, sample.properties.literal, 'const object is instance data, not a schema');
assert.deepEqual(shared.properties.enumLiteral, sample.properties.enumLiteral);
for (const value of [
  { a: { name: 'a', count: 1 }, b: { name: 'b', count: 100 } },
  { a: { name: '', count: 0 }, b: { name: 'b', count: 1 } },
  { a: { name: 'a', count: 101 }, b: { name: 'b', count: 1 } },
  { a: { name: 'a', count: 1 } },
  { a: { name: 'a', count: 1, extra: true }, b: { name: 'b', count: 1 } },
]) assert.equal(sharedValidator(value), originalValidator(value));
for (const schema of [
  { $id: 'https://example.test/schema', ...sample },
  { $defs: { A: repeated }, type: 'object', properties: { a: { $ref: '#/$defs/A' } } },
]) assert.deepEqual(shareSchemaPromptDefinitions(schema), schema, 'existing reference scopes are not relocated');

const transportSchema = createProviderSafeJsonSchema(sourceSchemas[0]);
const request = {
  chat_completion_source: 'deepseek',
  messages: [
    { role: 'system', content: 'MWG_TOWER_STRUCTURED_REQUEST:sample' },
    { role: 'user', content: '根据剧情生成开局。' },
  ],
  json_schema: transportSchema,
  temperature: 0.83, top_p: 0.95, max_tokens: 20000, stream: true,
  include_reasoning: true, reasoning_effort: 'high',
};
const before = structuredClone(request);
const measurement = applySchemaPromptTransport(request);
assert.ok(measurement);
assert.ok(measurement.sharedSchemaCharacters < measurement.originalSchemaCharacters * 0.15, 'remove at least 85% of the expanded schema text');
assert.equal(request.json_schema.value.type, 'object', 'retain SillyTavern JSON mode');
assert.equal('$ref' in request.json_schema.value, false, 'no recursive refs reach Tavern schema flattening');
assert.deepEqual(request.messages.slice(0, -1), before.messages, 'all original prompts remain intact');
assert.ok(request.messages.at(-1).content.startsWith(SCHEMA_PROMPT_MARKER));
const transportedDocument = JSON.parse(request.messages.at(-1).content.split('\n').at(-1));
assert.deepEqual(restore(transportedDocument), before.json_schema.value);
for (const key of ['temperature', 'top_p', 'max_tokens', 'stream', 'include_reasoning', 'reasoning_effort']) {
  assert.deepEqual(request[key], before[key], `preserve ${key}`);
}
const after = structuredClone(request);
assert.equal(applySchemaPromptTransport(request), null, 'duplicate request events are idempotent');
assert.deepEqual(request, after);
for (const patch of [
  { chat_completion_source: 'openai' },
  { chat_completion_source: 'custom' },
  { messages: [{ role: 'user', content: 'MWG_TOWER_STRUCTURED_REQUEST:forged' }] },
  { messages: [{ role: 'system', content: '正常 preset 剧情或 MVU UpdateVariable' }] },
  { json_schema: { name: 'unrelated_request', value: transportSchema.value } },
  { json_schema: { name: 'mwg_tower_initial_slot_repair', value: transportSchema.value } },
]) {
  const unrelated = { ...structuredClone(before), ...patch };
  const unchanged = structuredClone(unrelated);
  assert.equal(applySchemaPromptTransport(unrelated), null);
  assert.deepEqual(unrelated, unchanged);
}
console.log(JSON.stringify({ schemaPromptTransport: 'passed', ...measurement }));

// Use actual schema factory names. Node fallbacks preserve the exact JSON
// schema but omit indentation; existing initial/opening transport is unchanged.
for (const name of ['initial_draft', 'node_batch', 'opening', 'battle', 'elite', 'boss', 'event', 'shop', 'treasure', 'rest']) {
  const original = {
    chat_completion_source: 'deepseek', messages: [
      { role: 'system', content: 'MWG_TOWER_STRUCTURED_REQUEST:second-attempt' },
      { role: 'user', content: '完整剧情与规则，禁止省略' },
    ],
    json_schema: name === 'initial_draft' ? createProviderSafeJsonSchema(createInitialDraftJsonSchema({ includeNarrative: false }))
      : name === 'event' ? createProviderSafeJsonSchema(createTowerNodeJsonSchema('event'))
      : { name: `mwg_tower_${name}_result`, value: { type: 'object', required: ['spec'], properties: { spec: { const: name } }, additionalProperties: false } },
    model: 'deepseek-v4-flash', stream: false, temperature: 0.9, max_tokens: 65535,
    top_p: 0.93, include_reasoning: true, reasoning_effort: 'high', stop: ['EXPLICIT_STOP'],
  };
  const before = structuredClone(original);
  const message = createEmptyJsonModeFallbackMessage(original.json_schema, original.chat_completion_source);
  const nodeFallback = !['initial_draft', 'opening'].includes(name);
  assert.deepEqual(message, { role: 'user', content: `JSON schema for the response:\n${JSON.stringify(original.json_schema.value, null, nodeFallback ? undefined : 4)}` });
  assert.deepEqual(JSON.parse(message.content.slice('JSON schema for the response:\n'.length)), original.json_schema.value);
  assert.deepEqual(original, before, 'schema and native request remain immutable');
}
{
  const schema = { name: 'mwg_tower_node_batch_result', value: {
    type: 'object', required: ['text'], properties: { text: { const: 'two  spaces\n  indentation inside a literal' } },
    additionalProperties: false,
  } };
  const before = structuredClone(schema);
  const message = createEmptyJsonModeFallbackMessage(schema, 'deepseek');
  assert.deepEqual(JSON.parse(message.content.slice('JSON schema for the response:\n'.length)), schema.value,
    'literal whitespace must not be stripped along with schema formatting');
  assert.deepEqual(schema, before);
}
for (const provider of ['openai', 'custom', 'claude', 'deepseek']) {
  const request = { chat_completion_source: provider,
    messages: [{ role: 'system', content: 'MWG_TOWER_STRUCTURED_REQUEST:g:empty-json-fallback' }],
    json_schema: { name: provider === 'deepseek' ? 'mwg_initial_draft_registry_repair' : 'mwg_initial_draft', value: { type: 'object' } },
  };
  const expected = structuredClone(request);
  assert.equal(createEmptyJsonModeFallbackMessage(request.json_schema, provider), null);
  assert.deepEqual(request, expected);
}
for (const invalid of [null, undefined, {}, { name: 'unrelated', value: {} }, { name: 'mwg_tower_event_result', value: null }]) {
  assert.equal(createEmptyJsonModeFallbackMessage(invalid, 'deepseek'), null);
}
// Exercise the actual provider projection for both a single event batch and a
// mixed reachable window; synthetic names alone cannot catch factory drift.
for (const kinds of [['event'], ['battle', 'event', 'rest']]) {
  const jobs = kinds.map((kind, index) => ({
    nodeId: `act-1-floor-${index + 4}-col-0`, requestId: `compact_${index}`,
    basedOnRevision: 7, kind, act: 1, floor: index + 4,
    contentSeed: 11 + index, rewardSeed: 21 + index, difficultyMultiplier: 1,
  }));
  const canonical = createTowerNodeBatchJsonSchema('compact_batch', jobs);
  const canonicalBefore = structuredClone(canonical);
  const schema = createProviderSafeJsonSchema(canonical);
  const before = structuredClone(schema);
  const prefix = 'JSON schema for the response:\n';
  const message = createEmptyJsonModeFallbackMessage(schema, 'deepseek');
  assert.equal(schema.name, 'mwg_tower_node_batch_result');
  assert.equal(message.role, 'user');
  assert.equal(message.content, prefix + JSON.stringify(schema.value));
  assert.deepEqual(JSON.parse(message.content.slice(prefix.length)), schema.value,
    'actual node-batch fallback preserves every projected constraint');
  const prettyLength = (prefix + JSON.stringify(schema.value, null, 4)).length;
  assert.ok(message.content.length < prettyLength, 'actual node-batch fallback removes redundant indentation');
  assert.deepEqual(schema, before, 'fallback must not mutate provider schema');
  assert.deepEqual(canonical, canonicalBefore, 'projection must not mutate canonical schema');
  console.log(JSON.stringify({actualNodeBatchKinds: kinds, prettyCharacters: prettyLength,
    compactCharacters: message.content.length, exactRoundTrip: true}));
}
console.log('Bounded empty-final JSON-mode transport tests passed.');
