import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {convertMvuCards}=require('../src/fish/core/mvuBattleAdapter.ts');
const {normalizeCardDefinition}=require('../src/fish/core/battleContentAdapter.ts');
const {TavernBattleEndHost,finalizeRuntimeCardProgression}=require('../src/fish/core/battleEndHost.ts');
const {UnifiedEffectExecutor}=require('../src/fish/combat/unifiedEffectExecutor.ts');
const {GameStateManager}=require('../src/fish/core/gameStateManager.ts');
const terminal=Object.create(GameStateManager.prototype);
terminal.gameState={...core.createEmptyBattleState(),phase:'game_over',isGameOver:true};
const variablesApi=require('../src/runtime/messageVariables.ts');
const originalRead=variablesApi.getCurrentMessageVariables;let readAfterEnd=0;
variablesApi.getCurrentMessageVariables=()=>{readAfterEnd++;return {};};
try{terminal.syncNewCardsFromMVU();assert.equal(readAfterEnd,0,'terminal display does not sync cards or advance random state');}finally{variablesApi.getCurrentMessageVariables=originalRead;}
const {settleTavernBattleVariables}=require('../src/runtime/battleSettlementAdapter.ts');
const {createBattleRequestFromMvu}=require('../src/fish/core/battleContractAdapter.ts');
const {selectStartGreeting}=require('../src/start/startGreeting.ts');
const greeting={swipes:['入口','[开始游戏]\n[剧情模式开场]','[开始游戏]\n[爬塔模式开场]']}, greetingBefore=structuredClone(greeting),selected=[];
const ports={isLatest:()=>true,messageId:()=>0,read:()=>greeting,select:async(id,swipe)=>selected.push([id,swipe])};
await selectStartGreeting('story',ports);await selectStartGreeting('tower',ports);
assert.deepEqual(selected,[[0,1],[0,2]]);assert.deepEqual(greeting,greetingBefore);
await assert.rejects(selectStartGreeting('tower',{...ports,isLatest:()=>false}),/最新/);
await assert.rejects(selectStartGreeting('tower',{...ports,read:()=>({swipes:['入口']})}),/没有找到/);
const compile=effects=>{const r=core.compileCompactEffectList(effects);assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
const cards=core.migratePersistentRunDeck([
 {id:'strike',name:'攻击',type:'Attack',rarity:'Common',cost:1,effects:{damage:6}},
 {id:'growth',name:'灌注',type:'Skill',rarity:'Rare',quantity:2,cost:1,effects:[{persistent_growth:'max_hp',add:1},{persistent_growth:'max_lust',add:1}]},
 {id:'evolve',name:'召唤强化',type:'Skill',rarity:'Rare',quantity:2,cost:1,effects:[{modify_summon_effect:{selector:{pick:'all'},stat:'damage',add:2}},{persistent_growth:'max_hp',add:2}]},
]);
assert.equal(convertMvuCards(cards).length,5,'growth cards enter the runtime deck');
for(const card of cards.slice(1)) assert.match(core.describeCompactCard(card),/永久/);
assert.ok(normalizeCardDefinition({id:'power',name:'成长',type:'Power',rarity:'Rare',cost:1,trigger:{on:'turn_start',effects:{persistent_growth:'max_hp',add:1}}}),'detached player trigger retains growth authorization');

// Existing terminal sessions lost these cards before v425: keep unchanged
// definitions and real earned growth without granting unplayed card effects.
const initial=core.createEmptyBattleState();initial.player.deck=convertMvuCards(cards.slice(0,1));
initial.battleRequest={content:{cards},seed:42,route:{nodeId:'one'}};
const store=new core.BattleStateStore(initial);
const vars={stat_data:{battle:{cards:structuredClone(cards)}}};
const recovered=finalizeRuntimeCardProgression(store,vars,false);
assert.deepEqual(recovered,cards);
assert.equal(store.getPlayer().deck.length,5);
assert.equal(store.getGameState().persistentGrowth.length,0);
const changed=structuredClone(vars);changed.stat_data.battle.cards[1].effects=[{damage:99}];
assert.throws(()=>finalizeRuntimeCardProgression(new core.BattleStateStore(initial),changed,false),/no longer matches/,'unrelated changes are never silently merged');

const template={id:'pet',name:'守卫',emoji:'◆',max_hp:10,actions:[{id:'hit',name:'打击',effects:[{damage:3},{lust:2}]}]};
const definition=compile({spawn_summon:template}).steps[0].summon;
const growthEffects=[{persistent_growth:'damage',summon_template:'pet',add:2},{persistent_growth:'lust',summon_template:'pet',add:1},{persistent_growth:'max_hp',summon_template:'pet',add:5}];
const growthProgram=compile(growthEffects);
const ajv=new Ajv2020({strict:false});
const {withAiContentDefinitions}=require('../src/game-core/aiContentJsonSchema.ts');
const compactSchema=ajv.compile(withAiContentDefinitions({$ref:'#/$defs/effectList'}));
assert.equal(compactSchema(growthEffects),true,JSON.stringify(compactSchema.errors));
assert.equal(compactSchema([{persistent_growth:'damage',add:2}]),false);
const portable=ajv.compile(JSON.parse(fs.readFileSync('schemas/mwg-effect-v1.schema.json')));
assert.equal(portable(growthProgram),true,JSON.stringify(portable.errors));
const battle=new core.BattleStateStore(core.createEmptyBattleState());
battle.spawnSummons('player',definition,1);battle.spawnSummons('enemy',definition,1);
const executor=Object.create(UnifiedEffectExecutor.prototype);executor.gameStateManager=battle;executor.executionContext={};executor.presentation={addLog:()=>{}};
for(const node of growthProgram.steps) await executor.executePersistentGrowth({...node,type:'persistent_growth'},true);
const live=battle.getSummons('player')[0];assert.equal(live.maxHp,15);assert.equal(live.currentHp,10,'max HP growth is not healing');
assert.deepEqual(live.actions[0].effectProgram.steps.map(n=>n.amount),[5,3]);
assert.equal(battle.getSummons('enemy')[0].maxHp,10);
battle.spawnSummons('player',definition,1);assert.equal(battle.getSummons('player')[1].maxHp,15,'future summons inherit');
const restored=new core.BattleStateStore(JSON.parse(JSON.stringify(battle.getGameState())));
restored.spawnSummons('player',definition,1);assert.equal(restored.getSummons('player')[2].actions[0].effectProgram.steps[0].amount,5,'session reload does not double-apply');
const canonical={stat_data:{battle:{core:{hp:20,max_hp:20,lust:0,max_lust:100},cards,items:[],artifacts:[],statuses:[],enemy:{name:''}}}};
const settlement={result:'defeat',player:{currentHp:10,currentLust:0},turns:3,persistentGrowth:battle.getGameState().persistentGrowth};
settleTavernBattleVariables(canonical,settlement);settleTavernBattleVariables(canonical,settlement);
assert.equal(canonical.stat_data.battle.core.summon_growth.length,3,'atomic receipts prevent repeated growth');
const nextPack=require('../src/runtime/contentPackAdapter.ts').createContentPackFromMvuBattle(canonical.stat_data.battle);
const nextBattle=new core.BattleStateStore({...core.createEmptyBattleState(),summonGrowth:nextPack.playerSummonGrowth});
nextBattle.spawnSummons('player',definition,1);assert.equal(nextBattle.getSummons('player')[0].maxHp,15,'next encounter inherits from canonical state');
await assert.rejects(executor.executePersistentGrowth({...growthProgram.steps[0],type:'persistent_growth'},false),/only/);
const ownerProgram=compile({spawn_summon:{...template,actions:[{id:'grow',name:'成长',effects:{summoner_effects:{persistent_growth:'damage',summon_template:'pet',add:1}}}]}});
assert.equal(core.validateEffectProgramPolicy(ownerProgram,{allowPersistentGrowth:true}).ok,true);
assert.equal(core.validateEffectProgramPolicy(ownerProgram,{allowPersistentGrowth:false}).ok,false);

let key=1,saved=0,failSave=false,failSettle=false,opened=0,rollbacks=0;
const host=new TavernBattleEndHost({}, {
 getState:()=>({player:{currentHp:10,currentLust:0},currentTurn:2,battleRequest:{seed:key,route:{nodeId:String(key)}}}),
 saveBattleSession:async()=>{if(failSave)throw Error('save failed');},
 readVariables:()=>({stat_data:{}}),replaceVariables:async()=>{rollbacks++;},reloadBattleState:async()=>true,
 clearBattleSession:async()=>{},settleBattle:async()=>{if(failSettle)throw Error('settle failed');saved++;},openCommonView:()=>{opened++;},reloadPage:()=>{},
});
await host.confirmTowerBattleEnd('victory');await host.confirmTowerBattleEnd('victory');assert.equal(saved,1);
key=2;await host.confirmTowerBattleEnd('victory');assert.equal(saved,2,'second battle is not blocked by first lock');
key=3;failSave=true;await assert.rejects(host.confirmTowerBattleEnd('victory'),/save failed/);failSave=false;await host.confirmTowerBattleEnd('victory');assert.equal(saved,3);
key=4;failSettle=true;await assert.rejects(host.confirmTowerBattleEnd('victory'),/settle failed/);assert.equal(rollbacks,1);failSettle=false;await host.confirmTowerBattleEnd('victory');assert.equal(opened,4);
const contract=core.formatCompactEffectAuthoringContract('initial-draft');
assert.match(contract,/提高一个角色自己的欲望上限通常是加强/);assert.match(contract,/不能标作我方增益/);assert.match(contract,/跨战斗保留/);
let restoredDialogs=0,restoredLogs=0;
const presentationState={...core.createEmptyBattleState(),isGameOver:true,phase:'game_over',battleResult:'victory'};
const presentationHost=new TavernBattleEndHost({}, {getState:()=>presentationState,readVariables:()=>({stat_data:{}})}, {
 hasBattleEndDialog:()=>false,showBattleEndDialog:()=>{restoredDialogs++;},addLog:()=>{restoredLogs++;},
});
presentationHost.resumeBattleEndDialog();await new Promise(resolve=>setImmediate(resolve));
assert.equal(restoredDialogs,1);assert.equal(restoredLogs,0,'resuming a result must not append another battle event');
console.log('PASS growth cards load, old terminal-session recovery, persistent summon runtime/reload/settlement/schema, ownership, repeated battles and failure retries.');
