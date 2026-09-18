import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {convertMvuStance}=require('../src/fish/core/mvuBattleAdapter.ts');
const {createBattleRequestFromMvu}=require('../src/fish/core/battleContractAdapter.ts');
const {GameStateManager}=require('../src/fish/core/gameStateManager.ts');
const {UnifiedEffectExecutor}=require('../src/fish/combat/unifiedEffectExecutor.ts');
const {CardSystem}=require('../src/fish/combat/cardSystem.ts');
const {BattleManager}=require('../src/fish/combat/battleManager.ts');
const {normalizeMvuPlayerAuthoredContent:normalize}=require('../src/runtime/mvuBattleContentNormalizer.ts');
const {preflightBattleContent}=require('../src/fish/core/battleContentPreflight.ts');

const stance={id:'balanced_flow',name:'均衡气流',emoji:'🌪️',events:[{
  on:'attack_played',scope:'turn',ordinal:'first',effects:{resource:{id:'pressure',amount:1}},
}]};
const authored={stance};
const before=structuredClone(authored);
const compiled=core.compileCompactEffectList(authored);
assert.equal(compiled.ok,true,JSON.stringify(compiled));
assert.equal(core.validateEffectProgramPolicy(compiled.value,{triggerPolicy:'forbid',modifierPolicy:'forbid'}).ok,true);
const parsedStance=compiled.value.steps[0].stance;
assert.equal(parsedStance.events[0].eventQuery.filter.kind,'card_played');
assert.equal(parsedStance.events[0].eventQuery.filter.cardType,'Attack');
assert.deepEqual(authored,before);
const wrapped={stance:{...stance,events:undefined,passive:{trigger:structuredClone(stance.events[0])}}};
delete wrapped.stance.events;
assert.deepEqual(normalize(wrapped),authored,'closed misplaced event moves without dropping a filter or condition');
assert.deepEqual(normalize(normalize(wrapped)),authored);
const conflicted={stance:{...structuredClone(stance),passive:{trigger:stance.events[0]}}};
assert.deepEqual(normalize(conflicted),conflicted,'two possible destinations are not merged');
assert.deepEqual(normalize({effects:{gain_pressure:{resource:{id:'pressure',amount:3}}}}),
  {effects:{resource:{id:'pressure',amount:3}}});
for(const effect of [
  {gain_pressure:{resource:{id:'other',amount:3}}}, {gain_pressure:{resource:{id:'pressure',amount:-3}}},
  {gain_pressure:{resource:{id:'pressure',amount:'x_value'}}},
  {gain_pressure:{resource:{id:'pressure',amount:3},damage:6}},
  {double_pressure:{resource:{id:'pressure',amount:3}}},
])assert.deepEqual(normalize({effects:effect}),{effects:effect},'unknown or ambiguous mechanic must not be erased');
assert.deepEqual(convertMvuStance(stance).events,parsedStance.events);
const stanceReferences=[];
const description=core.describeCompactEffectList(authored,undefined,{onStanceReference:reference=>stanceReferences.push(reference)});
assert.match(description,/进入姿态“均衡气流”/);
assert.equal(stanceReferences.length,1);
const {renderStancePanel}=require('../src/shared/stancePresentation.ts');
const stanceDetails=renderStancePanel(stanceReferences[0].stance);
assert.match(stanceDetails,/仅此姿态生效期间/);assert.match(stanceDetails,/首次/);assert.match(stanceDetails,/1点/);
const ajv=new Ajv2020({strict:false});
const compactSchema=JSON.parse(readFileSync('schemas/mwg-card-effects-v1.schema.json','utf8'));
const programSchema=JSON.parse(readFileSync('schemas/mwg-effect-v1.schema.json','utf8'));
const validateCompact=ajv.compile({$defs:compactSchema.$defs,$ref:'#/$defs/stanceDefinition'});
const validateProgram=ajv.compile(programSchema);
const {withAiContentDefinitions,aiSchemaRef}=require('../src/game-core/aiContentJsonSchema.ts');
const validateAiStance=ajv.compile(withAiContentDefinitions(aiSchemaRef('mwgInitialStance')));
assert.equal(validateAiStance(stance),true,JSON.stringify(validateAiStance.errors));
assert.equal(validateCompact(stance),true,JSON.stringify(validateCompact.errors));
assert.equal(validateProgram(compiled.value),true,JSON.stringify(validateProgram.errors));
assert.equal(validateCompact({...stance,activationId:123}),false,'AI must not author program-owned activation identity');
assert.equal(validateAiStance({...stance,activationId:123}),false);
const detached=core.compileCompactEffectList({stance:{...stance,events:[{on:'turn_start',effects:{damage:2}}]}},{implicitTarget:'self'});
assert.equal(detached.ok,true);assert.equal(detached.value.steps[0].stance.events[0].effects[0].target,'opponent',
  'a stance listener does not inherit the granting status implicit self target');
