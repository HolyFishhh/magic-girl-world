import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets:plan,parseTowerInitialSlotRepairResponse:parse,mergeTowerInitialSlotRepair:merge}=require('../src/sillytavern-extension/controller.ts');
const core=require('../src/game-core/index.ts');
const {presentCompactContent}=require('../src/game-core/contentPresentation.ts');
const {cardExecutionContractClauses}=require('../src/game-core/cardAuthoringContract.ts');
const error='battle.cards[0].effects：规则字段不符合浅层 effects 契约（校验代码：SINGLE_NARRATE_REQUIRED，具体原因：Event 主效果必须且只能包含一个顶层 narrate）';
const card={id:'spread_seal',name:'扩散刻印',type:'Event',rarity:'Rare',cost:3,unique:true,quantity:1,lifecycle:{on_play:'exhaust'},description:'永久使所有小刀牌获得群体攻击且伤害+1，本牌消耗。',effects:[
  {patch_card:'area',name_contains:'小刀',from:'combat',pick:'all',scope:'permanent',match:'filter',future_copies:true},
  {patch_card:'damage',name_contains:'小刀',from:'combat',pick:'all',scope:'permanent',match:'filter',future_copies:true,add:1},
]};
const original={narrative:'保留剧情',player:{cards:[card,{id:'other',name:'其他牌',type:'Skill',cost:1,rarity:'Common',quantity:1,effects:{block:5}}]},opening:{choices:[]}};
const before=structuredClone(original),targets=plan(original,error);
assert.equal(targets.length,1);assert.equal(targets[0].slots.length,1);
assert.deepEqual(targets[0].slots.map(s=>({kind:s.kind,path:s.path,original:s.original})),[{kind:'card_type',path:'player.cards[0].type',original:'Event'}]);
const response={spec:core.TOWER_INITIAL_SLOT_REPAIR_SPEC,roots:{r0:{slots:{s0:{action:'replace_value',value:'Skill'}}}},support_statuses:[],support_resources:[]};
const validate=new Ajv2020({strict:false}).compile(core.createTowerInitialSlotRepairJsonSchema(targets).value);
assert.equal(validate(response),true,JSON.stringify(validate.errors));
const repaired=merge(original,targets,parse(response,targets));
const expected=structuredClone(original);expected.player.cards[0].type='Skill';
assert.deepEqual(repaired,expected);assert.deepEqual(original,before,'planning and merging do not mutate the rejected candidate');
const bad=core.validateContentPackContract(core.createContentPack({cards:original.player.cards}));
assert.equal(bad.ok,false);assert.match(JSON.stringify(bad),/SINGLE_NARRATE_REQUIRED/);
const good=core.validateContentPackContract(core.createContentPack({cards:JSON.parse(JSON.stringify(repaired.player.cards))}));
assert.equal(good.ok,true,JSON.stringify(good));
assert.deepEqual(core.compileCompactEffectList(repaired.player.cards[0].effects),core.compileCompactEffectList(card.effects),'all executable effects remain identical');
const groups=presentCompactContent(repaired.player.cards[0],'card').rulesGroups;
assert.equal(groups.length,2);
for(const group of groups){assert.match(group,/名称包含「小刀」/);assert.match(group,/永久/);assert.match(group,/之后生成的同类牌也生效/);assert.doesNotMatch(group,/combat|Event|name_contains/);}
assert.match(groups[0],/所有敌人/);assert.match(groups[1],/伤害增加1/);
for(const value of ['Event','Power','Curse',{type:'Skill',effects:{damage:99}}]){
 const invalid=structuredClone(response);invalid.roots.r0.slots.s0.value=value;
 assert.equal(validate(invalid),false);assert.throws(()=>parse(invalid,targets));
}
const illegalWrite=structuredClone(response);illegalWrite.roots.r0.slots.extra={action:'replace_value',value:99};
assert.throws(()=>parse(illegalWrite,targets));
for(const patch of [
 {effects:{narrate:'只有叙事'}}, {effects:[{narrate:'叙事'},{damage:1}]}, {effects:[]},
 {effects:{invalid:1}}, {effects:{modify:'damage',add:1}},
 {trigger:{on:'turn_start',effects:{block:1}}}, {type:'Skill'},
])assert.deepEqual(plan({...original,player:{cards:[{...card,...patch}]}},error),[],'cannot misclassify a narrative, mixed, illegal or triggered card');
assert.deepEqual(plan(original,error+'；battle.cards[0].unknown：未知字段'),[],'unmapped sibling errors keep the write set closed');
assert.match(cardExecutionContractClauses().join('\n'),/Event 专用于纯叙事卡/);
console.log('PASS Event functional-card repair changes only type, preserves growth and display, validates through public schema/contract, rejects narrative and unsafe repairs.');
