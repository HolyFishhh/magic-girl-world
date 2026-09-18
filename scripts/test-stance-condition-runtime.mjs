import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {collectStanceNames}=require('../src/game-core/stanceIdentityDisplay.ts');
const {GameStateManager}=require('../src/fish/core/gameStateManager.ts');
const {UnifiedEffectExecutor}=require('../src/fish/combat/unifiedEffectExecutor.ts');
const {EffectProgramDisplay}=require('../src/fish/ui/effectProgramDisplay.ts');
const {createBattleRequestFromMvu}=require('../src/fish/core/battleContractAdapter.ts');
const {formatCompactEffectAuthoringContract}=require('../src/game-core/towerRequest.ts');
const programSchema=new Ajv2020({strict:false}).compile(JSON.parse(readFileSync('schemas/mwg-effect-v1.schema.json','utf8')));
const a={id:'resonant_guard',name:'谐振姿态'},b={id:'forced_vent',name:'强排姿态'};
const compile=(effects,policy={})=>{const p=core.compileCompactEffectList(effects);assert.equal(p.ok,true,JSON.stringify(p));
  assert.equal(programSchema(p.value),true,JSON.stringify(programSchema.errors));
  const checked=core.validateEffectProgramPolicy(p.value,{triggerPolicy:'forbid',modifierPolicy:'forbid',...policy});
  assert.equal(checked.ok,true,JSON.stringify(checked));
  return p.value;};
const unit={hp:30,maxHp:30,lust:0,maxLust:30,energy:0,maxEnergy:5,block:0};
const state={self:{...unit,stanceId:a.id},opponent:{...unit,stanceId:b.id},currentTurn:1,cardsPlayedThisTurn:0,
  attacksPlayedThisTurn:0,skillsPlayedThisTurn:0};
const context={};
for(const [when,expected] of [
  ["self.stance == 'resonant_guard'",true],["'resonant_guard' == self.stance",true],
  ['self.stance != null',true],['null == self.stance',false],
  ["opponent.stance == 'forced_vent'",true],["self.stance != 'resonant_guard'",false],
  ["!(self.stance == 'forced_vent') && opponent.stance != null",true],
  ["self.stance == 'forced_vent' || opponent.stance == 'resonant_guard'",false],
  ["(self.stance == 'resonant_guard') == true",true],
]){
  const program=compile({block:2,when});const condition=program.steps[0].condition;
  assert.equal(core.evaluateConditionExpression(condition,state,context),expected,when);
  const result=core.executeEffectProgram(program,state,context);
  assert.equal(result.ok,true);assert.equal(result.state.self.block,expected?2:0,when);
}
for(const stanceId of [undefined,null,'none',a.id]){
  const s=structuredClone(state);s.self.stanceId=stanceId;
  assert.equal(core.evaluateConditionExpression(compile({block:1,when:'self.stance == null'}).steps[0].condition,s,context),stanceId==null);
  assert.equal(core.evaluateConditionExpression(compile({block:1,when:"self.stance == 'none'"}).steps[0].condition,s,context),stanceId==='none');
}
for(const when of ["self.stance > 'resonant_guard'",'self.stance == 0','self.stance == true',
  'self.stance == opponent.stance',"self.stance == ''","self.stance == 'bad-id'",'self.stance',
  "self.has_stance('resonant_guard')","self.stance.id == 'resonant_guard'",'self.stance == undefined'])
  assert.equal(core.compileCompactEffectList({block:1,when}).ok,false,when);
for(const energy of ['self.stance',"'resonant_guard'",'self.stance + 1','max(self.stance, 1)'])
  assert.equal(core.compileCompactEffectList({energy}).ok,false,energy);
