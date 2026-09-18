import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {collectInitialDraftEnvelopeIssues,initialDraftAuthorEnvelopeContract,INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS}=require('../src/game-core/initialDraftEnvelope.ts');
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {initialDraftAuthoringPrompt}=require('../src/sillytavern-extension/initialDraftPrompt.ts');
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const oldAccept=x=>record(x)&&x.spec==='mwg.initial-draft/v1'&&typeof x.narrative==='string'&&record(x.player)&&record(x.player.core)&&Array.isArray(x.player.cards)&&record(x.opening)&&Array.isArray(x.opening.choices)&&record(x.registry);
const valid={spec:'mwg.initial-draft/v1',narrative:'preset',player:{core:{},cards:[]},opening:{choices:[]},registry:{}};
let checks=0;
for(const path of ['spec','narrative','player','player.core','player.cards','opening','opening.choices','registry']) {
 for(const replacement of [undefined,null,false,0,'',[],{}]) {
  const value=structuredClone(valid),parts=path.split('.');let parent=value;
  for(const part of parts.slice(0,-1))parent=parent[part];parent[parts.at(-1)]=replacement;
  const before=structuredClone(value);
  assert.equal(collectInitialDraftEnvelopeIssues(value).length===0,oldAccept(value),path);
  assert.deepEqual(value,before);checks++;
 }
}
const missing={...valid,player:{},opening:null};delete missing.registry;
assert.deepEqual(collectInitialDraftEnvelopeIssues(missing).map(x=>x.path.join('.')),['player.core','player.cards','opening','registry']);
assert.deepEqual(compileInitialDraftToMvu(missing).diagnostics.map(x=>x.path.join('.')),['player.core','player.cards','opening','registry']);
assert.deepEqual([...createInitialDraftJsonSchema({includeNarrative:false}).value.required].sort(),[...INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS].sort());
for(const key of INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS)assert.ok(initialDraftAuthorEnvelopeContract().includes(key));
const prompt=initialDraftAuthoringPrompt({startPrompt:'request',config:{},narrative:'story',currentStat:{},designGuidance:null});
assert.ok(prompt.indexOf('START_REQUEST=')>prompt.indexOf(initialDraftAuthorEnvelopeContract()),'concrete task follows structural reference');
assert.ok(prompt.indexOf('REQUESTED_CARD_DESIGN=')>prompt.indexOf('[完整玩法语义与执行契约]'),'requirements follow operation reference');
assert.ok(prompt.indexOf('[提交前核对实际玩法]')>prompt.indexOf('[完整玩法语义与执行契约]'),'one coverage check follows reference');
for(const key of ['START_REQUEST=','PLAYER_CONFIG=','ESTABLISHED_NARRATIVE=','REQUESTED_CARD_DESIGN=','REQUESTED_TOWER_RULES='])assert.equal(prompt.split(key).length,2,`${key} task field occurs once`);
assert.equal(prompt.split(initialDraftAuthorEnvelopeContract()).length,2,'single generated structural index');
if(process.argv.includes('--retained')) {
 const file='tmp/initial60-mechanism-final-v113.json',bytes=readFileSync(file);
 const value=JSON.parse(bytes).find(x=>x.value?.player).value;
 const draft={...value,spec:'mwg.initial-draft/v1',narrative:'DIAGNOSTIC ONLY; not a reconstructed story'};
 assert.deepEqual(collectInitialDraftEnvelopeIssues(draft).map(x=>x.path.join('.')),['opening','registry']);
 assert.deepEqual(readFileSync(file),bytes);
 console.log('PASS retained60 exact missing roots opening,registry; evidence unchanged');
}
console.log(`PASS ${checks} structural-boundary equivalence cases; all independent paths; schema/author root agreement; no defaults or writes`);
