import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {BUILTIN_STATUS_DEFINITIONS,expandBuiltinStatusDefinitions,builtinStatusAuthoringContract}=require('../src/game-core/builtinStatusCatalog.ts');
const {normalizeRuntimeStatusDefinition}=require('../src/game-core/statusDefinitionRuntime.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const {createContentPack}=require('../src/game-core/contentPack.ts');
const {validateContentPackContract}=require('../src/game-core/contentContract.ts');
const {describeCompactStatus}=require('../src/game-core/contentDescription.ts');
const {effectProgramToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const {resolveEffectProgramModifiers}=require('../src/game-core/modifierMath.ts');
const {BattleEffectRuntime,BattleStateStore,createEmptyBattleState}=require('../src/game-core/index.ts');
const {normalizeMvuBattleContent}=require('../src/runtime/mvuBattleContentNormalizer.ts');
const {readRewardCandidateSupportStatuses}=require('../src/game-core/rewardCandidateValidation.ts');
for(const definition of BUILTIN_STATUS_DEFINITIONS){
 const normalized=normalizeRuntimeStatusDefinition(definition);
 assert.ok(normalized,definition.id);
 assert.ok(describeCompactStatus(definition).length>4,definition.id);
 assert.deepEqual(normalizeRuntimeStatusDefinition(JSON.parse(JSON.stringify(definition))),normalized,'saved rules remain identical');
}
const ritual=expandBuiltinStatusDefinitions([],{effects:{apply_status:'sts_ritual'}});
assert.deepEqual(ritual.map(s=>s.id),['sts_ritual','sts_strength']);
assert.deepEqual(expandBuiltinStatusDefinitions(ritual,{effects:{apply_status:'sts_ritual'}}),ritual,'idempotent');
assert.deepEqual(expandBuiltinStatusDefinitions([],{description:'sts_strength'}),[],'flavor never supplies mechanics');
const custom={...BUILTIN_STATUS_DEFINITIONS[0],name:'黑暗仪式',id:'dark_ritual'};
assert.deepEqual(expandBuiltinStatusDefinitions([custom],{effects:{apply_status:'dark_ritual'}}),[custom]);
assert.deepEqual(expandBuiltinStatusDefinitions([custom],{}),[custom]);
assert.equal(compileCompactEffectList({modify:'block',add:1,damage_type:'attack'}).ok,false,'filter cannot silently qualify non-damage');
const card={id:'strength_card',name:'鼓舞',type:'Skill',rarity:'Common',cost:1,effects:{apply_status:'sts_strength',stacks:2,to:'self'}};
const pack=createContentPack({cards:[card]});
assert.equal(validateContentPackContract(pack,{requireExecutable:true}).ok,true);
assert.equal(pack.statuses[0].id,'sts_strength');
const battle=normalizeMvuBattleContent({cards:[card],statuses:[]});
assert.equal(battle.statuses[0].id,'sts_strength');
assert.deepEqual(normalizeMvuBattleContent(JSON.parse(JSON.stringify(battle))),battle);
assert.equal(readRewardCandidateSupportStatuses(card).statuses[0].id,'sts_strength');
const authoredStrength={...BUILTIN_STATUS_DEFINITIONS[0],name:'剧情力量',triggers:{hold:{modify:'damage',add:7,damage_type:'attack'}}};
assert.deepEqual(readRewardCandidateSupportStatuses(card,[authoredStrength]).statuses,[],'existing authored definition is not replaced with builtin during reward claim');
const {validateRewardCandidateAgainstLibrary}=require('../src/game-core/rewardCandidateValidation.ts');
const authoredReference=validateRewardCandidateAgainstLibrary('cards',card,{statusDefinitions:[authoredStrength]});
assert.equal(authoredReference.ok,true,JSON.stringify(authoredReference));

assert.match(builtinStatusAuthoringContract(),/黑暗仪式/);

const state=createEmptyBattleState();
state.player.maxHp=state.player.currentHp=100;
state.enemy={id:'foe',name:'目标',currentHp:100,maxHp:100,maxLust:100,currentLust:0,energy:0,maxEnergy:0,block:0,statusEffects:[],abilities:[],actions:[],intent:{type:'attack',description:'',emoji:'?'},nextAction:null,dialogue:'',emoji:'敌'};
const store=new BattleStateStore(state);
const coreState={self:{hp:100,maxHp:100,lust:0,maxLust:100,energy:3,block:0,statusStacks:{}},opponent:{hp:100,maxHp:100,lust:0,maxLust:100,energy:0,block:0,statusStacks:{}}};
const strength=normalizeRuntimeStatusDefinition(BUILTIN_STATUS_DEFINITIONS[0]);
const program=strength.triggers.hold[0];
const modifiers=resolveEffectProgramModifiers(program,coreState,{spentEnergy:0,statusStacks:3});
assert.equal(modifiers[0].operation.damageKind,'attack');
assert.match(describeCompactStatus(BUILTIN_STATUS_DEFINITIONS[0]),/仅攻击伤害/);
assert.match(JSON.stringify(effectProgramToDisplayTags(program)),/仅攻击伤害/);
const runtime=new BattleEffectRuntime(store,{dispatchTriggers:async()=>{},handleLustOverflow:async()=>{},readModifierSources:(side,key)=>side==='player'&&key==='damage_modifier'?modifiers.map(m=>({operation:m.operation,name:'力量'})):[]});
for(const [kind,expected] of [['attack',13],['damage_over_time',10],['retaliation',10],['effect',10],['hp_loss',10]]){
 store.updateEnemy({currentHp:100,block:0});
 const result=await runtime.execute({type:'damage',target:'opponent',amount:10,damageKind:kind},{source:'player'});
 assert.equal(result.hpLost,expected,kind);
}
console.log('PASS builtin status compile/reference closure/save/reward/display and attack-only runtime modifiers');

