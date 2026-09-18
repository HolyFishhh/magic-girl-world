import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets:plan,parseTowerInitialSlotRepairResponse:parse,mergeTowerInitialSlotRepair:merge}=require('../src/sillytavern-extension/controller.ts');
for(const array of [false,true]){
 const effect={add_card:'leaf',to:'self',count:2,when:'self.hp > 0'};
 const status={id:'binding',name:'Binding',emoji:'📘',type:'buff',description:'Create two leaves in hand when healthy.',
  triggers:{turn_start:array?[{block:1},effect]:effect},creates:[{id:'leaf',name:'Leaf',type:'Skill',rarity:'Common',cost:0,effects:{block:2},exhaust:true}]};
 const source={player:{statuses:[status]}},before=structuredClone(source);
 const error=`battle.statuses[0]：状态定义不合法（具体原因：triggers.turn_start${array?'[1]':''}.to: add_card to must be hand, deck, or discard）`;
 const targets=plan(source,error);assert.equal(targets.length,1);
 assert.deepEqual(targets[0].slots.map(s=>s.kind).sort(),['add_card_destination','description']);
 const slots=Object.fromEntries(targets[0].slots.map(s=>[s.token,{action:s.action,value:s.kind==='description'?status.description:'hand'}]));
 const reply={spec:'mwg.tower-initial-slot-repair/v1',roots:{[targets[0].token]:{slots}},support_statuses:[],support_resources:[]};
 const repaired=merge(source,targets,parse(reply,targets));
 const expected=structuredClone(source);const trigger=expected.player.statuses[0].triggers.turn_start;(array?trigger[1]:trigger).to='hand';
 assert.deepEqual(repaired,expected);assert.deepEqual(source,before);
 for(const invalid of ['self','enemy',null,{to:'hand'}]){
  const bad=structuredClone(reply);bad.roots[targets[0].token].slots[targets[0].slots.find(s=>s.kind==='add_card_destination').token].value=invalid;
  assert.throws(()=>parse(bad,targets));
 }
}
console.log('PASS status add_card destination opens only exact to/description leaves; template, count, condition and sibling effects preserved; invalid destinations rejected.');
