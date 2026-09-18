import assert from 'node:assert/strict';
import { withDungeonPlan } from './lib/tower-plan-fixture.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {planInitialEnvelopeRepair:plan,applyInitialEnvelopeRepair:apply}=require('../src/game-core/initialEnvelopeRepair.ts');
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const {DesignAssistantController}=require('../src/sillytavern-extension/controller.ts');
const {InitialGenerationEvidence}=require('../src/sillytavern-extension/initialGenerationEvidence.ts');
const original={spec:'mwg.initial-draft/v1',narrative:'locked preset story',player:{
  status:{time:'night',location:'library',profession:{name:'scribe',ability:'record'}},
  core:{emoji:'📘',hp:60,max_hp:60,lust:0,max_lust:100},
  cards:[{id:'start',name:'start',type:'Attack',rarity:'Common',cost:1,quantity:3,effects:{damage:6,when:'self.hp > 0'}}],
},registry:{statuses:[],resources:[{id:'charge',name:'charge',emoji:'⚡',start:1,max:3,refresh:'retain'}],templates:[]},
opening:{title:'gift',narrative:'choose',choices:[1,2,3].map(n=>({id:`gift${n}`,label:`gift${n}`,outcome:{gold:n}}))}};
for(const container of [false,true]){
  const draft=structuredClone(original);draft.registry.resources[0].max=-1;
  if(container)draft.opening.choices=null;
  const before=structuredClone(draft),p=plan(draft);assert.ok(p);
  assert.ok(p.slots.some(s=>s.path.join('.')==='registry.resources.0.max'));
  assert.equal(p.slots.some(s=>s.path.join('.')==='opening.choices'),container);
  const response={replacements:Object.fromEntries(p.slots.map(s=>[s.token,s.path.reduce((v,k)=>v[k],original)]))};
  const result=apply(p,response);assert.deepEqual(result,original);assert.deepEqual(draft,before);
  assert.equal(compileInitialDraftToMvu(result).ok,true);
  const forged=structuredClone(p);forged.slots.at(-1).path=['registry','resources',0,'id'];
  assert.throws(()=>apply(forged,response));
  const malformed=structuredClone(response);
  malformed.replacements[p.slots.find(s=>s.valueType==='number').token]='3';
  assert.throws(()=>apply(p,malformed),/类型错误/);
  const calls=[];
  const host={retainInitialGenerationEvidence:()=>{},captureInitialGenerationEvidence:()=>{},captureInitialGenerationValidation:()=>{},initialGenerationEvidence:new InitialGenerationEvidence(),getSettings:()=>({}),
    towerGenerationHost:{generateNarrative:async()=>({response:withDungeonPlan(original.narrative)})},onStructuredRepairProgress:()=>{},
    structuredGenerate:async config=>{calls.push(config);if(calls.length>2)assert.fail('third invocation');
      if(calls.length===2)return structuredClone(response);
      const raw=structuredClone(draft);delete raw.narrative;return raw;},
  };
  const generated=await DesignAssistantController.prototype.generateTowerInitialRegistryContent.call(host,
    {chatId:'source-repair',messageId:0,generationId:`source-${container}`,startPrompt:'start',config:{}},{},null,()=>{});
  assert.equal(calls.length,2);assert.equal(generated.repairAvailable,false);
  assert.equal(calls[1].structured_delivery,'text-json');
  assert.equal(generated.content.player.core.resources[0].max,3);
  assert.deepEqual(generated.content.player.cards[0].effects,original.player.cards[0].effects);
  assert.equal(generated.content.narrative,original.narrative);
  assert.deepEqual(generated.content.opening,original.opening);
  const stillInvalid=structuredClone(response);
  stillInvalid.replacements[p.slots.find(s=>s.path.at(-1)==='max').token]=-1;
  let failedCalls=0;
  await assert.rejects(()=>DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
    structuredGenerate:async()=>{failedCalls++;if(failedCalls>2)assert.fail('third request after failed repair');
      if(failedCalls===2)return stillInvalid;const raw=structuredClone(draft);delete raw.narrative;return raw;},
  },{chatId:'source-repair',messageId:0,generationId:`failed-${container}`,startPrompt:'start',config:{}},{},null,()=>{}),/未写入任何变量/);
  assert.equal(failedCalls,2,'invalid repair still recompiled and stops within shared budget');
}
const mixed=structuredClone(original);mixed.registry.resources[0].max=-1;
mixed.player.cards[0].effects={apply_status:'missing',stacks:1,to:'self'};
assert.equal(plan(mixed),null,'known missing reference cannot be silently excluded from source-only plan');
// A broken envelope can now include exact missing-definition additions from
// other complete authored regions, without fabricating a compiled preview.
const partial=structuredClone(original);partial.opening.choices=null;
partial.player.cards[0].effects=[{damage:6,when:'self.hp > 0'},{apply_status:'missing',stacks:1,to:'self'},
  {add_card:'paper'},{apply_status:'missing',stacks:1,to:'self'},{resource:{id:'ink',amount:1}}];