for(const bad of [
  {...stance,events:[]}, {...stance,events:[{on:'passive',effects:{modify:'damage',add:1}}]},
  {...stance,events:[{on:'attack_played',effects:[]}]},
  {...stance,events:[{on:'attack_played',scope:'turn',ordinal:'first',n:2,effects:{block:1}}]},
]){assert.equal(core.compileCompactEffectList({stance:bad}).ok,false);assert.equal(validateCompact(bad),false);}
for(const effect of [{resource:{id:'pressure',amount:'spent_resource.pressure'}},{block:'stacks'},
  {damage:1,on:'turn_start'},{modify:'damage',add:1},{replay_current:1}]){
  const result=core.compileCompactEffectList({stance:{...stance,events:[{on:'turn_start',effects:effect}]}});
  assert.ok(!result.ok||!core.validateEffectProgramPolicy(result.value,{triggerPolicy:'forbid',modifierPolicy:'forbid',
    allowSpentResources:new Set(['pressure']),allowStatusStacks:true,allowCurrentCardReplay:true}).ok,
    'detached listener cannot capture original card payments/status stacks or register permanent effects');
}

// Frozen activation, no retroactive participation, no dangling listener after
// leave/re-enter, single-use dispatch, recursion guard and exception recovery.
let current={...structuredClone(parsedStance),enteredTurn:1};let calls=0;
const runtime=new core.StanceTriggerRuntime({readStance:()=>current,execute:async()=>{calls++;}});
const eventContext={};
const simple={...structuredClone(parsedStance),events:[{trigger:'turn_start',effects:[{op:'gain_block',target:'self',amount:1}]}],enteredTurn:1};
current=null;const absent=runtime.prepare('player','turn_start',eventContext);current=structuredClone(simple);await absent();assert.equal(calls,0);
const stale=runtime.prepare('player','turn_start',eventContext);current={...structuredClone(simple),activationId:1};await stale();assert.equal(calls,0);
const once=runtime.prepare('player','turn_start');await once();await once();assert.equal(calls,1);
let recursive;
recursive=new core.StanceTriggerRuntime({readStance:()=>current,execute:async()=>{calls++;await recursive.prepare('player','turn_start')();}});
await recursive.prepare('player','turn_start')();assert.equal(calls,2);
let fails=true;
const recovery=new core.StanceTriggerRuntime({readStance:()=>current,execute:async()=>{if(fails)throw Error('injected');calls++;}});
await assert.rejects(recovery.prepare('player','turn_start')(),/injected/);fails=false;await recovery.prepare('player','turn_start')();assert.equal(calls,3);
current={...structuredClone(simple),events:[...simple.events,...simple.events]};
const switches=new core.StanceTriggerRuntime({readStance:()=>current,execute:async()=>{calls++;current=null;}});
await switches.prepare('player','turn_start')();assert.equal(calls,4,'remaining listeners stop after leaving');
current={...structuredClone(simple),activationId:2};
let frozenAmount;
const frozen=new core.StanceTriggerRuntime({readStance:()=>current,execute:async(_side,plan)=>{frozenAmount=plan.program.steps[0].amount;}});
const prepared=frozen.prepare('player','turn_start');current.events[0].effects[0].amount=999;await prepared();
assert.equal(frozenAmount,1,'prepared programs do not share mutable holder definitions');

// Real player card lifecycle and event journal, not manual trigger counters.
const player={core:{emoji:'🔧',hp:40,max_hp:40,lust:0,max_lust:30,resources:[{id:'pressure',name:'压力',emoji:'🌡️',max:8,start:0,refresh:'retain'}]},
  cards:[
    {id:'enter',name:'进入均衡',type:'Skill',rarity:'Common',cost:0,quantity:2,effects:authored},
    {id:'leave',name:'退出姿态',type:'Skill',rarity:'Common',cost:0,quantity:2,effects:{stance:null}},
    {id:'hit',name:'测试攻击',type:'Attack',rarity:'Common',cost:0,quantity:4,effects:{damage:1}},
  ],statuses:[],artifacts:[],items:[]};
