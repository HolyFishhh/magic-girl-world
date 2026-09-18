import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {compileInitialDraftToMvu,inspectInitialDraft}=require('../src/game-core/initialDraft.ts');
for(const malformed of ['player','opening']){
  const draft={spec:'mwg.initial-draft/v1',narrative:'unchanged',player:{core:{},cards:[]},opening:{choices:[]},
    registry:{statuses:[{id:'same'},{id:'same'}],templates:[],resources:[{id:'charge',name:'charge',emoji:'x',max:-1,start:1,refresh:'retain'}]}};
  draft[malformed]=null;
  const before=structuredClone(draft),result=compileInitialDraftToMvu(draft);
  assert.equal(result.ok,false);
  assert.ok(result.diagnostics.some(d=>d.code==='INVALID_DRAFT'&&d.path[0]===malformed));
  assert.ok(result.diagnostics.some(d=>d.code==='DUPLICATE_DEFINITION'));
  assert.ok(result.diagnostics.some(d=>d.code==='INVALID_REGISTRY'&&d.path.join('.')==='registry.resources.0.max'));
  let inspected=false;
  const inspection=inspectInitialDraft(draft,()=>{inspected=true;return [];});
  assert.equal(inspected,false,'invalid envelope never reaches compiled preview');
  assert.equal(inspection.inspected,false);
  assert.deepEqual(inspection.references,result.diagnostics);
  assert.deepEqual(draft,before,'no placeholders or source mutations');
}
for(const value of [null,[],{}, {spec:'mwg.initial-draft/v1',registry:null}]){
  assert.doesNotThrow(()=>compileInitialDraftToMvu(value));
  assert.equal(compileInitialDraftToMvu(value).ok,false);
}
const valid={spec:'mwg.initial-draft/v1',narrative:'locked',player:{core:{},cards:[
  {id:'card',effects:[{apply_status:'missing_card_status'},{add_card:'missing_template'},{resource:{id:'missing_resource',amount:1}}]},
]},opening:{choices:[{id:'gift',outcome:{reward:{cards:[{id:'gift_card',effects:{apply_status:'missing_reward_status'}}]}}}]},
registry:{statuses:[],resources:[],templates:[]}};
for(const broken of ['opening','player','core','cards']){
  const draft=structuredClone(valid);
  if(broken==='core'||broken==='cards')draft.player[broken]=null;else draft[broken]=null;
  const before=structuredClone(draft);let previews=0;
  const report=inspectInitialDraft(draft,()=>{previews++;return [];});
  assert.equal(previews,0);assert.equal(report.inspected,false);
  const ids=report.references.map(d=>d.ref).filter(Boolean);
  if(broken==='opening'||broken==='core')for(const id of ['missing_card_status','missing_template','missing_resource'])assert.ok(ids.includes(id),`${broken}: ${id}`);
  if(broken!=='opening')assert.ok(ids.includes('missing_reward_status'),`${broken}: reward independent`);
  assert.deepEqual(draft,before,'partial diagnostic traversal never changes raw owners');
}
const unavailable=structuredClone(valid);unavailable.player.cards=null;
unavailable.opening.choices[0].outcome.reward.cards=[{card_ref:'card',quantity:1}];
const unavailableResult=compileInitialDraftToMvu(unavailable);
assert.ok(unavailableResult.diagnostics.some(d=>d.code==='INVALID_DRAFT'));
assert.equal(unavailableResult.diagnostics.some(d=>d.path.at(-1)==='card_ref'),false,'unavailable card collection is not proof of a missing ID');
console.log('PASS invalid containers do not hide independent card/reward references; unavailable dependencies are not fabricated and partial previews stay private.');
console.log('PASS independent registry diagnostics survive invalid envelopes; no preview, mutation or acceptance shortcut.');
