import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {UnifiedEffectExecutor}=require('../src/fish/combat/unifiedEffectExecutor.ts');
const {TavernSummonChoicePresenter}=require('../src/fish/ui/summonChoicePresenter.ts');
const {renderSummonPanel}=require('../src/shared/summonPresentation.ts');
const {collectSummonDisplayNames}=require('../src/game-core/summonDisplayNames.ts');
const {describeCompactCard}=require('../src/game-core/contentDescription.ts');
const compile=effects=>{const r=core.compileCompactEffectList(effects);assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
const definition={id:'tendril',name:'梦触手',emoji:'◆',max_hp:20,slot:'companion',on_existing:'reinforce',
 actions:[{id:'lash',name:'缠绕',effects:{lust:3}}],
 on_existing_effects:[{modify_summon_effect:{selector:{pick:'source'},stat:'lust',add:2}}]};
const spawn=compile({spawn_summon:definition}).steps[0];
const ajv=new Ajv2020({strict:false,allErrors:true});
const {withAiContentDefinitions}=require('../src/game-core/aiContentJsonSchema.ts');
const validate=ajv.compile(withAiContentDefinitions({$ref:'#/$defs/effectList'}));
for(const effects of [[{spawn_summon:definition}],[{trigger_summon_death:{selector:{pick:'all'}}}]])
 assert.equal(validate(effects),true,JSON.stringify(validate.errors));
assert.ok(spawn.summon.onExistingProgram);
assert.equal(core.compileCompactEffectList({spawn_summon:{...definition,slot:undefined}}).ok,false);
const store=new core.BattleStateStore(core.createEmptyBattleState());
const executor=Object.create(UnifiedEffectExecutor.prototype);
executor.gameStateManager=store;executor.executionContext={sourceIsPlayer:true};
executor.presentation={addLog:()=>{},showSummonAction:()=>{}};
const triggers=[];executor.triggerHost={processSummonUnitAbilities:async(unit,event)=>triggers.push([unit.instanceId,event])};
let repeat=0;
executor.executeEffectProgram=async(program,isPlayer,context)=>{
 assert.equal(isPlayer,true);repeat++;
 for(const node of program.steps){assert.equal(node.op,'modify_summon_effects');store.modifySummonEffects([context.summonContext.instanceId],node.stat,node.operator,node.value);}
};
const command={...spawn,type:'spawn_summon'};delete command.op;
await executor.executeSummonCommand(command,true);assert.equal(repeat,0);
const first=store.getSummons('player')[0];assert.ok(first);
await executor.executeSummonCommand(command,true);assert.equal(repeat,1);
const current=store.getSummons('player');assert.equal(current.length,1);assert.equal(current[0].instanceId,first.instanceId);
assert.equal(current[0].maxHp,20,'custom repeat does not also add default HP');
assert.equal(current[0].actions[0].effectProgram.steps[0].amount,5,'repeat actually rewrites action output');
assert.equal(triggers.filter(([,event])=>event==='battle_start').length,1,'repeat is not a new battle start');
const control=compile({trigger_summon_death:{selector:{pick:'all'}}});
assert.equal(control.steps[0].trigger,'defeated');
const before=JSON.stringify(store.readSummons());
await executor.executeSummonCommand({type:'activate_summons',selector:control.steps[0].selector,trigger:'defeated'},true);
assert.equal(JSON.stringify(store.readSummons()),before,'death trigger leaves unit alive');
assert.equal(triggers.at(-1)[1],'defeated');
let immediate=[];executor.activateSelectedSummons=async ids=>immediate=[...ids];
await executor.executeSummonCommand({type:'activate_summons',selector:{owner:'self',pick:'all'}},true);
assert.deepEqual(immediate,[first.instanceId]);
const presenter=TavernSummonChoicePresenter.getInstance(),original=presenter.choose;
let chosen=0;presenter.choose=async list=>{chosen++;return [list[0].instanceId];};
try {
 const selected=await executor.selectSummons({owner:'self',pick:'by_id',id:'tendril'},'player',true);
 assert.equal(chosen,1);assert.equal(selected[0].instanceId,first.instanceId);
 await executor.selectSummons({owner:'self',pick:'by_id',id:first.instanceId},'player',true);
 assert.equal(chosen,1,'real instance ID remains exact');
}finally{presenter.choose=original;}
const pack=core.createContentPack({cards:[{id:'lust',name:'欲望',type:'Attack',rarity:'Common',cost:1,effects:{lust:4}}],playerDesireEffect:{name:'循环',effects:[{draw:2},{heal:5}]}});
const readiness=core.assessInitialPlayerContent(pack);
assert.ok(readiness.issues.some(i=>i.code==='MISSING_DESIRE_VICTORY_ROUTE'));
assert.match(core.formatPlayerContentRepairPrompt(readiness),/保留欲望主轴/);
pack.desireEffects.player.effects.push({damage:40});assert.equal(core.assessInitialPlayerContent(pack).ok,true);
const names=collectSummonDisplayNames({effects:{spawn_summon:definition}});
const description=describeCompactCard({type:'Skill',effects:{modify_summon_effect:{selector:{pick:'choose',template_id:'tendril'},stat:'lust',add:2}}},{summonNames:names});
assert.match(description,/梦触手/);assert.doesNotMatch(description,/tendril/);
const panel=renderSummonPanel({...definition,displayResourceNames:{desire:'欲望精华'},actions:[{name:'缠绕',effects:{summoner_effects:{resource:{id:'desire',amount:1}}}}]});
assert.match(panel,/唯一召唤物/);assert.match(panel,/已在场时再次召唤/);assert.match(panel,/欲望精华/);
assert.doesNotMatch(renderSummonPanel({id:'plain',name:'普通',tags:['summon']}),/存续规则/);
console.log('PASS desire victory gate, template target choice, unique repeat actual output, immediate action, death-only trigger and display names.');

