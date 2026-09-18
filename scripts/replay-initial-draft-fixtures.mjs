import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { canonicalInitialFixtureToDraft } from './lib/initial-draft-fixture.mjs';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { compileInitialDraftToMvu } = require(resolve('src/game-core/initialDraft.ts'));
const { createTowerInitialContentJsonSchema } = require(resolve('src/game-core/towerRequest.ts'));
const { normalizeMvuPlayerAuthoredContent } = require(resolve('src/runtime/mvuBattleContentNormalizer.ts'));
const ajv = new Ajv2020({ strict: false, inlineRefs: false });
const validate = ajv.compile(createTowerInitialContentJsonSchema().value);
const reportPath = process.argv[2] || 'tmp/tower-schema-experiment-2026-09-05.json';
const source = JSON.parse(await readFile(resolve(reportPath), 'utf8'));
const records = [];
for (const row of source.records) {
  const record = { file: row.file, sourceDirect: row.direct };
  records.push(record);
  const evidence = JSON.parse(await readFile(resolve('tmp/real-tavern-tower-acceptance', row.file), 'utf8'));
  let initial;
  try { initial = JSON.parse(evidence.calls.find(call => call.kind === 'initial_authoring').response); }
  catch { record.stage = 'json_parse'; continue; }
  record.originalSchemaValid = validate(initial);
  // Existing reduced-output compatibility runs before the registry boundary.
  // Use the same established normalizer, never invent a fixture-only repair.
  initial.player = normalizeMvuPlayerAuthoredContent(initial.player);
  initial.opening = normalizeMvuPlayerAuthoredContent(initial.opening);
  record.normalizedOriginalSchemaValid = validate(initial);
  const lifted = canonicalInitialFixtureToDraft(initial);
  if (!lifted.ok) { record.stage = 'fixture_conflict'; record.diagnostics = lifted.errors; continue; }
  const compiled = compileInitialDraftToMvu(lifted.draft);
  if (!compiled.ok) { record.stage = 'compile_diagnostics'; record.diagnostics = compiled.diagnostics; continue; }
  record.compiledSchemaValid = validate(compiled.value);
  record.stage = 'compiled';
  if (!record.compiledSchemaValid) record.schemaErrors = structuredClone(validate.errors).slice(0, 5);
}
const summary = { offlineOnly: true, modelCalls: 0, fixtures: records.length,
  compiled: records.filter(r => r.stage === 'compiled').length,
  typedDiagnosticFixtures: records.filter(r => r.stage === 'compile_diagnostics').length,
  fixtureConflicts: records.filter(r => r.stage === 'fixture_conflict').length,
  compiledSchemaValid: records.filter(r => r.compiledSchemaValid).length,
  note: 'Offline representation/reference replay. Not fresh generation, full readiness, semantic or gameplay acceptance.' };
const output = { source: reportPath, generatedAt: new Date().toISOString(), summary, records };
if (process.argv[3]) await writeFile(resolve(process.argv[3]), JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify(output, null, 2));
