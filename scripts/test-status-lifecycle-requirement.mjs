import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const {inspectInitialRequirementCandidates:inspect}=require('../src/game-core/initialRequirementCoverage.ts');
const {resolveStatusApplication}=require('../src/game-core/statusApplication.ts');
const path='tmp/initial142-final-browser-v249.json',bytes=readFileSync(path),sample=JSON.parse(bytes);
const draft=JSON.parse(sample.evidence.find(e=>e.stage==='normalized-draft').text),before=structuredClone(draft);
const probes=['apply','stack'].map(lifecycle=>({id:lifecycle,kind:'status_lifecycle',actor:'player',statusId:'ink_stain',lifecycle}));
const result=inspect(draft,probes);
assert.deepEqual(result.results.map(r=>r.status),['missing_candidate','candidate_present_unverified']);
assert.equal(result.overallVerified,false);
const variant=structuredClone(draft);variant.registry.statuses[0].triggers.apply={block:1};
assert.equal(inspect(variant,probes).results[0].status,'missing_candidate','another status apply is not the requested identity');
for(const patch of [{statusId:undefined},{lifecycle:'turn_start'},{actor:'opponent'}]){
 const r=inspect(draft,[{...probes[0],...patch}]).results[0];assert.notEqual(r.status,'candidate_present_unverified');
}
assert.deepEqual(resolveStatusApplication(undefined,2,6),{nextStacks:2,trigger:'apply'});
assert.deepEqual(resolveStatusApplication(2,2,6),{nextStacks:4,trigger:'stack'});
assert.deepEqual(resolveStatusApplication(6,2,6),{nextStacks:6,trigger:null});
assert.deepEqual(resolveStatusApplication(2,0,6),{nextStacks:2,trigger:null});
assert.deepEqual(draft,before);assert.deepEqual(readFileSync(path),bytes);
console.log('PASS real142 missing local apply distinguished from stack and other identities; no mutation or broad semantic verdict; lifecycle contract matches runtime first/stack/cap/zero transitions.');