const battle={...player,enemy:{id:'dummy',name:'目标',emoji:'◇',hp:200,max_hp:200,lust:0,max_lust:30,
  actions:[{id:'wait',name:'等待',effects:{block:1}}]}};
const unknownResource=structuredClone(battle);unknownResource.core.stance={...stance,events:[{on:'turn_start',effects:{resource:{id:'missing',amount:1}}}]};
assert.equal(preflightBattleContent(unknownResource).ok,false,'initial stance future resource dependency must be checked');
const enemyGift=structuredClone(battle);enemyGift.enemy.resources=structuredClone(player.core.resources);enemyGift.core.resources=[];
enemyGift.cards=[{id:'enemy_stance',name:'给对方姿态',type:'Skill',rarity:'Common',cost:0,quantity:1,effects:{stance,to:'opponent'}}];
assert.equal(preflightBattleContent(enemyGift).ok,true,'gifted stance checks holder resources, not original card owner');
enemyGift.enemy.resources=[];assert.equal(preflightBattleContent(enemyGift).ok,false,'gifted stance missing holder resource is rejected');
const resourceStatus={id:'pressure_tick',name:'压力脉冲',emoji:'🌡️',type:'buff',stacks_change:0,
  triggers:{turn_start:{resource:{id:'pressure',amount:1}}}};
const statusStance={...stance,events:[{on:'turn_start',effects:{apply_status:'pressure_tick',stacks:1,to:'self'}}]};
const indirect=structuredClone(enemyGift);indirect.statuses=[resourceStatus];
indirect.cards[0].effects.stance=structuredClone(statusStance);
indirect.enemy.resources=structuredClone(player.core.resources);
assert.equal(preflightBattleContent(indirect).ok,true,'status introduced by gifted stance belongs to the holder');
indirect.enemy.resources=[];
assert.equal(preflightBattleContent(indirect).ok,false,'indirect future status resources are not silently skipped');
const initialIndirect=structuredClone(battle);initialIndirect.cards=[];initialIndirect.statuses=[resourceStatus];
initialIndirect.core.stance=structuredClone(statusStance);initialIndirect.core.resources=[];
assert.equal(preflightBattleContent(initialIndirect).ok,false,'initial stance registers future status owners');
initialIndirect.core.resources=structuredClone(player.core.resources);
assert.equal(preflightBattleContent(initialIndirect).ok,true);
const store=GameStateManager.getInstance(),executor=UnifiedEffectExecutor.getInstance(),cards=CardSystem.getInstance(),manager=BattleManager.getInstance();
const quiet=new Proxy({},{get:()=>async()=>undefined});
executor.presentation=quiet;cards.presentation=quiet;manager.relicTriggerHost.presentation=quiet;manager.enemyIntentPresenter=quiet;
store.convertMVUToGameState(createBattleRequestFromMvu({stat_data:{battle}},battle));
manager.prepareInitialPlayerTurn();await manager.beginInitialPlayerTurn();
async function play(id){const p=store.getPlayer();let card=p.hand.find(c=>c.originalId===id);
  if(!card)for(const pile of [p.drawPile,p.discardPile]){const i=pile.findIndex(c=>c.originalId===id);if(i>=0){card=pile.splice(i,1)[0];p.hand.push(card);break;}}
  assert.ok(card,`owned ${id}`);assert.equal(await cards.playCard(card.id),true,id);}
await play('enter');assert.equal(store.getPlayer().resources.pressure.current,0,'entering does not fire attack listener');
const firstActivation=store.getPlayer().stance.activationId;assert.ok(Number.isSafeInteger(firstActivation));
await play('enter');assert.equal(store.getPlayer().stance.activationId,firstActivation,'same-ID no-op keeps activation identity');
await play('hit');assert.equal(store.getPlayer().resources.pressure.current,1,'first attack fires once');
await play('hit');assert.equal(store.getPlayer().resources.pressure.current,1,'second attack does not pass ordinal');
await play('leave');await play('hit');assert.equal(store.getPlayer().resources.pressure.current,1,'no listener after exit');
assert.equal(store.getPlayer().abilities.length,0,'no permanent ability registration');
await manager.endPlayerTurn();await play('hit');await play('enter');await play('hit');
assert.ok(store.getPlayer().stance.activationId>firstActivation,'a true re-entry has a distinct persisted activation');
assert.equal(store.getPlayer().resources.pressure.current,1,'first-of-turn is not first-since-entry');
await manager.endPlayerTurn();
const serialized=JSON.stringify(store.getGameState());store.replaceState(JSON.parse(serialized));
assert.equal(JSON.stringify(store.getGameState()),serialized,'restores listeners and original event journal exactly');
await play('hit');assert.equal(store.getPlayer().resources.pressure.current,2,'next turn after restore runs one stance listener');
// Initial enemy stance conversion and exact multi-enemy owner routing.
const enemyStance={...stance,events:[{on:'turn_start',effects:{resource:{id:'pressure',amount:1}}}]};
const roster={...battle,enemies:['left','right'].map(id=>({...battle.enemy,id,
  resources:structuredClone(player.core.resources),stance:structuredClone(enemyStance)}))};
