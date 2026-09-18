import assert from 'node:assert/strict';
import { withDungeonPlan } from './lib/tower-plan-fixture.mjs';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {DesignAssistantController,planTowerInitialJointRepair,applyTowerInitialJointRepair,createTowerInitialJointRepairJsonSchema}=require('../src/sillytavern-extension/controller.ts');
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const {InitialGenerationEvidence}=require('../src/sillytavern-extension/initialGenerationEvidence.ts');
const {TOWER_INITIAL_SLOT_REPAIR_SPEC,collectTowerOpeningEnvelopeIssues,parseTowerOpeningResult}=require('../src/game-core/towerRequest.ts');
const {INITIAL_DRAFT_REGISTRY_REPAIR_SPEC}=require('../src/game-core/initialDraftRepair.ts');
const {createContentPackFromMvuBattle}=require('../src/runtime/contentPackAdapter.ts');
const {assessInitialPlayerContent}=require('../src/game-core/playerContentReadiness.ts');
const draft={spec:'mwg.initial-draft/v1',narrative:'Locked preset story',player:{
  status:{time:'night',location:'tower',profession:{name:'scribe',ability:'record'}},
  core:{emoji:'✨',hp:60,max_hp:60,lust:0,max_lust:100},
  cards:[{id:'start',name:'start',emoji:'🃏',type:'Attack',rarity:'Common',cost:1,quantity:3,effects:[
    {damage:6,resource:{id:'charge',amount:1},to:'self',when:'self.hp > 0'},
    {apply_status:'missing',stacks:1,to:'self'},
  ]}],
},registry:{statuses:[],resources:[{id:'charge',name:'charge',emoji:'⚡',start:1,max:3,refresh:'retain'}],templates:[]},
opening:{title:'gift',narrative:'choose',choices:[1,2,3].map(n=>({id:`gift${n}`,label:`gift${n}`,outcome:{gold:n}}))}};
const before=structuredClone(draft),plan=planTowerInitialJointRepair(draft);
assert.ok(plan,'joint planning must collect both rule and missing-definition faults');
assert.equal(plan.registry.slots.length,1);
assert.equal(plan.targets.length,1);
assert.deepEqual(plan.targets[0].slots.map(slot=>slot.kind),['effect_item_sequence']);
const response={spec:'mwg.initial-joint-repair/v1',registry:{spec:INITIAL_DRAFT_REGISTRY_REPAIR_SPEC,additions:{r0:{
  id:'missing',name:'missing',emoji:'✨',type:'buff',stacks_change:'keep',triggers:{hold:{modify:'block',add:1}},
}}},rules:{spec:TOWER_INITIAL_SLOT_REPAIR_SPEC,roots:Object.fromEntries(plan.targets.map(root=>[root.token,{slots:Object.fromEntries(root.slots.map(slot=>[slot.token,{action:slot.action,value:[
  {damage:6,to:'opponent',when:'self.hp > 0'},
  {resource:{id:'charge',amount:1},to:'self',when:'self.hp > 0'},
]}]))}])),support_statuses:[],support_resources:[]}};
const repaired=applyTowerInitialJointRepair(plan,response);
const schemaValidator=new Ajv2020({strict:false}).compile(createTowerInitialJointRepairJsonSchema(plan).value);
assert.equal(schemaValidator(response),true,JSON.stringify(schemaValidator.errors));
assert.deepEqual(draft,before,'no mutation of authored input');
assert.equal(repaired.player.cards[0].effects.length,3);
assert.deepEqual(repaired.player.cards[0].effects[2],before.player.cards[0].effects[1]);
assert.deepEqual(repaired.opening,before.opening);assert.equal(repaired.narrative,before.narrative);
assert.equal(repaired.registry.statuses[0].id,'missing');
const compiled=compileInitialDraftToMvu(repaired);
assert.equal(compiled.ok,true,JSON.stringify(compiled));
const ready=assessInitialPlayerContent(createContentPackFromMvuBattle(compiled.value.player));
assert.equal(ready.ok,true,JSON.stringify(ready.issues));
for(const mutate of [
  value=>value.rules.roots.r0.slots.s0.value.pop(),
  value=>delete value.rules.roots.r0.slots.s0.value[0].when,
  value=>value.registry.additions.r0.id='other',
  value=>value.rules.support_statuses.push({id:'other'}),
  value=>value.player={},
]) {const bad=structuredClone(response);mutate(bad);assert.throws(()=>applyTowerInitialJointRepair(plan,bad));}
const requests=[];
const rawDraft=structuredClone(draft);delete rawDraft.narrative;
const host={
  initialGenerationEvidence:new InitialGenerationEvidence(),
  host:{context:()=>null},
  currentChatId:()=> 'test',
  debug:(message,error)=>{throw new Error(message,{cause:error});},
  ...Object.fromEntries([
    'retainInitialGenerationEvidence','captureInitialGenerationEvidence',
    'captureInitialGenerationValidation','persistInitialGenerationEvidence',
  ].map(name=>[name,DesignAssistantController.prototype[name]])),
  towerGenerationHost:{generateNarrative:async()=>({response:withDungeonPlan(draft.narrative)})},
  getSettings:()=>({initialMechanismThinking:'disabled'}),
  onStructuredRepairProgress:()=>{},
  structuredGenerate:async config=>{requests.push(config);return structuredClone(requests.length===1?rawDraft:response);},
};
const generated=await DesignAssistantController.prototype.generateTowerInitialRegistryContent.call(host,
  {chatId:'test',messageId:0,generationId:'joint-test',startPrompt:'start',config:{}},{},null,()=>{});
