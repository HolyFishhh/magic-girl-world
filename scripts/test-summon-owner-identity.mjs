import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {GameStateManager}=require('../src/fish/core/gameStateManager.ts');
const {UnifiedEffectExecutor}=require('../src/fish/combat/unifiedEffectExecutor.ts');
const {BattleManager}=require('../src/fish/combat/battleManager.ts');
const {createBattleRequestFromMvu}=require('../src/fish/core/battleContractAdapter.ts');
const store=GameStateManager.getInstance(),executor=UnifiedEffectExecutor.getInstance(),manager=BattleManager.getInstance();
const messages=[];
executor.presentation=new Proxy({addLog:text=>messages.push(text)},{get:(object,key)=>object[key]||(()=>undefined)});
const compile=effects=>{const r=core.compileCompactEffectList(effects);assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
const battle={core:{emoji:'◇',hp:40,max_hp:40,lust:0,max_lust:30},cards:[],statuses:[],artifacts:[],items:[],
  enemies:[['left','left_stance'],['right','right_stance']].map(([id,stance])=>({id,name:id==='left'?'左侧':'右侧',emoji:'◇',
    hp:50,max_hp:50,lust:0,max_lust:30,stance:{id:stance,name:id==='left'?'左侧姿态':'右侧姿态'},
    actions:[{id:'wait',name:'等待',effects:{block:1}}]}))};
const companion={id:'companion',name:'随从',emoji:'◇',max_hp:5,actions:[{id:'guard',name:'护卫',effects:[
  {block:1},{summoner_effects:[{block:2},{block:7,when:"self.stance == 'right_stance'"}]},
]}]};
function reset(){store.convertMVUToGameState(createBattleRequestFromMvu({stat_data:{battle}},battle));messages.length=0;}
async function spawn(enemyId='right',definition=companion){
  await executor.executeEffectProgram(compile({spawn_summon:definition,to:'self'}),false,{battleContext:{enemyId}});
  return store.getSummons('enemy').at(-1);
}
function restored(){const saved=JSON.stringify(store.getGameState());store.replaceState(JSON.parse(saved));assert.equal(JSON.stringify(store.getGameState()),saved);}
const blocks=()=>({left:store.getEnemyById('left')?.block||0,right:store.getEnemyById('right')?.block||0});

// Same production path as the captured red probe. No manual actor state or effect repair.
reset();const unit=await spawn();assert.equal(unit.summonerId,'right');assert.equal(store.getEnemy().id,'left');
restored();await executor.processSummonActions('enemy');
assert.deepEqual(blocks(),{left:0,right:9});assert.equal(store.getSummonById(unit.instanceId).block,1);
assert.equal(store.getEnemy().id,'left','source binding does not change selected target');
const acted=store.getGameState().eventJournal.events.find(e=>e.kind==='summon_acted'&&e.summonId===unit.instanceId);
assert.equal(acted.cause.source.ownerId,'right','journal source attribution follows persisted identity');
await executor.executeEffectProgram(compile({summoner_effects:{block:3}}),false,
  {summonContext:store.getSummonById(unit.instanceId),battleContext:{enemyId:'left'}});
assert.deepEqual(blocks(),{left:0,right:12},'incidental context cannot steal ownership');
await executor.executeEffectProgram(compile({spawn_summon:{id:'child',name:'次级随从',emoji:'◇',max_hp:2},to:'self'}),false,
  {summonContext:store.getSummonById(unit.instanceId),battleContext:{enemyId:'left'}});
assert.equal(store.getSummons('enemy').find(x=>x.templateId==='child').summonerId,'right',
  'nested summon creation retains the root owning combatant, not an incidental enemy');

// All listener and scheduler entry points share the binding and restore it afterward.
reset();const listening=await spawn('right',{...companion,abilities:[{id:'turn_guard',name:'回合护卫',
  trigger:{on:'turn_start',effects:{summoner_effects:{block:4}}}}]});
await executor.triggerHost.processSummonUnitAbilities(listening,'turn_start');
assert.deepEqual(blocks(),{left:0,right:4});
const status={id:'owner_tick',name:'主人脉冲',emoji:'◇',type:'buff',stacks_change:0,
  triggers:{tick:{summoner_effects:{block:2}}}};
// Summoner-only status programs use the existing summon-status execution context.
const tickProgram=compile(status.triggers.tick);
await executor.executeEffectProgram(tickProgram,false,{summonContext:listening,summonStatusContext:{summonId:listening.instanceId},
  statusContext:{id:status.id,stacks:1},battleContext:{enemyId:'left'}});
assert.deepEqual(blocks(),{left:0,right:6});
await executor.executeEffectProgram(compile({summoner_effects:{schedule:1,phase:'turn_start',effects:{block:5}}}),false,
  {summonContext:listening});
assert.equal(store.readEffectScheduler().queue.length,1);restored();
store.setCurrentTurn(store.getGameState().currentTurn+1);
await manager.executeScheduledPhase('turn_start');
assert.deepEqual(blocks(),{left:0,right:11});assert.equal(store.readEffectScheduler().queue.length,0);
assert.equal(store.getEnemy().id,'left');

// Dead, removed, and genuinely ambiguous old owners never become another living enemy.
for(const kind of ['dead','removed','legacy','explicit_unknown']){
  reset();const orphan=await spawn();
  if(kind==='dead')store.updateEnemyById('right',{currentHp:0});
  if(kind==='removed')store.setEnemies([store.getEnemyById('left')],'left');
  if(kind==='legacy'||kind==='explicit_unknown'){
    const summons=store.readSummons();
    if(kind==='legacy')delete summons.living[0].summonerId;else summons.living[0].summonerId=null;
    store.writeSummons(summons,'legacy_fixture');
  }
  restored();await executor.processSummonActions('enemy');
  assert.equal(store.getEnemyById('left').block,0,kind);
  assert.equal(store.getSummonById(orphan.instanceId).block,1,'unrelated summon-local action remains intact');
  assert.ok(messages.some(m=>/主人.+本次主人效果未执行/.test(m)),kind+' explicit diagnostic');
  const record=store.getGameState().eventJournal.events.find(e=>e.kind==='summon_acted');
  assert.equal(record.cause.source.ownerId,kind==='legacy'||kind==='explicit_unknown'?'unknown:summoner':'right',
    'historical known owner survives removal; unknown source never impersonates a living entity');
  // A delayed owner-scope program enters executeEffectProgram directly.
  await executor.executeEffectProgram(compile({block:99}),false,
    {summonContext:store.getSummonById(orphan.instanceId),summonSelfTargetsOwner:true,battleContext:{enemyId:'left'}});
  assert.equal(store.getEnemyById('left').block,0,kind+' delayed scope does not fall through');
}

// Ownership-local companion slots: two enemies must never reinforce/revive one another's unit.
let collection=core.createSummonCollectionState();
const slotted={id:'pet',name:'随从',emoji:'◇',maxHp:5,slot:'partner',onExisting:'reinforce',onDefeated:'revive_reset'};
function coreSpawn(who){const r=core.spawnSummonUnits(collection,'enemy',slotted,1,10,'reject',1,who);collection=r.state;return r.spawned[0];}
const leftPet=coreSpawn('left'),rightPet=coreSpawn('right');
assert.notEqual(leftPet.instanceId,rightPet.instanceId);assert.equal(collection.living.length,2);
assert.equal(coreSpawn('right').maxHp,10);assert.equal(collection.living.find(x=>x.instanceId===leftPet.instanceId).maxHp,5);
collection=core.damageSummonUnits(collection,[rightPet.instanceId],99,true).state;
const revived=coreSpawn('right');assert.equal(revived.instanceId,rightPet.instanceId);assert.equal(revived.summonerId,'right');
assert.equal(collection.living.find(x=>x.instanceId===leftPet.instanceId).maxHp,5);

// Copy 'same' keeps the original concrete owner; explicit transfers get the recipient owner.
reset();const source=await spawn();
const copy=to=>compile({copy_summon:{selector:{owner:'opponent',pick:'by_id',id:source.instanceId},to,capacity:10}});
await executor.executeEffectProgram(copy('same'),true);
const sameCopy=store.getSummons('enemy').find(x=>x.instanceId!==source.instanceId);
assert.ok(sameCopy);assert.equal(sameCopy.summonerId,'right');
await executor.executeEffectProgram(copy('self'),true);
const playerCopy=store.getSummons('player')[0];assert.equal(playerCopy.summonerId,'player');
await executor.executeEffectProgram(compile({summoner_effects:{block:3}}),true,{summonContext:playerCopy});
assert.equal(store.getPlayer().block,3);
assert.deepEqual(blocks(),{left:0,right:0});
await executor.executeEffectProgram(compile({copy_summon:{selector:{owner:'self',pick:'by_id',id:source.instanceId},to:'self',capacity:10}}),false,
  {battleContext:{enemyId:'left'}});
const transferred=store.getSummons('enemy').find(x=>x.summonerId==='left');
assert.ok(transferred);assert.equal(store.getSummonById(source.instanceId).summonerId,'right');
await executor.executeEffectProgram(compile({summoner_effects:{block:4}}),false,{summonContext:transferred});
assert.deepEqual(blocks(),{left:4,right:0},'explicit same-side enemy transfer has a new concrete owner');
// Program-owned old player identity is unambiguous, and requires no new authored field.
const legacyPlayer=store.readSummons();delete legacyPlayer.living.find(x=>x.instanceId===playerCopy.instanceId).summonerId;
store.writeSummons(legacyPlayer,'legacy_player_fixture');
await executor.executeEffectProgram(compile({summoner_effects:{block:1}}),true,{summonContext:store.getSummonById(playerCopy.instanceId)});
assert.equal(store.getPlayer().block,4);

// Finally restoration on errors, without removing another frame's enemy binding.
const previousHost=executor.effectCommandHost.executeProgram;
store.beginEnemyResolution('left');
try{
  executor.effectCommandHost.executeProgram=async()=>{assert.equal(store.getEnemy().id,'right');throw Error('injected-owner-failure');};
  await assert.rejects(executor.executeEffectProgram(compile({block:1}),false,{summonContext:source}),/injected-owner-failure/);
  assert.equal(store.getEnemy().id,'left');
}finally{executor.effectCommandHost.executeProgram=previousHost;store.endEnemyResolution('left');}
assert.equal(store.getEnemy().id,'left');

// Public lower-level APIs must also fail closed; explicit null is not legacy absence.
reset();
const unknown=store.spawnSummons('enemy',{id:'unbound',name:'未绑定',emoji:'◇',maxHp:3},1).spawned[0];
const publicCopy=store.copySummons([unknown.instanceId],'enemy',10).copied[0];
const unknownPlayer=core.spawnSummonUnits(core.createSummonCollectionState(),'player',
  {id:'unknown_player',name:'身份未知',emoji:'◇',maxHp:3},1,3,'reject',1,null);
const unknownPlayerCopy=core.copySummonUnits(unknownPlayer.state,[unknownPlayer.spawned[0].instanceId],'player',3,'reject',1,'preserve');
const reviewFailures=[];
if(unknown.summonerId!==null)reviewFailures.push('public enemy spawn guessed current enemy');
if(publicCopy.summonerId!==null)reviewFailures.push('public enemy copy guessed current enemy');
if(unknownPlayerCopy.copied[0].summonerId!==null)reviewFailures.push('preserve copy changed explicit unknown player into known');
assert.deepEqual(reviewFailures,[]);
// Explicit unknown player identity does not acquire a real owner through copying or slot matching.
const unknownSlot=core.spawnSummonUnits(core.createSummonCollectionState(),'player',slotted,1,10,'reject',1,null);
const concreteSlot=core.spawnSummonUnits(unknownSlot.state,'player',slotted,1,10,'reject',1,'player');
assert.equal(concreteSlot.state.living.length,2,'unknown and known player slots do not merge');
store.writeSummons(unknownPlayerCopy.state,'explicit_unknown_player_fixture');
const unknownCopyUnit=store.getSummonById(unknownPlayerCopy.copied[0].instanceId);
await executor.executeEffectProgram(compile({summoner_effects:{block:99}}),true,{summonContext:unknownCopyUnit});
assert.equal(store.getPlayer().block,0);assert.ok(messages.some(m=>/身份未能确认/.test(m)));

const schema=JSON.parse(readFileSync('schemas/mwg-card-effects-v1.schema.json','utf8'));
const validate=new Ajv2020({strict:false}).compile(schema);
assert.equal(validate({effects:{spawn_summon:companion}}),true,JSON.stringify(validate.errors));
for(const field of ['summonerId','summoner_id','ownerId']){
  const fake={spawn_summon:{...companion,[field]:'right'}};
  assert.equal(core.compileCompactEffectList(fake).ok,false,field);
  assert.equal(validate({effects:fake}),false,field+' schema rejects internal identity from AI');
}
console.log('PASS persisted summon owner: real action/listener/scheduler, target/context switch and JSON restore; slot/revival isolation; copy/transfer; exception cleanup; no redirect for dead/missing/legacy-unknown owners; AI identity forbidden.');
