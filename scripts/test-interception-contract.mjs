import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'commonjs',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {validateInterceptions}=require('../src/game-core/interception.ts');
const {withAiContentDefinitions}=require('../src/game-core/aiContentJsonSchema.ts');
const {UnifiedEffectExecutor}=require('../src/fish/combat/unifiedEffectExecutor.ts');
const {GameStateManager}=require('../src/fish/core/gameStateManager.ts');
const {DynamicStatusManager}=require('../src/fish/combat/dynamicStatusManager.ts');
const {compactContentToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const definition=(id,intercepts)=>({id,name:id==='ward'?'血月帷幕':id,emoji:'🌙',type:'buff',stacks_change:'keep',triggers:{},intercepts});
const defs=[
 definition('ward',[{id:'halve',window:'before_damage',amount:'max(0,pending_amount - stacks)',when:'self.hp > 1',uses_per_turn:1}]),
 definition('counter',[{id:'skill',window:'before_card_play',subject:'opponent',card_type:'Skill',when:'event_paid_total >= 1',cancel:true,consume_stacks:1}]),
 definition('replace',[{id:'blood',window:'before_damage',priority:3,replace:{energy:-1},uses_per_battle:1}]),
 definition('nested',[{id:'nested',window:'before_damage',replace:{damage:2,to:'self'},uses_per_turn:1}]),
 {...definition('capped',[{id:'after_cap',window:'before_damage',amount:'max(0,pending_amount - 1)'}]),defense:{damage_cap:4}},
 definition('cancel',[{id:'cancel',window:'before_damage',cancel:true}]),
];
const schema=new Ajv2020({strict:false}).compile(withAiContentDefinitions({$ref:'#/$defs/mwgStatusDefinition'}));
for(const d of defs){assert.equal(validateInterceptions(d.intercepts),null);assert.equal(schema(d),true,JSON.stringify(schema.errors));}
assert.ok(validateInterceptions([{id:'bad',window:'before_card_play',amount:3}]));
assert.ok(validateInterceptions([{id:'bad',window:'before_damage',cancel:true,replace:{energy:1}}]));
assert.match(core.describeCompactStatus(defs[0]),/待结算伤害/);
assert.match(compactContentToDisplayTags(defs[1]).map(t=>t.text).join('；'),/费用已支付/);
DynamicStatusManager.getInstance().replaceDefinitions(defs);
const status=(id,stacks=2)=>({id,name:defs.find(d=>d.id===id).name,emoji:'🌙',description:'',type:'buff',stacks});
const enemy=id=>({id,name:id,emoji:'E',currentHp:50,maxHp:50,currentLust:0,maxLust:100,energy:0,maxEnergy:0,block:0,statusEffects:[],orbs:{orbs:[],slots:0},intent:{type:'attack',description:'',emoji:''},actions:[],nextAction:null,dialogue:''});
const store=GameStateManager.getInstance(), executor=UnifiedEffectExecutor.getInstance();
const logs=[];
executor.presentation={addLog:m=>logs.push(m),logStatusEffect:()=>{},showHealthChange:()=>{},showBlockAbsorption:()=>{},showBlockChange:()=>{},showEnergyChange:()=>{},showLustChange:()=>{},showResourceChange:()=>{},refreshPlayerEnergy:()=>{}};
store.resetGame();store.updatePlayer({currentHp:40,maxHp:40,energy:3,maxEnergy:3,block:0,statusEffects:[status('ward',3)]});store.setEnemies([enemy('a'),enemy('b')],'a');
const hit=()=>executor.executeEffectProgram({spec:'mwg.effect/v1',steps:[{op:'damage',target:'opponent',amount:8}]},false,{battleContext:{enemyId:'b'}});
await hit();assert.equal(store.getPlayer().currentHp,35,'subtract stacks before block');
await hit();assert.equal(store.getPlayer().currentHp,27,'per-turn use is exhausted');
const saved=JSON.parse(JSON.stringify(store.getGameState()));assert.equal(saved.player.statusEffects[0].interceptionUses.halve.turnUses,1);
store.replaceState(saved);await hit();assert.equal(store.getPlayer().currentHp,19,'saved per-turn usage remains exhausted after JSON restoration');
store.updatePlayer({currentHp:40,energy:3,block:7,statusEffects:[status('ward',3),status('replace')]});
await hit();assert.equal(store.getPlayer().currentHp,40);assert.equal(store.getPlayer().block,7,'replaced packet consumes no block');assert.equal(store.getPlayer().energy,2);assert.equal(store.getPlayer().statusEffects.find(s=>s.id==='ward').interceptionUses,undefined,'higher priority replacement stops remaining rules');
store.replaceState(JSON.parse(JSON.stringify(store.getGameState())));
await hit();assert.equal(store.getPlayer().block,2,'restored per-battle use remains exhausted and falls through to lower priority reduction');
store.updatePlayer({currentHp:40,block:0,statusEffects:[status('nested')]});await hit();assert.equal(store.getPlayer().currentHp,38,'replacement cannot recursively enter itself');assert.equal(executor.activeInterceptions.size,0);
store.updatePlayer({currentHp:40,block:0,statusEffects:[status('capped',1)]});await hit();assert.equal(store.getPlayer().currentHp,37,'damage cap resolves before pending_amount interception');
store.updatePlayer({currentHp:40,block:0,statusEffects:[status('cancel',1)]});
const damageEventsBefore=store.getGameState().eventJournal.events.filter(e=>e.kind==='damage_resolved').length;await hit();
assert.equal(store.getPlayer().currentHp,40);assert.equal(store.getGameState().eventJournal.events.filter(e=>e.kind==='damage_resolved').length,damageEventsBefore,'cancelled packet emits no original damage event');
store.updatePlayer({currentHp:40,block:0,statusEffects:[],abilities:[{id:'ordinary',name:'普通能力',trigger:'turn_start',intercepts:[{id:'illegal_runtime',window:'before_damage',cancel:true}]}]});
await hit();assert.equal(store.getPlayer().currentHp,32,'ordinary abilities are not interception sources');
store.updateEnemyById('a',{statusEffects:[status('cancel',1)],abilities:[{id:'guard',name:'护卫',trigger:'battle_start',effectProgram:{spec:'mwg.effect/v1',steps:[]},protection:{mode:'intercept',scope:'specific',targetId:'b'}}]});
await executor.executeEffectProgram({spec:'mwg.effect/v1',steps:[{op:'damage',target:'opponent',amount:8}]},true,{battleContext:{enemyId:'b'}});
assert.equal(store.getEnemyById('a').currentHp,50);assert.equal(store.getEnemyById('b').currentHp,50,'cancelled protector packet produces no overflow to original target');
store.updateEnemyById('a',{statusEffects:[],abilities:[]});
store.updateEnemyById('b',{statusEffects:[status('counter',1)]});
const payment=core.resolveCardResourcePayment(1,{energy:3});
assert.equal(await executor.interceptCardPlay({id:'attack',type:'Attack'},payment,0),false);
assert.equal(await executor.interceptCardPlay({id:'skill',type:'Skill'},payment,1),false,'replay has no paid costs');
assert.equal(await executor.interceptCardPlay({id:'skill',type:'Skill'},payment,0),true,'enemy B aura works while A is active');
assert.equal(store.getEnemyById('b').statusEffects.length,0);assert.equal(store.getEnemyById('a').statusEffects.length,0);
// A failed enclosing action restores both the cost and interception use.
store.updatePlayer({statusEffects:[status('replace')],energy:3});store.createSnapshot('intercept');await hit();assert.equal(store.getPlayer().energy,2);store.restoreSnapshot('intercept');assert.equal(store.getPlayer().energy,3);assert.equal(store.getPlayer().statusEffects[0].interceptionUses,undefined);
assert.ok(logs.some(m=>m.includes('血月帷幕')));
const {CardSystem}=require('../src/fish/combat/cardSystem.ts');
const {convertMvuCards}=require('../src/fish/core/mvuBattleAdapter.ts');
const cardSystem=CardSystem.getInstance();
cardSystem.presentation=new Proxy({selectCards:async()=>null},{get:(o,k)=>o[k]||(()=>{})});
store.resetGame();store.setEnemies([enemy('a'),enemy('b')],'a');store.setPhase('player_turn');
const cards=convertMvuCards([
 {id:'rite',name:'献月仪式',type:'Skill',rarity:'Rare',cost:2,quantity:1,payment:{additional:{hp:3,discard:{count:1},sacrifice:{count:1,template_id:'familiar'}}},effects:{block:9}},
 {id:'sly',name:'灵巧献物',type:'Skill',rarity:'Common',cost:1,quantity:1,sly:true,effects:{block:2}},
]);
assert.equal(cards.length,2);store.updatePlayer({hand:cards,currentHp:40,maxHp:40,energy:3,block:0,statusEffects:[]});
store.spawnSummons('player',{id:'familiar',name:'使魔',emoji:'🐈',maxHp:10,attack:1},1);
store.updateEnemyById('b',{statusEffects:[status('counter',1)]});
assert.equal(await cardSystem.playCard(cards[0].id),true);
assert.equal(store.getPlayer().currentHp,37);assert.equal(store.getPlayer().energy,1);
assert.equal(store.getPlayer().block,2,'Sly resolves freely after all fees; enemy counters the paid ritual only');
assert.equal(store.getSummons('player').length,0);assert.equal(store.getPlayer().hand.length,0);
const played=store.getGameState().eventJournal.events.filter(e=>e.kind==='card_played'&&e.phase==='before');
assert.equal(store.getGameState().eventJournal.events.find(e=>e.kind==='summon_defeated').actorId,'player');
assert.equal(played.length,2);const paidRite=played.find(e=>e.cardName==='献月仪式');
assert.equal(paidRite.paidHp,3);assert.equal(paidRite.paidDiscard,1);assert.equal(paidRite.paidSacrifices,1);assert.equal(paidRite.paidTotal,2);
// Choice cancellation uses the real CardSystem transaction, preserving the entire state.
store.updatePlayer({hand:[cards[0],cards[1],{...cards[1],id:'sly_other'}],energy:3});
store.spawnSummons('player',{id:'familiar',name:'使魔',emoji:'🐈',maxHp:10,attack:1},1);
store.updatePlayer({orbs:{orbs:[],slots:0}});
const prior=JSON.stringify(store.getGameState());
assert.equal(await cardSystem.playCard(cards[0].id),false);
assert.deepEqual(JSON.parse(JSON.stringify(store.getGameState())),JSON.parse(prior));
// Summon-local interception never borrows the owner's statuses or usage.
const summon=store.getSummons('player')[0];
const collection=store.readSummons();collection.living[0].statusEffects=[status('ward',3)];store.writeSummons(collection);
const result=await executor.damageSummonsWithDefense([summon.instanceId],8,{owner:'enemy',enemyId:'b'},'effect',false);
assert.equal(result.hits[0].hpLost,5);
assert.equal(store.getSummonById(summon.instanceId).statusEffects[0].interceptionUses.halve.turnUses,1);
assert.equal(store.getPlayer().statusEffects.length,0);
const summons=store.readSummons();summons.living[0].statusEffects=[status('capped',1)];summons.living[0].currentHp=10;summons.living[0].block=0;store.writeSummons(summons);
const cappedSummon=await executor.damageSummonsWithDefense([summon.instanceId],8,{owner:'enemy',enemyId:'b'},'effect',false);
assert.equal(cappedSummon.hits[0].hpLost,3,'summon damage cap resolves before pending_amount interception');
console.log('PASS interception: schema/validation/Chinese display, damage timing/events, priority, cancel/replacement, exact ownership, ordinary-ability filtering, payment filters/replay, nesting, save restoration and rollback');