const partialBefore=structuredClone(partial),partialPlan=plan(partial);assert.ok(partialPlan);
assert.deepEqual(partialPlan.slots.filter(s=>s.definitionId).map(s=>s.definitionId),['missing','paper','ink'],'same missing ID added only once');
const definitions={missing:{id:'missing',name:'missing',emoji:'✨',type:'buff',stacks_change:'keep',triggers:{hold:{modify:'block',add:1}}},
  paper:{id:'paper',name:'paper',type:'Attack',rarity:'Common',cost:0,effects:{damage:2}},
  ink:{id:'ink',name:'ink',emoji:'🖋️',start:0,max:3,refresh:'retain'}};
const partialResponse={replacements:Object.fromEntries(partialPlan.slots.map(s=>[s.token,
  s.definitionId?definitions[s.definitionId]:original.opening.choices]))};
const partialResult=apply(partialPlan,partialResponse);
assert.equal(compileInitialDraftToMvu(partialResult).ok,true);
assert.deepEqual(partialResult.player,partial.player);assert.deepEqual(partial,partialBefore);
for(const id of ['missing','paper','ink']){
  const bad=structuredClone(partialResponse);bad.replacements[partialPlan.slots.find(s=>s.definitionId===id).token].id='other';
  assert.throws(()=>apply(partialPlan,bad),/指定ID/);
}
let partialCalls=0;
const partialHost={retainInitialGenerationEvidence:()=>{},captureInitialGenerationEvidence:()=>{},captureInitialGenerationValidation:()=>{},initialGenerationEvidence:new InitialGenerationEvidence(),getSettings:()=>({}),
  towerGenerationHost:{generateNarrative:async()=>({response:withDungeonPlan(original.narrative)})},onStructuredRepairProgress:()=>{},
  structuredGenerate:async config=>{partialCalls++;if(partialCalls>2)assert.fail('third request');
    if(partialCalls===2){assert.equal(config.structured_delivery,'text-json');assert.match(config.user_input,/definitionId/);return partialResponse;}
    const raw=structuredClone(partial);delete raw.narrative;return raw;},
};
const partialGenerated=await DesignAssistantController.prototype.generateTowerInitialRegistryContent.call(partialHost,
  {chatId:'partial',messageId:0,generationId:'partial-test',startPrompt:'start',config:{}},{},null,()=>{});
assert.equal(partialCalls,2);assert.equal(partialGenerated.repairAvailable,false);
assert.equal(partialGenerated.content.player.statuses[0].id,'missing');
assert.equal(partialGenerated.content.player.cards[0].creates[0].id,'paper');
assert.deepEqual(partialGenerated.content.player.cards[0].effects,partial.player.cards[0].effects);
assert.deepEqual(partialGenerated.content.opening,original.opening);
const tooDeep=structuredClone(original);tooDeep.registry.resources[0].max=-1;
let nested=tooDeep.player.cards[0].effects;for(let i=0;i<140;i++){nested.child={};nested=nested.child;}
assert.equal(plan(tooDeep),null,'depth-limit diagnostic is not an envelope slot and cannot be ignored');
console.log('PASS actual controller repairs invalid envelope and independent missing status/template in one call; IDs, existing owners and references locked.');
console.log('PASS actual initial controller combines container and typed definition-field repair in one text request; unchanged identity, story, cards, no third attempt or unsupported-error masking.');
