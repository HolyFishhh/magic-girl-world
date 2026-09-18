import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const cliSource = await readFile(new URL('./report-tower-schema-experiment.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(cliSource, /finalUsable:/, 'in-memory harness completion cannot be labelled final usable');
const { projectSchemaExperimentRecord, summarizeSchemaExperiment } = await import('./lib/tower-schema-experiment-report.mjs');
const since = '2026-09-01T00:00:00Z';
const secret = 'DO_NOT_EXPORT_RAW_MODEL_OR_SECRET';
const base = { spec:'mwg.real-tavern-tower-mechanism-acceptance/v1', startedAt:since, completedAt:'2026-09-01T00:01:00Z',
  model:'test-model', preset:'test-preset', scenarioId:'test-scenario', schemaTransport:'shared',
  summary:{successful:true}, calls:[{kind:'initial_authoring', elapsedMs:100, response:secret, reasoning:secret,
    rawTransport:JSON.stringify({usage:{prompt_tokens:30,completion_tokens:40}, secret}),
    requestBody:{messages:[{content:secret}]}}], monitor:{structured:[{detail:secret}]} };
const project = data => projectSchemaExperimentRecord('sample.json', data, since);
const row = project(base).record;
assert.equal(row.workflowCompleted,true);
assert.equal(row.workflowCompletedWithoutRepair,true);
assert.equal(row.promptTokens,30);
assert.equal(row.promptCharacters,secret.length);
assert.equal(JSON.stringify(row).includes(secret),false);
assert.equal(row.codeRevisionEvidence,'missing');
const repaired = structuredClone(base);repaired.calls.push({kind:'initial_repair'});
assert.equal(project(repaired).record.workflowCompletedWithoutRepair,false);
assert.equal(project(repaired).record.repairCalls,1);
const failed = structuredClone(base);failed.summary={successful:false,error:'SyntaxError: '+secret+' 修复拒绝'};
assert.equal(project(failed).record.failureCategory,'repair_rejected');
assert.equal(JSON.stringify(project(failed)).includes(secret),false);
for (const mutate of [d=>d.replayInitialFrom='original.json',d=>d.calls[0].replayed=true,d=>d.summary.replayedModelResponses=1]) {
  const data=structuredClone(base);mutate(data);assert.equal(project(data).reason,'replay');
}
for (const [mutate,reason] of [
  [d=>d.startedAt='not-a-date','invalid_time'], [d=>d.completedAt='not-a-date','invalid_time'],
  [d=>d.completedAt='2026-08-01','invalid_time'], [d=>d.startedAt='2026-08-01','before_window'],
  [d=>delete d.completedAt,'incomplete'],[d=>d.summary.successful='true','invalid_summary'],
  [d=>d.calls=[],'no_model_attempt'],[d=>d.spec='different-report','unsupported_spec'],
  [d=>d.executionScope='live_browser','unsupported_scope'],[d=>d.schemaTransport='other','unsupported_transport'],
]) { const data=structuredClone(base);mutate(data);assert.equal(project(data).reason,reason); }
const invalidMetrics=structuredClone(base);invalidMetrics.calls[0].rawTransport=JSON.stringify({usage:{prompt_tokens:-1,completion_tokens:'40'}});
invalidMetrics.calls[0].elapsedMs=-1;
assert.equal(project(invalidMetrics).record.promptTokens,undefined);
assert.equal(project(invalidMetrics).record.completionTokens,undefined);
assert.equal(project(invalidMetrics).record.firstCallMs,undefined);
const report=summarizeSchemaExperiment([row,project(repaired).record,project(failed).record],{since,generatedAt:since,skipped:{replay:3}});
assert.equal(report.modes.shared.trials,3);
assert.equal(report.modes.shared.workflowCompletions,2);
assert.equal(report.modes.shared.workflowCompletionsWithoutRepair,1);
assert.equal(report.modes.shared.workflowCompletionsAfterRepair,1);
assert.match(report.metricDefinitions.workflowCompletionsWithoutRepair, /does not prove retry-free/);
assert.match(report.metricDefinitions.repairCalls, /kind.*repair/);
// Repeated authoring calls are not content repairs; that metric must never
// be presented as proof of a single model attempt or retry-free narrative.
const repeatedAuthoring = structuredClone(base);
repeatedAuthoring.calls.push({kind:'initial_authoring', elapsedMs:120, attempt:2});
assert.equal(project(repeatedAuthoring).record.workflowCompletedWithoutRepair,true);
assert.equal(project(repeatedAuthoring).record.repairCalls,0);
assert.equal(report.evidenceScope,'real-model-in-memory-host');
assert.equal(report.overallUsability,'unproven');
assert.equal(report.currentVersionReliability,'unproven');
assert.deepEqual(report.proves,{nativeHelper:false,presetNarrative:false,liveChatPublication:false,liveBattle:false,liveSaveReload:false,semanticUsability:false});
assert.equal(report.modes.shared.finalUsable,undefined);
assert.equal(report.records.some(x=>'error' in x||'firstDiagnostics' in x),false);
assert.equal(JSON.stringify(report).includes(secret),false);
assert.throws(()=>projectSchemaExperimentRecord('x',base,'not-a-date'),/since/);
console.log('PASS schema experiment reporting: model-backed memory-host completion only; no live/semantic/current-version claims, strict dates/replay filtering, safe scalar metadata and explicit failures.');