assert.equal(requests.length,2,'one draft and one joint repair, never separate rule and registry requests');
assert.equal(requests[1].generation_id,'joint-test__joint_repair');
assert.equal(generated.repairAvailable,false,'shared extra budget consumed');
assert.match(requests[1].user_input,/一次联合修正/);
assert.equal(generated.content.player.cards[0].effects.length,3);
const evidence=host.initialGenerationEvidence.snapshot('test').runs.find(run=>run.generationId==='joint-test');
assert.ok(evidence);
const record=stage=>evidence.records.find(entry=>entry.stage===stage);
assert.deepEqual(JSON.parse(record('provider-final').text),rawDraft,'original final remains intact after repair and compilation');
assert.deepEqual(JSON.parse(record('merged-draft').text),draft);
assert.ok(evidence.validationErrors.length>0,'initial faults remain available after successful repair');
assert.ok(record('repair-slot-plan'),'joint repair scope is retained');
assert.deepEqual(JSON.parse(record('repair-final').text),response);
assert.equal(JSON.parse(record('semantic-observation').text).status,'reported');
assert.deepEqual(JSON.parse(record('compiled-result').text),generated.content);
const shared=structuredClone(draft);
shared.registry.templates=[{id:'paper',name:'paper',type:'Attack',rarity:'Common',cost:0,effects:{damage:6,resource:{id:'charge',amount:1},to:'self'}}];
shared.player.cards[0].effects=[{add_card:'paper'},shared.player.cards[0].effects[1]];
shared.opening.choices[0].outcome={reward:{cards:[{card_ref:'start',quantity:1}]}};
const sharedPlan=planTowerInitialJointRepair(shared);
assert.ok(sharedPlan);
assert.equal(sharedPlan.targets.length,2,'player and reward template diagnostics both covered');
const sharedResponse=structuredClone(response);
sharedResponse.rules.roots=Object.fromEntries(sharedPlan.targets.map(root=>[root.token,{slots:Object.fromEntries(root.slots.map(slot=>[slot.token,{action:slot.action,value:[
  {damage:6,to:'opponent'},{resource:{id:'charge',amount:1},to:'self'},
]}]))}]));
const sharedResult=applyTowerInitialJointRepair(sharedPlan,sharedResponse);
assert.deepEqual(sharedResult.opening,shared.opening,'reward card_ref remains compact and unchanged');
assert.deepEqual(sharedResult.registry.templates[0].effects,sharedResponse.rules.roots.r0.slots.s0.value);
const sharedCompiled=compileInitialDraftToMvu(sharedResult);assert.equal(sharedCompiled.ok,true);
assert.deepEqual(sharedCompiled.value.player.cards[0].creates[0].effects,sharedCompiled.value.opening.choices[0].outcome.reward.cards[0].creates[0].effects);
const contradictory=structuredClone(sharedResponse);
contradictory.rules.roots.r1.slots.s0.value.reverse();
assert.throws(()=>applyTowerInitialJointRepair(sharedPlan,contradictory),/相互矛盾/,'different legal orders for one source cannot silently choose a winner');
const eventDraft=structuredClone(draft);
eventDraft.registry.statuses=[{id:'binding',name:'binding',emoji:'✨',type:'buff',stacks_change:'keep',description:'获得 missing 时获得2格挡',triggers:{gain_buff:{block:2,to:'self',when:"stacks > 0 && event == 'status_applied' && source_id == 'missing'"}}}];
eventDraft.player.cards[0].effects.push({apply_status:'binding',stacks:1,to:'self'});
const eventPlan=planTowerInitialJointRepair(eventDraft);assert.ok(eventPlan);
assert.deepEqual(eventPlan.targets.flatMap(root=>root.slots.map(slot=>slot.kind)).sort(),['condition','effect_item_sequence']);
const eventResponse=structuredClone(response);
eventResponse.rules.roots=Object.fromEntries(eventPlan.targets.map(root=>[root.token,{slots:Object.fromEntries(root.slots.map(slot=>[slot.token,{action:slot.action,
  value:slot.kind==='condition'?"stacks > 0 && event_status_is('missing')":response.rules.roots.r0.slots.s0.value,
}]))}]));
const eventResult=applyTowerInitialJointRepair(eventPlan,eventResponse);
assert.equal(eventResult.registry.statuses[0].description,eventDraft.registry.statuses[0].description);
assert.deepEqual({...eventResult.registry.statuses[0].triggers.gain_buff,when:undefined},{...eventDraft.registry.statuses[0].triggers.gain_buff,when:undefined},'only the condition changes, never payoff or target');
const eventCompiled=compileInitialDraftToMvu(eventResult);assert.equal(eventCompiled.ok,true);
assert.equal(assessInitialPlayerContent(createContentPackFromMvuBattle(eventCompiled.value.player)).ok,true);
const removedCondition=structuredClone(eventResponse);
for(const root of eventPlan.targets)for(const slot of root.slots)if(slot.kind==='condition')removedCondition.rules.roots[root.token].slots[slot.token].value=null;
assert.throws(()=>applyTowerInitialJointRepair(eventPlan,removedCondition),/不能.*(删除原条件|删除原限制)/);
const invalidOpening=structuredClone(draft);
invalidOpening.opening.title='';
invalidOpening.opening.choices[0].label='';
invalidOpening.opening.choices[1].outcome={block:4};
const invalidBefore=structuredClone(invalidOpening);
const envelopeIssues=collectTowerOpeningEnvelopeIssues(invalidOpening.opening);
assert.equal(envelopeIssues.length,3,'independent opening faults collected together');
assert.throws(()=>parseTowerOpeningResult(JSON.stringify({spec:'mwg.tower-opening-result/v1',request_id:'test',based_on_revision:0,...invalidOpening.opening}),{requestId:'test',basedOnRevision:0}),
  error=>envelopeIssues.every(issue=>error.message.includes(issue)));
