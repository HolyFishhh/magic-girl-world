import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets,parseTowerInitialSlotRepairResponse,mergeTowerInitialSlotRepair}=require('../src/sillytavern-extension/controller.ts');
const {createTowerInitialSlotRepairJsonSchema,TOWER_INITIAL_SLOT_REPAIR_SPEC}=require('../src/game-core/towerRequest.ts');
const original={narrative:'原剧情不能改',status:{time:'黄昏'},player:{core:{resources:[{id:'charge',name:'充能',start:2,max:5,refresh:'retain'}]},cards:[{
  id:'charge_strike',name:'调律',type:'Attack',rarity:'Common',cost:1,quantity:3,effects:[
    {damage:6,resource:{id:'charge',amount:1},to:'self',when:'self.resource.charge.current > 0'},
    {block:5},
    {damage:8,resource:{id:'charge',amount:-2},to:'self'},
    {draw:1},
  ],
}]},opening:{title:'原馈赠',choices:[]}};
const errors=[0,2].map(i=>`battle.cards[0].effects[${i}].resource：该操作必须单独占一个 effects 数组项；battle.cards[0].effects[${i}]：Only common numeric, status, and draw effects may share one object; use separate array entries for every other operation`).join('；');
const before=structuredClone(original),targets=extractTowerInitialRepairSlotTargets(original,errors);
assert.equal(targets.length,1);
assert.deepEqual(targets[0].slots.map(s=>s.kind),['effect_item_sequence','effect_item_sequence']);
const sequence=(slot)=>Object.entries(slot.original).filter(([k])=>['damage','resource'].includes(k)).map(([key,value])=>({
  [key]:structuredClone(value),to:key==='damage'?'opponent':'self',...(slot.original.when?{when:slot.original.when}:{}),
}));
const response={spec:TOWER_INITIAL_SLOT_REPAIR_SPEC,roots:Object.fromEntries(targets.map(root=>[root.token,{slots:Object.fromEntries(root.slots.map(slot=>[slot.token,{action:slot.action,value:sequence(slot)}]))}])),support_statuses:[],support_resources:[]};
const ajv=new Ajv2020({strict:false}),validate=ajv.compile(createTowerInitialSlotRepairJsonSchema(targets).value);
assert.equal(validate(response),true,JSON.stringify(validate.errors));
const parsed=parseTowerInitialSlotRepairResponse(response,targets),result=mergeTowerInitialSlotRepair(original,targets,parsed);
assert.deepEqual(result.player.cards[0].effects,[...sequence(targets[0].slots[0]),{block:5},...sequence(targets[0].slots[1]),{draw:1}]);
assert.deepEqual({...result.player.cards[0],effects:undefined},{...original.player.cards[0],effects:undefined});
assert.deepEqual(result.opening,original.opening);assert.deepEqual(result.player.core,original.player.core);assert.equal(result.narrative,original.narrative);
assert.deepEqual(original,before);
for(const [label,mutate] of [
  ['drop resource',op=>op.value.pop()],
  ['duplicate operation',op=>op.value.push(structuredClone(op.value[0]))],
  ['change damage',op=>op.value[0].damage=0],
  ['invent hits',op=>op.value[0].hits=999],
  ['change resource id',op=>op.value[1].resource.id='other'],
  ['remove condition',op=>delete op.value[0].when],
  ['invent condition',op=>op.value[0].when='true'],
  ['not an array',op=>op.value=op.value[0]],
]){
  const bad=structuredClone(response),op=bad.roots[targets[0].token].slots[targets[0].slots[0].token];mutate(op);
  assert.throws(()=>parseTowerInitialSlotRepairResponse(bad,targets),undefined,label);
}
const unknown=structuredClone(original);unknown.player.cards[0].effects[0].spawn_summon={id:'real_summon'};
assert.deepEqual(extractTowerInitialRepairSlotTargets(unknown,errors),[],'never squeeze an unsupported operation into simple slots by deleting it');
const stale=structuredClone(original);stale.player.cards[0].effects[0].damage=99;
assert.throws(()=>mergeTowerInitialSlotRepair(stale,targets,parsed),/变化|锁定/);
assert.deepEqual(original,before);
const objectForm=structuredClone(original);objectForm.player.cards[0].effects=structuredClone(original.player.cards[0].effects[0]);
const objectTargets=extractTowerInitialRepairSlotTargets(objectForm,'battle.cards[0].effects.resource：该操作必须单独占一个 effects 数组项');
assert.equal(objectTargets[0].slots[0].kind,'effect_item_sequence');
const objectResponse={spec:TOWER_INITIAL_SLOT_REPAIR_SPEC,roots:{r0:{slots:{s0:{action:'replace_effect',value:sequence(objectTargets[0].slots[0])}}}},support_statuses:[],support_resources:[]};
const objectResult=mergeTowerInitialSlotRepair(objectForm,objectTargets,parseTowerInitialSlotRepairResponse(objectResponse,objectTargets));
assert.deepEqual(objectResult.player.cards[0].effects,sequence(objectTargets[0].slots[0]));
const genericTargets=structuredClone(objectTargets);genericTargets[0].slots[0].kind='effect_item';
const loss=structuredClone(objectResponse);loss.roots.r0.slots.s0.value={damage:6};
assert.throws(()=>parseTowerInitialSlotRepairResponse(loss,genericTargets),/删除|保留/,'legacy generic slot cannot drop the resource either');
const gifts={...structuredClone(original),opening:{choices:['a','ab','damage'].map(id=>({
  id,outcome:{reward:{cards:[{...structuredClone(original.player.cards[0]),effects:[{damage:6,hits:0}]}]}},
}))}};
const giftError='opening.choices 奖励：开局馈赠 a.cards[0] damage 无效：cards[0].effects[0].hits: hits must be an integer from 1 to 20';
const giftTargets=extractTowerInitialRepairSlotTargets(gifts,giftError);
assert.deepEqual(giftTargets.map(root=>root.path),['opening.choices[0]'],'short/prefix/prose IDs cannot select unrelated gifts');
console.log('PASS mixed effect repair: model-owned targets/order, preserved operation values and conditions, two exact splices, unchanged siblings, strict loss rejection');
