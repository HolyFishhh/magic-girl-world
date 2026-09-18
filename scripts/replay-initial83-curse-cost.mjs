import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {normalizeInitialDraftAbsentCurseCost:normalize}=require('../src/sillytavern-extension/initialDraftDecoding.ts');
const {parseStructuredRecord}=require('../src/sillytavern-extension/structuredRecord.ts');
const {inspectInitialDraft}=require('../src/game-core/initialDraft.ts');
const {createContentPackFromMvuBattle}=require('../src/runtime/contentPackAdapter.ts');
const {assessInitialPlayerContent}=require('../src/game-core/playerContentReadiness.ts');
const {collectRewardCandidateTypedContractIssues}=require('../src/game-core/rewardCandidateValidation.ts');
const file=new URL('../tmp/initial83-final-browser-v168.json',import.meta.url);
const bytes=readFileSync(file),capture=JSON.parse(bytes);
const get=stage=>{const e=capture.evidence.find(e=>e.stage===stage);assert.ok(e&&!e.truncated);return parseStructuredRecord(e.text);};
const raw=get('provider-final'),draft=get('normalized-draft');
assert.equal(raw.registry.templates[0].type,'Curse');
assert.equal(raw.registry.templates[0].cost,null);
assert.equal(draft.registry.templates[0].cost,null);
const original=structuredClone(draft),expected=structuredClone(draft);
delete expected.registry.templates[0].cost;
const normalized=normalize(draft);
assert.deepEqual(normalized,expected,'only the observed null field is removed');
assert.deepEqual(draft,original);
function inspect(value) {
 return inspectInitialDraft(value,preview=>{
  const issues=[...assessInitialPlayerContent(createContentPackFromMvuBattle(preview.player)).issues];
  for(const choice of preview.opening.choices)for(const category of ['cards','artifacts','items'])
   for(const candidate of choice.outcome?.reward?.[category]??[])
    issues.push(...collectRewardCandidateTypedContractIssues(category,candidate,{statusDefinitions:preview.player.statuses}));
  return issues;
 });
}
const before=inspect(draft),after=inspect(normalized);
assert.ok(before.inspected&&before.rules.length>0,'reproduce original rejection');
assert.ok(before.rules.every(issue=>issue.path.endsWith('.cost')),'no unrelated failure masked');
assert.ok(after.inspected);
assert.deepEqual(after.references,[]);
assert.deepEqual(after.rules,[]);
const zero=structuredClone(normalized);zero.registry.templates[0].cost=0;
assert.ok(inspect(normalize(zero)).rules.length>0,'real authored cost remains rejected');
assert.deepEqual(readFileSync(file),bytes,'retained evidence untouched');
console.log(JSON.stringify({result:'PASS',sample:83,sha256:createHash('sha256').update(bytes).digest('hex'),
 beforeIssues:before.rules,afterIssues:after.rules,changedPath:'registry.templates[0].cost',
 scope:'Offline reference/player/reward validation only. No new provider call, installation, gameplay or acceptance result.'},null,2));
