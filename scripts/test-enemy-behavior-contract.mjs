import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core');
const {convertMvuEnemies,convertMvuCards}=require('../src/fish/core/mvuBattleAdapter.ts');
const {GameStateManager}=require('../src/fish/core/gameStateManager.ts');
const {UnifiedEffectExecutor}=require('../src/fish/combat/unifiedEffectExecutor.ts');
const {CardSystem}=require('../src/fish/combat/cardSystem.ts');
const {preflightBattleContent}=require('../src/fish/core/battleContentPreflight.ts');
const {validateEnemyActionReferences}=require('../src/game-core/enemyActionReferences.ts');
const compile=x=>{const r=core.compileCompactEffectList(x);assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
const definition=(id,extra={})=>({id,name:'守卫'+id,emoji:'👹',hp:20,max_hp:20,lust:0,max_lust:100,actions:[{id:'wait',name:'观望',dialogue:'再等等',effects:{wait:true}},{id:'guard',name:'防守',dialogue:'休想过去',effects:{block:7,to:'self'}}],...extra});
const store=GameStateManager.getInstance(),executor=UnifiedEffectExecutor.getInstance(),cards=CardSystem.getInstance();
const logs=[],deaths=[],outcomes=[];
const presentation=new Proxy({addLog:text=>logs.push(text),showEnemyDefeat:id=>deaths.push(id)},{get:(o,k)=>o[k]||(()=>{})});
executor.presentation=presentation;cards.presentation=presentation;executor.completeBattleEnd=async result=>{outcomes.push(result);};
function reset(defs){store.resetGame();store.setCurrentTurn(1);store.setPhase('player_turn');store.setEnemies(convertMvuEnemies(defs,()=>0));store.updatePlayer({currentHp:50,maxHp:50,energy:3,maxEnergy:3,hand:[],deck:[],abilities:[],relics:[],statusEffects:[]});logs.length=0;deaths.length=0;outcomes.length=0;}
// Independent duplicates, collisions, reserve isolation and real AoE/reinforcement execution.
reset([definition('a',{quantity:3}),definition('a_copy_2'),definition('b',{quantity:3})]);
assert.equal(new Set([...store.getEnemies(),...store.getReserveEnemies()].map(e=>e.id)).size,7);
assert.equal(store.getReserveEnemies().length,2);
assert.ok(store.getReserveEnemies().every(e=>e.nextAction===null));
await executor.executeEffectProgram(compile({damage:2,targets:{mode:'all'}}),true);
assert.ok(store.getEnemies().every(e=>e.currentHp===18));
assert.ok(store.getReserveEnemies().every(e=>e.currentHp===20));
const killed=store.getEnemies()[2].id;store.setActiveEnemy(killed);
await executor.executeEffectProgram(compile({damage:30}),true,{battleContext:{enemyId:killed}});
assert.ok(deaths.includes(killed));assert.equal(store.getReserveEnemies().length,1);assert.ok(store.getEnemies().find(e=>e.stageSlot===2)?.nextAction);
assert.equal(outcomes.length,0);
const saved=JSON.parse(JSON.stringify(store.getGameState()));store.replaceState(saved);assert.equal(store.getReserveEnemies().length,1);
// An authored support action changes its executable branch after its last ally
// dies; restoring the same intent must not bring back the dead-target branch.
const supportAction={id:'support_or_counter',name:'协助或反击',effects:[
  {block:6,to:'self',targets:{mode:'all'},when:'self.ally_count > 0'},
  {damage:9,to:'opponent',when:'self.ally_count == 0'},
]};
reset([definition('support',{actions:[supportAction],description:'失去同伴后会反击。'}),definition('escort')]);
const supportProgram=store.getEnemyById('support').actions[0].effectProgram;
await executor.executeEffectProgram(supportProgram,false,{battleContext:{enemyId:'support'}});
assert.equal(store.getEnemyById('escort').block,6);assert.equal(store.getPlayer().currentHp,50);
store.setActiveEnemy('escort');
await executor.executeEffectProgram(compile({kill:true}),true);
store.replaceState(JSON.parse(JSON.stringify(store.getGameState())));
const support=store.getEnemyById('support');assert.match(support.dialogue,/反击/);
const blockBefore=support.block;
await executor.executeEffectProgram(support.actions[0].effectProgram,false,{battleContext:{enemyId:'support'}});
assert.equal(store.getPlayer().currentHp,41);assert.equal(store.getEnemyById('support').block,blockBefore);
assert.match(core.effectProgramToDisplayTags(supportProgram).map(x=>x.text).join(' '),/9/);
// Explicit goal ignores reserves, but a successful defeated revival does not win.
reset([definition('boss',{victory_on_defeat:true}),...Array.from({length:5},(_,i)=>definition('minion'+i))]);
await executor.executeEffectProgram(compile({damage:30}),true,{battleContext:{enemyId:'boss'}});
assert.deepEqual(outcomes,['victory']);assert.equal(store.getReserveEnemies().length,1);
reset([definition('reviver',{victory_on_defeat:true,abilities:[{id:'revive',name:'复活',trigger:{on:'defeated',effects:{heal:5,to:'self'}}}]}),definition('other')]);
await executor.executeEffectProgram(compile({damage:30}),true,{battleContext:{enemyId:'reviver'}});
assert.equal(store.getEnemyById('reviver').currentHp,5);assert.deepEqual(outcomes,[]);assert.deepEqual(deaths,[]);
// Player card event -> filtered enemy reaction -> own intention, save, frozen action queue.
const reaction={id:'react',name:'应对技能',trigger:{on:'card_played',scope:'combat',actor_id:'player',card_type:'Skill',effects:[{enemy_intent:'guard'},{say:'我看穿了你的动作'}]}};
reset([definition('reactor',{abilities:[reaction]}),definition('idle'),...Array.from({length:4},(_,i)=>definition('reserve'+i,{abilities:[reaction]}))]);
const played=convertMvuCards([{id:'skill',name:'观察',type:'Skill',rarity:'Common',cost:0,quantity:1,dialogue:'试试看',effects:{wait:true}}])[0];
store.updatePlayer({hand:[played],deck:[played]});assert.equal(await cards.playCard(played.id),true);
assert.equal(store.getEnemyById('reactor').nextAction.id,'guard');assert.equal(store.getEnemyById('idle').nextAction.id,'wait');assert.equal(store.getReserveEnemies()[0].nextAction,null);
assert.ok(logs.some(x=>x.includes('我看穿了你的动作')));assert.ok(logs.some(x=>x.includes('试试看')));
store.replaceState(JSON.parse(JSON.stringify(store.getGameState())));
const plan=core.prepareEnemyActionQueue(store.getEnemies(),store.getGameState().random||core.createBattleRandomState(3));
assert.equal(plan.entries.find(x=>x.enemyId==='reactor').action.id,'guard');
await executor.executeEffectProgram(plan.entries.find(x=>x.enemyId==='reactor').action.effectProgram,false,{battleContext:{enemyId:'reactor'}});assert.equal(store.getEnemyById('reactor').block,7);
assert.equal(validateEnemyActionReferences(definition('bad',{abilities:[{...reaction,trigger:{...reaction.trigger,effects:{enemy_intent:'missing'}}}]}),'enemy')[0].code,'UNKNOWN_ENEMY_ACTION');
const spawn={spawn_enemy:definition('child',{victory_on_defeat:true,abilities:[reaction]})};const program=compile(spawn);
assert.match(core.describeCompactEffectList(spawn),/防守/);assert.match(core.effectProgramToDisplayTags(program).map(x=>x.text).join(' '),/防守/);
assert.match(core.describeCompactEffectList(spawn),/最终击倒即胜利/);
const summon={spawn_summon:{id:'s',name:'卫兵',emoji:'🛡',max_hp:5,count:5,actions:[{id:'idle',name:'待机',dialogue:'遵命',effects:{wait:true}}]}};
reset([definition('summoner')]);await executor.executeEffectProgram(compile(summon),false,{battleContext:{enemyId:'summoner'}});assert.equal(store.getSummons('enemy').length,5);
await executor.executeEffectProgram(compile(summon),true);assert.equal(store.getSummons('player').length,3);
assert.equal(compile(summon).steps[0].summon.actions[0].dialogue,'遵命');
assert.match(core.describeCompactEffectList(summon),/敌方默认无上限/);
assert.match(core.effectProgramToDisplayTags(compile(summon)).map(x=>x.text).join(' '),/敌方默认无上限/);
// Authoritative preflight, schema and bounded repair diagnostics share the new fields.
const battle={core:{emoji:'🧙',hp:50,max_hp:50,lust:0,max_lust:100},cards:[{id:'observe',name:'观察',type:'Skill',rarity:'Common',cost:0,quantity:1,dialogue:'观察中',effects:{wait:true}}],artifacts:[],items:[],statuses:[],player_abilities:[],player_status_effects:[],player_lust_effect:{name:'满溢',effects:{wait:true}},enemies:[definition('reactor',{quantity:3,victory_on_defeat:true,abilities:[reaction]})]};
assert.equal(preflightBattleContent(battle).ok,true,JSON.stringify(preflightBattleContent(battle).issues));
const bad=structuredClone(battle);bad.enemies[0].abilities[0].trigger.effects[0].enemy_intent='missing';
const invalid=preflightBattleContent(bad);assert.equal(invalid.ok,false);
assert.ok(invalid.issues.some(x=>x.code==='UNKNOWN_ENEMY_ACTION'&&x.path.endsWith('.enemy_intent')));
const {formatBattleContentRepairPrompt}=require('../src/fish/core/battleContentPreflight.ts');
assert.match(formatBattleContentRepairPrompt(invalid.issues),/UNKNOWN_ENEMY_ACTION/);
const malformed=structuredClone(battle);malformed.enemies[0].actions[0].dialogue='';assert.equal(preflightBattleContent(malformed).ok,false);
const invalidSpawn={spawn_enemy:definition('bad',{actions:[{id:'wait',name:'无效切换',effects:{enemy_intent:'missing'}}]})};
assert.equal(core.compileCompactEffectList(invalidSpawn).ok,false);
const {default:Ajv2020}=await import('webpack/node_modules/ajv/dist/2020.js');
const publicSchema=JSON.parse(fs.readFileSync('schemas/mwg-card-effects-v1.schema.json','utf8'));
const validate=new Ajv2020({strict:false}).compile(publicSchema);
for(const effect of [{wait:true},{say:'你好'},{enemy_intent:'guard'},summon,spawn]) assert.equal(validate({effects:effect}),true,JSON.stringify(validate.errors));
for(const effect of [{wait:false},{say:''},{enemy_intent:''}]) assert.equal(validate({effects:effect}),false);
fs.writeFileSync('tmp/v458-mechanism-contract.json',JSON.stringify({quantity:true,reserveDamageIsolation:true,admission:true,saveRestore:true,objectiveVictory:true,revival:true,reactivePlayerCard:true,scopedIntent:true,dialogue:true,capacity:true,display:true,realModel:false},null,2));
console.log('v458 production enemy behavior/formation/dialogue/capacity contracts passed');