delete roster.enemy;
store.convertMVUToGameState(createBattleRequestFromMvu({stat_data:{battle:roster}},roster));
assert.equal(store.getEnemyById('right').stance?.events?.length,1,'initial enemy stance must retain its listener');
await executor.processAbilitiesByTrigger('enemy','turn_start',{enemyId:'right'});
assert.equal(store.getEnemyById('left').resources.pressure.current,0);
assert.equal(store.getEnemyById('right').resources.pressure.current,1,JSON.stringify({stance:store.getEnemyById('right').stance,logs:store.getGameState().logs?.slice(-3)}));
assert.equal(store.getPlayer().resources.pressure.current,0);
await executor.triggerHost.processAllEnemyAbilitiesByTrigger('turn_start');
assert.equal(store.getEnemyById('left').resources.pressure.current,1);
assert.equal(store.getEnemyById('right').resources.pressure.current,2);
store.setActiveEnemy('right');store.setCombatantStance('enemy',null);
await executor.triggerHost.processAllEnemyAbilitiesByTrigger('turn_start');
assert.equal(store.getEnemyById('left').resources.pressure.current,2);
assert.equal(store.getEnemyById('right').resources.pressure.current,2);
const grantedMidEvent=structuredClone(roster);
for(const enemy of grantedMidEvent.enemies)delete enemy.stance;
grantedMidEvent.enemies[0].abilities=[{id:'grant_stance',name:'授予姿态',trigger:{on:'turn_start',
  effects:[{stance:enemyStance,to:'self',targets:{mode:'by_id',id:'right'}},{block:2,to:'self'}]}}];
assert.equal(preflightBattleContent(grantedMidEvent).ok,true);
store.convertMVUToGameState(createBattleRequestFromMvu({stat_data:{battle:grantedMidEvent}},grantedMidEvent));
await executor.triggerHost.processAllEnemyAbilitiesByTrigger('turn_start');
assert.equal(store.getEnemyById('right').stance?.id,stance.id,JSON.stringify({left:store.getEnemyById('left').abilities,
  right:store.getEnemyById('right').stance,logs:store.getGameState().logs?.slice(-5)}));
assert.equal(store.getEnemyById('right').resources.pressure.current,0,'earlier enemy cannot grant retroactive participation to a later enemy');
assert.equal(store.getEnemyById('left').stance,null,'recipient selector cannot install on the source');
assert.equal(store.getEnemyById('left').block,2,'following self effects restore the original source binding');
assert.equal(store.getEnemyById('right').block,0);
await executor.triggerHost.processAllEnemyAbilitiesByTrigger('turn_start');
assert.equal(store.getEnemyById('right').resources.pressure.current,1,'existing stance participates in next event');
const savedSpecial=executor.executeSpecialCombatCommand;
store.beginEnemyResolution('left');
try {
  executor.executeSpecialCombatCommand=async()=>{assert.equal(store.getEnemy().id,'right');throw Error('selected-special-failure');};
  const selected=core.compileCompactEffectList({stance:enemyStance,to:'self',targets:{mode:'by_id',id:'right'}},{enemyCollectionTarget:'self'});
  assert.equal(selected.ok,true);
  await assert.rejects(executor.executeEffectProgram(selected.value,false),/selected-special-failure/);
  assert.equal(store.getEnemy().id,'left','selected scope is restored even if the special command throws');
} finally {executor.executeSpecialCombatCommand=savedSpecial;store.endEnemyResolution('left');}
console.log('PASS stance event contract and real card loop: first attack per turn, owner-local resource, exit/re-entry, no permanent abilities, frozen dispatch and serialized restore.');