assert.equal(planTowerInitialJointRepair(invalidOpening),null,'unmapped envelope cannot masquerade as complete missing-definition repair');
let blockedRequests=0;
await assert.rejects(()=>DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
  structuredGenerate:async()=>{blockedRequests++;const raw=structuredClone(invalidOpening);delete raw.narrative;return raw;},
},{chatId:'test',messageId:0,generationId:'envelope-test',startPrompt:'start',config:{}},{},null,()=>{}),/未消耗额外请求/);
assert.equal(blockedRequests,1,'no futile definition-only fallback after incomplete joint planning');
assert.deepEqual(invalidOpening,invalidBefore);
const invalidStory=structuredClone(draft);
invalidStory.player.status.profession.ability='';
assert.equal(planTowerInitialJointRepair(invalidStory),null,'story-dependent fields must be checked before a definition-only request');
// Resource fields + missing definition + malformed rule share one call.
const threeFaults=structuredClone(draft);threeFaults.registry.resources[0].max=-1;
let why='';const threePlan=planTowerInitialJointRepair(threeFaults,r=>{why=r;});
assert.ok(threePlan,why||'three independent diagnostic classes need a joint plan');
assert.ok(threePlan.source);
assert.equal(threePlan.registry.slots.length,1);assert.equal(threePlan.targets.length,1);
const threeResponse={...structuredClone(response),source:{replacements:Object.fromEntries(threePlan.source.slots.map(s=>[
  s.token,s.path.reduce((v,k)=>v[k],draft),
]))}};
assert.equal(new Ajv2020({strict:false}).compile(createTowerInitialJointRepairJsonSchema(threePlan).value)(threeResponse),true);
const threeResult=applyTowerInitialJointRepair(threePlan,threeResponse);
assert.deepEqual(threeResult,repaired,'only the diagnosed source fields and existing protected joint edits differ');
assert.equal(threeFaults.registry.resources[0].max,-1,'original remains unchanged');
for(const breakIt of [x=>delete x.source,x=>x.source.replacements.extra=1,x=>x.source.replacements.e0='3']){
  const bad=structuredClone(threeResponse);breakIt(bad);assert.throws(()=>applyTowerInitialJointRepair(threePlan,bad));
}
let tripleCalls=0;
const tripleGenerated=await DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
  structuredGenerate:async config=>{tripleCalls++;if(tripleCalls>2)assert.fail('third repair invocation');
    if(tripleCalls===2){assert.equal(config.structured_delivery,'text-json');assert.match(config.user_input,/SOURCE_SLOTS=/);return threeResponse;}
    const raw=structuredClone(threeFaults);delete raw.narrative;return raw;},
},{chatId:'test',messageId:0,generationId:'triple-test',startPrompt:'start',config:{}},{},null,()=>{});
assert.equal(tripleCalls,2);assert.equal(tripleGenerated.repairAvailable,false);
assert.deepEqual(tripleGenerated.content,compiled.value);
const noRuleFault=structuredClone(threeFaults);
noRuleFault.player.cards[0].effects=[{damage:6},noRuleFault.player.cards[0].effects[1]];
const noRulePlan=planTowerInitialJointRepair(noRuleFault);assert.ok(noRulePlan?.source);
assert.equal(noRulePlan.targets.length,0);
const noRuleResponse=structuredClone(threeResponse);noRuleResponse.rules.roots={};
const noRuleResult=applyTowerInitialJointRepair(noRulePlan,noRuleResponse);
assert.equal(compileInitialDraftToMvu(noRuleResult).ok,true);
assert.deepEqual(noRuleResult.player,noRuleFault.player,'no rule edits when only definitions/source fields fail');
let noRuleCalls=0;
const noRuleGenerated=await DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
  structuredGenerate:async config=>{noRuleCalls++;if(noRuleCalls>2)assert.fail('third invocation');
    if(noRuleCalls===2){assert.equal(config.json_schema.name,'mwg_initial_joint_repair');return noRuleResponse;}
    const raw=structuredClone(noRuleFault);delete raw.narrative;return raw;},
},{chatId:'test',messageId:0,generationId:'source-reference-test',startPrompt:'start',config:{}},{},null,()=>{});
assert.equal(noRuleCalls,2);assert.equal(noRuleGenerated.repairAvailable,false);
let invalidTripleCalls=0;
const invalidTriple=structuredClone(threeResponse);invalidTriple.source.replacements.e0=-1;
await assert.rejects(()=>DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
  structuredGenerate:async()=>{invalidTripleCalls++;if(invalidTripleCalls>2)assert.fail('third invocation');
    if(invalidTripleCalls===2)return invalidTriple;const raw=structuredClone(threeFaults);delete raw.narrative;return raw;},
},{chatId:'test',messageId:0,generationId:'invalid-triple-test',startPrompt:'start',config:{}},{},null,()=>{}),/未写入任何变量/);
assert.equal(invalidTripleCalls,2);
// No missing definition is required to combine source and rule corrections.
const sourceAndRules=structuredClone(threeFaults);sourceAndRules.player.cards[0].effects.pop();
const sourceRulePlan=planTowerInitialJointRepair(sourceAndRules);
assert.ok(sourceRulePlan?.source);assert.equal(sourceRulePlan.registry.slots.length,0);
assert.equal(sourceRulePlan.targets.length,1);
const sourceRuleResponse=structuredClone(threeResponse);sourceRuleResponse.registry.additions={};
assert.equal(new Ajv2020({strict:false}).compile(createTowerInitialJointRepairJsonSchema(sourceRulePlan).value)(sourceRuleResponse),true);
const sourceRuleResult=applyTowerInitialJointRepair(sourceRulePlan,sourceRuleResponse);
assert.deepEqual(sourceRuleResult.registry,draft.registry,'repair existing resource without adding definitions');
assert.equal(sourceRuleResult.player.cards[0].effects.length,2);
const extraDefinition=structuredClone(sourceRuleResponse);extraDefinition.registry.additions.r0=response.registry.additions.r0;
assert.throws(()=>applyTowerInitialJointRepair(sourceRulePlan,extraDefinition),/恰好覆盖/);
let sourceRuleCalls=0;
const sourceRuleGenerated=await DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
  structuredGenerate:async config=>{sourceRuleCalls++;if(sourceRuleCalls>2)assert.fail('third call');
    if(sourceRuleCalls===2){assert.equal(config.json_schema.name,'mwg_initial_joint_repair');return sourceRuleResponse;}
    const raw=structuredClone(sourceAndRules);delete raw.narrative;return raw;},
},{chatId:'test',messageId:0,generationId:'source-rules-test',startPrompt:'start',config:{}},{},null,()=>{});
assert.equal(sourceRuleCalls,2);assert.equal(sourceRuleGenerated.repairAvailable,false);
assert.equal(sourceRuleGenerated.content.player.core.resources[0].max,3);
assert.equal(sourceRuleGenerated.content.player.cards[0].effects.length,2);
console.log('PASS source plus rule faults use one joint request even without any missing definition; empty additions remain locked.');
for(const container of ['choices','core','opening_null','opening_undefined','opening_array'])for(const missing of [false,true])for(const badResource of [false,true]){
 const broken=structuredClone(draft);
 if(container==='choices')broken.opening.choices=null;
 else if(container==='core')broken.player.core=null;
 else broken.opening=container==='opening_null'?null:container==='opening_array'?[]:undefined;
 if(!missing)broken.player.cards[0].effects.pop();
 if(badResource)broken.registry.resources[0].max=-1;
 const beforeBroken=structuredClone(broken);let reason='';
 const partialPlan=planTowerInitialJointRepair(broken,r=>{reason=r;});assert.ok(partialPlan,reason||'broken choices must not hide intact player rule faults');
 assert.equal(partialPlan.targets.length,1);assert.ok(partialPlan.source.slots.some(s=>s.path.join('.')===(container==='choices'?'opening.choices':container==='core'?'player.core':'opening')));
 const partialResponse={...structuredClone(response),source:{replacements:Object.fromEntries(partialPlan.source.slots.map(s=>[s.token,s.path.reduce((v,k)=>v[k],draft)]))}};
 if(!missing)partialResponse.registry.additions={};
 assert.equal(new Ajv2020({strict:false}).compile(createTowerInitialJointRepairJsonSchema(partialPlan).value)(partialResponse),true);
 const restored=applyTowerInitialJointRepair(partialPlan,partialResponse);
 assert.deepEqual(restored.opening,draft.opening);assert.deepEqual(broken,beforeBroken);
 assert.equal(compileInitialDraftToMvu(restored).ok,true);
 let calls=0;
 const result=await DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
  structuredGenerate:async config=>{calls++;assert.ok(calls<=2,'no third request');
   if(calls===2){assert.equal(config.json_schema.name,'mwg_initial_joint_repair');assert.equal(config.structured_delivery,'text-json');return partialResponse;}
   const raw=structuredClone(broken);delete raw.narrative;return raw;},
 },{chatId:'test',messageId:0,generationId:`partial-${container}-${missing}-${badResource}`,startPrompt:'start',config:{}},{},null,()=>{});
 assert.equal(calls,2);assert.equal(result.repairAvailable,false);
 assert.equal(assessInitialPlayerContent(createContentPackFromMvuBattle(result.content.player)).ok,true);
 assert.deepEqual(result.content.opening,draft.opening);assert.equal(result.content.narrative,draft.narrative);
 assert.ok(result.content.player.cards[0].effects.slice(0,2).every(e=>e.when==='self.hp > 0'));
}
console.log('PASS broken choices, resource fields, missing definitions and independent card rules combine in one actual controller repair, preserving source, story and conditions.');
for(const absentPlayer of [null,undefined,[]]){
 const broken=structuredClone(draft);
 const rewardCard={...structuredClone(draft.player.cards[0]),id:'gift_card',quantity:1};
 broken.opening.choices[0].outcome={reward:{cards:[rewardCard]}};
 broken.player=absentPlayer;
 const unchanged=structuredClone(broken);let why='';
 const partialPlan=planTowerInitialJointRepair(broken,r=>{why=r;});assert.ok(partialPlan,why||'missing player must not hide reward rule faults');
 assert.equal(partialPlan.targets.length,1);assert.ok(partialPlan.targets[0].path.startsWith('opening.choices'));
 const authoredPlayer=structuredClone(draft.player);authoredPlayer.cards[0].effects={damage:6};
 const partialResponse={...structuredClone(response),source:{replacements:Object.fromEntries(partialPlan.source.slots.map(s=>[s.token,authoredPlayer]))}};
 const repaired=applyTowerInitialJointRepair(partialPlan,partialResponse);
 assert.deepEqual(repaired.player,authoredPlayer);assert.deepEqual(broken,unchanged);
 assert.equal(compileInitialDraftToMvu(repaired).ok,true);
 let calls=0;
 const generated=await DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
  structuredGenerate:async config=>{calls++;assert.ok(calls<=2);if(calls===2){assert.equal(config.json_schema.name,'mwg_initial_joint_repair');return partialResponse;}
   const raw=structuredClone(broken);delete raw.narrative;return raw;},
 },{chatId:'test',messageId:0,generationId:`missing-player-${String(absentPlayer)}`,startPrompt:'start',config:{}},{},null,()=>{});
 assert.equal(calls,2);assert.equal(generated.repairAvailable,false);
 assert.equal(assessInitialPlayerContent(createContentPackFromMvuBattle(generated.content.player)).ok,true);
 assert.deepEqual(collectTowerOpeningEnvelopeIssues(generated.content.opening),[]);
 const card=generated.content.opening.choices[0].outcome.reward.cards[0];
 assert.equal(card.effects.length,3);assert.ok(card.effects.slice(0,2).every(e=>e.when==='self.hp > 0'));
 assert.ok(card.statuses.some(s=>s.id==='missing'),'reward-owned definition remains with unclaimed reward');
 assert.ok(!generated.content.player.statuses.some(s=>s.id==='missing'));
}
console.log('PASS missing/null/array root objects retain independent card/reward repair and exact ownership in the same two-call controller budget.');
console.log('PASS resource fields, missing definitions and rule errors repaired together through actual controller in one text request.');
console.log('PASS joint repair: missing registry plus exact mixed-effect splice in one response; immutable story/rewards, final compile/readiness, no lost conditions or extra definitions');

