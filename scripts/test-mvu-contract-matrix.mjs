import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const readJson = async path => JSON.parse(await readFile(resolve(path), 'utf8'));
const contract = await readJson('schemas/mwg-mvu-stat-data-v1.json');
const initial = await readJson('worldbook_new/变量初始化.json');
const manifest = await readJson('worldbook_new/manifest.json');

assert.equal(contract.spec, 'mwg.mvu-stat-data/v1');
assert.equal(contract.root, 'stat_data');
assert.equal(contract.initialization, 'worldbook_new/变量初始化.json');

const allowedShapes = new Set([
  'string',
  'number',
  'array',
  'object',
  'nullable-object',
  'program-managed',
  'optional-program-fields',
]);
const allowedOwners = new Set(['ai', 'program', 'shared']);
const allowedLifecycles = new Set(['persistent', 'battle-temporary', 'candidate', 'one-shot-request', 'optional-run']);
const allowedOperations = new Set(['set', 'assign', 'remove', 'add']);
const declared = new Map();

for (const group of contract.groups) {
  assert.match(group.id, /^[a-z][a-z0-9_]*$/);
  assert.ok(Array.isArray(group.paths) && group.paths.length > 0, `${group.id} must declare paths`);
  assert.ok(allowedShapes.has(group.shape), `${group.id} has unknown shape ${group.shape}`);
  assert.ok(allowedOwners.has(group.owner), `${group.id} has unknown owner ${group.owner}`);
  assert.ok(allowedLifecycles.has(group.lifecycle), `${group.id} has unknown lifecycle ${group.lifecycle}`);
  assert.ok(Array.isArray(group.writers) && group.writers.length > 0, `${group.id} must declare writers`);
  assert.ok(Array.isArray(group.ai_operations), `${group.id} must declare ai_operations`);
  for (const operation of group.ai_operations) {
    assert.ok(allowedOperations.has(operation), `${group.id} has unknown AI operation ${operation}`);
  }
  for (const path of group.paths) {
    assert.ok(!declared.has(path), `duplicate contract path ${path}`);
    declared.set(path, { shape: group.shape, extensible: group.extensible === true, group });
  }
}

const initialized = new Map();
function visit(value, path = '') {
  if (Array.isArray(value)) {
    initialized.set(path, { shape: 'array', extensible: false });
    return;
  }
  if (value === null) {
    initialized.set(path, { shape: 'nullable-object', extensible: false });
    return;
  }
  if (value && typeof value === 'object') {
    if (value.$meta?.extensible === true) initialized.set(path, { shape: 'object', extensible: true });
    for (const [key, child] of Object.entries(value)) {
      if (key !== '$meta') visit(child, path ? `${path}.${key}` : key);
    }
    return;
  }
  initialized.set(path, { shape: typeof value, extensible: false });
}
visit(initial);

assert.deepEqual(
  [...declared.keys()].filter(path => !path.includes('[]')).sort(),
  [...initialized.keys()].sort(),
  'every initialized MUV leaf/extensible object must have exactly one contract entry',
);
for (const [path, expected] of initialized) {
  const actual = declared.get(path);
  if (actual.shape !== 'program-managed') {
    assert.equal(actual.shape, expected.shape, `${path} shape drifted from initialization`);
    assert.equal(actual.extensible, expected.extensible, `${path} extensibility drifted from initialization`);
  }
}

const promptSources = await Promise.all(
  Object.values(manifest).map(source => readFile(resolve('worldbook_new', source), 'utf8')),
);
const prompts = promptSources.join('\n');
const obsoletePromptPatterns = [
  /status\.location_weather/,
  /status\.title\b/,
  /status\.clothing\.undergarments/,
  /battle\.core\.(?:energy|draw_count|block|level)\b/,
  /battle\.enemy\.(?:maxHp|maxLust|lustEffect|actionMode|actionConfig)\b/,
  /battle\.items[^\n]*\bquantity\b/,
];
for (const pattern of obsoletePromptPatterns) {
  assert.doesNotMatch(prompts, pattern, `world-book still contains removed MUV field ${pattern}`);
}

const adapterPaths = [
  'src/common/statusAdapter.ts',
  'src/fish/core/mvuBattleAdapter.ts',
  'src/fish/core/battleDataContract.ts',
  'src/runtime/battleSettlementAdapter.ts',
  'scripts/lib/battle-snapshot-report.mjs',
];
const adapterSources = (await Promise.all(adapterPaths.map(path => readFile(resolve(path), 'utf8')))).join('\n');
for (const removedName of ['location_weather', 'undergarments', 'source.maxHp', 'source.maxLust', 'source.lustEffect', 'source.actionMode', 'source.actionConfig']) {
  assert.ok(!adapterSources.includes(removedName), `adapter boundary still reads removed field ${removedName}`);
}

const mvuArraySource = await readFile(resolve('src/runtime/mvuArrays.ts'), 'utf8');
const runStateAdapterSource = await readFile(resolve('src/runtime/runStateAdapter.ts'), 'utf8');
assert.doesNotMatch(mvuArraySource, /'\[\]'|new Set/, 'current MUV arrays must recognize only the canonical schema marker');
assert.doesNotMatch(runStateAdapterSource, /\.flat\(/, 'run seed derivation must not flatten legacy nested MUV arrays');
assert.match(runStateAdapterSource, /flattenMvuArray<.*>\(stat\.battle\?\.cards, \{ objectsOnly: true \}\)/);

assert.deepEqual(declared.get('run').group.ai_operations, [], 'AI must not mutate program-owned run state');
assert.equal(declared.get('run').group.owner, 'program');
assert.deepEqual(
  declared.get('battle.design_context').group.ai_operations,
  [],
  'AI must not mutate program-owned content design context',
);
assert.equal(declared.get('battle.design_context').group.owner, 'program');
assert.deepEqual(
  declared.get('battle.cards[].$meta.mwg_card_progression').group.ai_operations,
  [],
  'AI must not mutate persistent card progression metadata',
);
assert.equal(declared.get('battle.cards[].$meta.mwg_card_progression').group.owner, 'program');
assert.deepEqual(declared.get('run_trigger_invocations').group.ai_operations, []);
assert.equal(declared.get('run_trigger_invocations').group.owner, 'program');
assert.deepEqual(declared.get('run_trigger_counters.total').group.ai_operations, []);
assert.equal(declared.get('battle.core.energy'), undefined, 'energy belongs to BattleState, not MUV');
assert.equal(declared.get('battle.core.block'), undefined, 'block belongs to BattleState, not MUV');
assert.ok(contract.legacy.every(entry =>
  entry.policy === 'removed' || entry.policy === 'runtime-only' || entry.policy === 'program-migrated'));

console.log(`MUV contract covers ${declared.size} canonical paths and rejects removed storage fields.`);