const validCondition={op:'stance_is',target:'self',relation:'eq',stanceId:null};
for(const change of [{target:'player'},{stanceId:undefined},{stanceId:0},{stanceId:''},{stanceId:'a-b'},
  {relation:'gt'},{unexpected:true}]){
  const p={spec:'mwg.effect/v1',steps:[{op:'if',condition:{...validCondition,...change},then:[{op:'gain_block',target:'self',amount:1}]}]};
  assert.equal(core.validateEffectProgram(p).ok,false,JSON.stringify(change));assert.equal(programSchema(p),false);
}

// Captured final card from batch tower_batch_4_9w608b, not a corrected/generated substitute.
const original=JSON.parse(readFileSync('scripts/fixtures/node-v53-stance-card.json','utf8'));
const frozen=JSON.stringify(original),rawProgram=compile(original.effects);
const battle={core:{emoji:'🔧',hp:40,max_hp:40,lust:0,max_lust:30,resources:[
  {id:'wind_pressure',name:'风压',emoji:'🌀',max:10,start:0,refresh:'retain'}]},
  cards:[{...original,quantity:1},{id:'change',name:'调律',type:'Skill',rarity:'Common',cost:0,quantity:1,
    effects:[{stance:a},{stance:b}]}],statuses:[],artifacts:[],items:[],
  enemies:['left','right'].map((id,i)=>({id,name:'目标',emoji:'◇',hp:100,max_hp:100,lust:0,max_lust:30,
    stance:i?b:a,actions:[{id:'wait',name:'等待',effects:{block:1}}]}))};
const store=GameStateManager.getInstance(),executor=UnifiedEffectExecutor.getInstance();
executor.presentation=new Proxy({},{get:()=>async()=>undefined});
store.convertMVUToGameState(createBattleRequestFromMvu({stat_data:{battle}},battle));
store.updatePlayer({energy:0,maxEnergy:5});
assert.equal(executor.getCoreEffectState().self.stanceId,null);
await executor.executeEffectProgram(rawProgram,true);
assert.equal(store.getPlayer().energy,0);assert.equal(store.getPlayer().resources.wind_pressure.current,2);
await executor.executeEffectProgram(compile([{stance:a},...original.effects]),true);
assert.equal(store.getPlayer().energy,1,'same sequence observes newly installed stance; actual authored value is one');
assert.equal(store.getPlayer().resources.wind_pressure.current,4);assert.equal(store.getPlayer().block,0,'never invent prose-only block');
await executor.executeEffectProgram(compile([{stance:b},...original.effects]),true);
assert.equal(store.getPlayer().energy,1,'switch makes old predicate false');
await executor.executeEffectProgram(compile([{stance:null},{block:3,when:'self.stance == null'}]),true);
assert.equal(store.getPlayer().block,3);
await executor.executeEffectProgram(compile({stance:a}),true);
const saved=JSON.stringify(store.getGameState());store.replaceState(JSON.parse(saved));
assert.equal(JSON.stringify(store.getGameState()),saved);
await executor.executeEffectProgram(rawProgram,true);assert.equal(store.getPlayer().energy,2,'restored stance identity remains usable');
assert.equal(store.getPlayer().resources.wind_pressure.current,8);
await executor.executeEffectProgram(compile({block:4,to:'self',when:"self.stance == 'forced_vent' && opponent.stance == 'resonant_guard'"}),false,
  {battleContext:{enemyId:'right'}});