for (const brokenRegistry of [null, undefined, []]) {
 const broken=structuredClone(draft);
 broken.registry=brokenRegistry;
 broken.player.cards[0].effects=[{damage:6,resource:{id:'charge',amount:1},when:'self.hp > 0'}];
 const unchanged=structuredClone(broken);
 const combined=planTowerInitialJointRepair(broken);
 assert.ok(combined,'invalid registry root must not conceal independent authored card rules');
 assert.equal(combined.registry.slots.length,0,'do not invent definitions in a missing registry');
 assert.equal(combined.targets.length,1);
 const answer={spec:'mwg.initial-joint-repair/v1',
  registry:{spec:INITIAL_DRAFT_REGISTRY_REPAIR_SPEC,additions:{}},
  source:{replacements:Object.fromEntries(combined.source.slots.map(s=>[s.token,{statuses:[],resources:structuredClone(draft.registry.resources),templates:[]}]))},
  rules:{spec:TOWER_INITIAL_SLOT_REPAIR_SPEC,support_statuses:[],support_resources:[],
   roots:Object.fromEntries(combined.targets.map(root=>[root.token,{slots:Object.fromEntries(root.slots.map(slot=>[slot.token,{action:slot.action,value:[
    {damage:6,when:'self.hp > 0'},{resource:{id:'charge',amount:1},when:'self.hp > 0'},
   ]}]))}]))}};
 let calls=0;
 const result=await DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
  initialGenerationEvidence:new InitialGenerationEvidence(),
  structuredGenerate:async config=>{calls++;assert.ok(calls<=2);assert.equal(config.structured_delivery,'text-json');
   if(calls===2){assert.equal(config.json_schema.name,'mwg_initial_joint_repair');return structuredClone(answer);}
   const raw=structuredClone(broken);delete raw.narrative;return raw;},
 },{chatId:'test',messageId:0,generationId:'registry-root-joint',startPrompt:'start',config:{}},{},null,()=>{});
 assert.equal(calls,2);assert.equal(result.repairAvailable,false);
 assert.equal(result.content.player.cards[0].effects.length,2);
 assert.deepEqual(broken,unchanged);
 assert.equal(result.content.narrative,broken.narrative);
 assert.deepEqual(result.content.opening,broken.opening);
 const bad=structuredClone(answer);bad.registry.additions.unrequested={id:'invented'};
 assert.throws(()=>applyTowerInitialJointRepair(combined,bad));
 const incomplete=structuredClone(answer);
 for(const value of Object.values(incomplete.source.replacements))value.resources=[];
 let failedCalls=0;
 await assert.rejects(()=>DesignAssistantController.prototype.generateTowerInitialRegistryContent.call({...host,
  initialGenerationEvidence:new InitialGenerationEvidence(),
  structuredGenerate:async()=>{failedCalls++;assert.ok(failedCalls<=2,'no third request after incomplete root repair');
   if(failedCalls===2)return incomplete;
   const raw=structuredClone(broken);delete raw.narrative;return raw;},
 },{chatId:'test',messageId:0,generationId:'registry-root-incomplete',startPrompt:'start',config:{}},{},null,()=>{}));
 assert.equal(failedCalls,2);
}
console.log('PASS missing/null/array registry roots and independent card rules share one text repair without guessed definitions or original mutation.');
