import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const {initialDraftAuthoringPrompt}=require('../src/sillytavern-extension/initialDraftPrompt.ts');
const schema=createInitialDraftJsonSchema({includeNarrative:false}).value;
assert.deepEqual(Object.keys(schema.properties),['registry','player','opening','spec']);
assert.deepEqual(schema.required,['registry','player','opening']);
const validate=new Ajv2020({strict:false,inlineRefs:false}).compile(schema);
const path='tmp/initial98-final-browser-v183.json',bytes=readFileSync(path),capture=JSON.parse(bytes);
const draft=JSON.parse(capture.evidence.find(e=>e.stage==='normalized-draft').text);
const expected=compileInitialDraftToMvu(draft);assert.equal(expected.ok,true);
for(const order of [['registry','player','opening'],['registry','opening','player'],['player','registry','opening'],['player','opening','registry'],['opening','registry','player'],['opening','player','registry']]){
 const input=Object.fromEntries(order.map(k=>[k,draft[k]]));
 assert.equal(validate(input),true,'historical legal content remains accepted in every root order');
 assert.deepEqual(compileInitialDraftToMvu({...input,spec:draft.spec,narrative:draft.narrative}),expected);
}
const prompt=initialDraftAuthoringPrompt({startPrompt:'测试',config:{},narrative:'正文',currentStat:{},designGuidance:null});
assert.match(prompt,/registry、player、opening，按此顺序先定义、再引用、最后构造奖励/);
assert.deepEqual(readFileSync(path),bytes);
console.log('PASS model schema/prompt use definition-first order; all six JSON root orders retain identical compiler output, no new fields/defaults or claim of semantic completeness.');