assert.equal(store.getEnemyById('right').block,4);assert.equal(store.getEnemyById('left').block,0,'bound enemy, not active enemy, owns self');
const summon=store.spawnSummons('player',{id:'observer',name:'观察者',emoji:'◇',maxHp:5},1,3).spawned[0];
await executor.executeEffectProgram(compile([
  {block:2,when:'self.stance == null'},
  {block:99,when:"self.stance == 'resonant_guard'"},
  {summoner_effects:{block:5,when:"self.stance == 'resonant_guard'"}},
  {block:1,when:'self.stance == null'},
],{allowSummonerEffects:true}),true,{summonContext:summon});
assert.equal(store.getSummonById(summon.instanceId).block,3,'summon has no inherited stance, including after owner scope exits');
assert.equal(store.getPlayer().block,8,'explicit summoner_effects uses actual owner stance');
const enemySummon=store.spawnSummons('enemy',{id:'enemy_observer',name:'敌方观察者',emoji:'◇',maxHp:5},1,3,'replace_oldest','right').spawned[0];
await executor.executeEffectProgram(compile([
  {block:2,when:'self.stance == null'},
  {summoner_effects:{block:7,when:"self.stance == 'forced_vent' && opponent.stance == 'resonant_guard'"}},
],{allowSummonerEffects:true}),false,{summonContext:enemySummon,battleContext:{enemyId:'left'}});
assert.equal(store.getEnemyById('right').block,11);assert.equal(store.getEnemyById('left').block,0);
assert.equal(store.getSummonById(enemySummon.instanceId).block,2);
// Persisted summoner identity must outrank an unrelated incoming enemy context.
const hold={id:'stance_watch',name:'姿态观测',emoji:'◇',type:'buff',stacks_change:0,triggers:{hold:[
  {modify:'damage',add:'self.stance == null ? 2 : 99'},
]}};
assert.match(core.collectCompactStatusDefinitionIssues(hold).join(';'),/Modifier formulas may only use numbers and status stacks/,
  'this feature does not expand the existing static modifier authoring contract');

const names=collectStanceNames(battle);assert.equal(names[a.id],a.name);assert.equal(names[b.id],b.name);
for(const when of ["(self.stance) == ('resonant_guard')", "'resonant_guard' == (self.stance)",
  "!((self.stance) != 'resonant_guard') && opponent.hp > 0"]){
  compile({block:1,when});
  const display=core.describeCompactEffectList({block:1,when},undefined,{stanceNames:names});
  assert.match(display,/谐振姿态/);assert.doesNotMatch(display,/resonant_guard|self\.stance/);
}
const cyclic={stance:a};cyclic.self=cyclic;assert.equal(collectStanceNames(cyclic)[a.id],a.name);
assert.equal(collectStanceNames({stance:a},{stance:{...a,name:'冲突'}})[a.id],undefined,'ambiguous labels not guessed');
const text=core.describeCompactEffectList(original.effects,undefined,{stanceNames:names,resourceNames:{wind_pressure:'风压'}});
assert.match(text,/自身处于谐振姿态/);assert.doesNotMatch(text,/self\.stance|resonant_guard|获得5点格挡|获得2点能量/);
const tags=EffectProgramDisplay.getInstance().programToTags(rawProgram).map(x=>x.text).join('；');
assert.match(tags,/自身处于谐振姿态/);assert.doesNotMatch(tags,/resonant_guard|self\.stance/);
const enemyEffects={block:1,when:"self.stance == 'forced_vent' && opponent.stance == 'resonant_guard'"};
const enemyLabels={stanceNames:names,selfLabel:'敌方持有者',opponentLabel:'我方玩家'};
const enemyCompact=core.describeCompactEffectList(enemyEffects,undefined,enemyLabels);
const enemyTyped=core.effectProgramToDisplayTags(compile(enemyEffects),enemyLabels).map(t=>t.text).join(';');
for(const display of [enemyCompact,enemyTyped]){
  assert.match(display,/敌方持有者处于强排姿态/);assert.match(display,/我方玩家处于谐振姿态/);
}
assert.match(core.describeCompactEffectList({block:1,when:'opponent.stance == null'}),/对方没有当前姿态/);
assert.equal(JSON.stringify(original),frozen,'authored values and conflicting prose remain untouched');
assert.match(formatCompactEffectAuthoringContract(),/self\.stance ==/);
console.log('PASS typed stance identity: literal/null strict semantics, numeric isolation, schema/policy, exact captured card, same-sequence switch/exit, JSON restore, enemy and summon ownership, derived labels. Prose mismatch remains open.');
