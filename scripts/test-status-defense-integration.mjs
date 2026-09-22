import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const Ajv2020=require('webpack/node_modules/ajv/dist/2020.js').default;
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {createTowerInitialContentJsonSchema}=require('../src/game-core/towerRequest.ts');
const defs=[
 {id:'artifact',name:'人工制品',emoji:'🗿',type:'buff',stacks_change:'keep',defense:{negate_debuff:true},triggers:{}},
 {id:'intangible',name:'无实体',emoji:'👻',type:'buff',stacks_change:-1,defense:{damage_cap:1},triggers:{}},
 {id:'buffer',name:'缓冲',emoji:'🫧',type:'buff',stacks_change:'keep',defense:{prevent_hp_loss:true},triggers:{}},
 {id:'bad',name:'坏状态',emoji:'×',type:'debuff',stacks_change:'keep',triggers:{apply:{energy:1},stack:{energy:1}}},
];
const registry=new core.StatusDefinitionRegistry(); assert.equal(registry.replace(defs).rejected.length,0);
const store=new core.BattleStateStore(core.createEmptyBattleState());
const calls=[]; const lifecycle=new core.StatusLifecycleRuntime({state:store,definitions:registry,transactions:{beginTransaction:()=>'',commitTransaction:()=>{},rollbackTransaction:()=>{}},execute:async(...x)=>calls.push(x),dispatch:async()=>{}});
await lifecycle.apply('player','artifact',2); await lifecycle.apply('player','bad',1); await lifecycle.apply('player','bad',1);
assert.equal(store.getPlayer().statusEffects.find(x=>x.id==='artifact'),undefined); assert.equal(store.getPlayer().statusEffects.some(x=>x.id==='bad'),false); assert.equal(calls.length,0,'blocked debuff never applies/stacks');
store.updatePlayer({statusEffects:[{id:'intangible',name:'无实体',emoji:'👻',type:'buff',description:'',stacks:1},{id:'buffer',name:'缓冲',emoji:'🫧',type:'buff',description:'',stacks:2}]});
const runtime=new core.BattleEffectRuntime(store,{readModifierSources:()=>[],dispatchTriggers:async()=>{},handleLustOverflow:async()=>{},capDamageByStatus:async r=>Math.min(r.amount,...store.getPlayer().statusEffects.map(s=>registry.get(s.id)?.defense?.damage_cap).filter(x=>x!==undefined)),preventHpLossByStatus:async()=>lifecycle.consumeLayer('player','buffer')});
store.updatePlayer({block:1,currentHp:20}); let hit=await runtime.execute({type:'damage',target:'opponent',amount:9,damageKind:'attack'},{source:'enemy'}); assert.equal(hit.hpLost,0); assert.equal(store.getPlayer().statusEffects.find(x=>x.id==='buffer').stacks,2,'full block does not consume buffer');
store.updatePlayer({block:0}); hit=await runtime.execute({type:'damage',target:'opponent',amount:9,damageKind:'hp_loss'},{source:'enemy'}); assert.equal(hit.hpLost,0); assert.equal(store.getPlayer().statusEffects.find(x=>x.id==='buffer').stacks,1,'buffer blocks life loss and consumes once');
await lifecycle.processTurnEnd('player'); assert.equal(store.getPlayer().statusEffects.some(x=>x.id==='intangible'),false,'intangible decays at holder turn end');
const multi=core.createEmptyBattleState(); const enemy=(id, stacks)=>({id,name:id,currentHp:20,maxHp:20,currentLust:0,maxLust:10,energy:0,maxEnergy:0,block:0,statusEffects:[{id:'buffer',name:'缓冲',emoji:'🫧',type:'buff',description:'',stacks}],abilities:[],actions:[],intent:{type:'attack',description:'',emoji:'?'},nextAction:null,dialogue:'',emoji:'敌'});
multi.enemies=[enemy('a',2),enemy('b',2)]; multi.activeEnemyId='a'; multi.enemy=multi.enemies[0]; const multiStore=new core.BattleStateStore(multi);
const multiLife=new core.StatusLifecycleRuntime({state:multiStore,definitions:registry,transactions:{beginTransaction:()=>'',commitTransaction:()=>{},rollbackTransaction:()=>{}},execute:async()=>{},dispatch:async()=>{}});
assert.equal(multiStore.beginEnemyResolution('b'),true); await multiLife.consumeLayer('enemy','buffer'); multiStore.endEnemyResolution('b');
assert.equal(multiStore.getEnemyById('a').statusEffects[0].stacks,2); assert.equal(multiStore.getEnemyById('b').statusEffects[0].stacks,1,'bound enemy B alone consumes its buffer');
const defenseOnly={id:'schema_defense',name:'架构防御',emoji:'◇',type:'buff',defense:{prevent_hp_loss:true},triggers:{}};
assert.equal(core.validateCompactStatusDefinition(defenseOnly).ok,true);
assert.equal(core.validateCompactStatusDefinition({...defenseOnly,defense:{unsupported:true}}).ok,false);
const genericSchema=createTowerInitialContentJsonSchema().value; const generic=new Ajv2020({strict:false}).compile({$ref:'#/$defs/mwgStatusDefinition',$defs:genericSchema.$defs});
assert.equal(generic(defenseOnly),true); assert.equal(generic({...defenseOnly,defense:{unsupported:true}}),false);
const initialSchema=createInitialDraftJsonSchema().value; const initial=new Ajv2020({strict:false}).compile({$ref:'#/$defs/mwgStatusDefinition',$defs:initialSchema.$defs});
assert.equal(initial(defenseOnly),true); assert.equal(initial({...defenseOnly,defense:{unsupported:true}}),false);
const blockedAttack=core.resolveAttributeTriggerDispatch({attribute:'hp',change:0,target:'enemy',source:'player',eventContext:{kind:'damage_resolved',damageKind:'attack',actorId:'player',targetId:'enemy'}});
assert.deepEqual(blockedAttack,[],'fully blocked attacks retain zero-delta take_damage/deal_damage semantics; retaliation uses its dedicated hook');
const retaliation=core.resolveAttributeTriggerDispatch({attribute:'hp',change:0,target:'player',source:'enemy',eventContext:{kind:'damage_resolved',damageKind:'retaliation',actorId:'enemy',targetId:'player'}});
assert.deepEqual(retaliation,[],'zero-delta retaliation does not manufacture take_damage/deal_damage events');
console.log('PASS status defense blocks debuffs before lifecycle, caps hp_loss before block, consumes buffer only for actual loss, and decays independently');
