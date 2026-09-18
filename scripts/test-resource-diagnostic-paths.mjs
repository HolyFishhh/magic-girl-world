import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {validateCombatResourceDefinitions}=require('../src/game-core/combatResource.ts');
const {compileInitialDraftToMvu,INITIAL_DRAFT_SPEC}=require('../src/game-core/initialDraft.ts');
const valid={id:'charge',name:'充能',emoji:'⚡',max:5,start:0,refresh:'retain'};
for(const value of [null,Array(17).fill(valid),[null],[{...valid,id:'energy',name:'',emoji:'',max:0,start:-1,current:99,refresh:'other'}],
 [{...valid,description:42,'nested[0].when':'not a path'}],[valid,valid]]){
  const input=JSON.stringify(value),located=[];
  const plain=validateCombatResourceDefinitions(value);
  const detailed=validateCombatResourceDefinitions(value,'resources',(issue,path)=>located.push({issue,path:[...path]}));
  assert.deepEqual(detailed,plain,'existing display API must not change');
  assert.deepEqual(located.map(x=>x.issue),plain,'every error has a location');
  assert.equal(JSON.stringify(value),input,'validation must not edit authored data');
  for(const {path}of located){
    assert.ok(path.length<=2);
    if(path.length)assert.equal(typeof path[0],'number');
  }
}
const resources=[{...valid,description:42,'nested[0].when':'literal key'}];
const draft={spec:INITIAL_DRAFT_SPEC,narrative:'原剧情',player:{core:{},cards:[]},opening:{choices:[]},registry:{resources,statuses:[],templates:[]}};
const result=compileInitialDraftToMvu(draft);
assert.equal(result.ok,false);
const issues=result.diagnostics.filter(x=>x.code==='INVALID_REGISTRY');
assert.deepEqual(issues.map(x=>x.path),[
 ['registry','resources',0,'nested[0].when'],['registry','resources',0,'description'],
]);
assert.deepEqual(issues.map(x=>x.owner),[['registry','resources',0],['registry','resources',0]]);
console.log('PASS authoritative resource diagnostics retain exact typed locations, literal hostile keys, complete error coverage and unchanged display/data.');
