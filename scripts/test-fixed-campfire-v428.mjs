import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createRunState,enterRunNode,completeRunNode,validateRunState}=require('../src/game-core/runState.ts');
const {rememberTowerCardOffer,towerMemoryCandidates,markTowerShopCardsShown}=require('../src/game-core/towerCardMemory.ts');
const {campfireGold}=require('../src/game-core/towerCampfire.ts');
const {activateTowerNodeInStat}=require('../src/runtime/towerContentActivation.ts');
const {queueTowerLookaheadInStat}=require('../src/runtime/towerStateAdapter.ts');
const {availableTowerMemoryCards}=require('../src/runtime/towerCardMemory.ts');
const {executeUnifiedRunTransactionInStat}=require('../src/common/runTransactions.ts');
const card=(id,effects={damage:5})=>({id,name:id,type:'Attack',rarity:'Common',cost:1,quantity:1,unique:true,effects});
let run=createRunState({seed:427,routeMode:'map'});
run={...run,opening:{phase:'skipped',requestId:null,basedOnRevision:0,attempts:0}};
while(!run.choices.some(n=>n.kind==='rest')) run=completeRunNode(enterRunNode(run,run.choices[0].id),{outcome:'cleared'});
const node=run.choices.find(n=>n.kind==='rest');
assert.equal(run.nodeContent[node.id].phase,'ready');
const legacy=structuredClone(run);legacy.nodeContent[node.id]={schemaVersion:1,nodeId:node.id,kind:'rest',phase:'idle',requestId:null,basedOnRevision:0,attempts:0};
const migrated=validateRunState(legacy);assert.equal(migrated.ok,true);assert.equal(migrated.value.nodeContent[node.id].phase,'ready');
assert.equal(legacy.nodeContent[node.id].phase,'idle','migration does not mutate the input save');
run=rememberTowerCardOffer(run,[card('old_a'),card('old_b'),card('chosen'),card('missing',{apply_status:'missing',stacks:1})],['chosen']);
const status={id:'focus',name:'专注',emoji:'◆',type:'buff',stacks_change:'keep',triggers:{hold:{modify:'damage',add:1}}};
const dependent={...card('dependent',{apply_status:'focus',stacks:1,to:'self'}),type:'Skill',statuses:[status]};
run=rememberTowerCardOffer(run,[dependent],[]);
const stat={game_mode:'tower',run,battle:{core:{hp:35,max_hp:100,lust:0,max_lust:100,resources:[]},cards:[card('starter')],statuses:[],artifacts:[],items:[]},reward:{card:[],artifact:[],item:[],limits:{cards:0,artifacts:0,items:0}}};
const queued=queueTowerLookaheadInStat(structuredClone(stat));
assert.ok(queued.queued.every(job=>job.kind!=='rest'),'campfires never enter the model queue');
activateTowerNodeInStat(stat,node.id);assert.equal(stat.run_node.narrative_phase,'ready');assert.equal(stat.run_node.narrative_source,'program');
const candidates=availableTowerMemoryCards(stat,node.id,'recall');
assert.equal(candidates.length,3);assert.ok(!candidates.some(c=>c.id==='missing'||c.id==='chosen'));
assert.deepEqual(availableTowerMemoryCards(JSON.parse(JSON.stringify(stat)),node.id,'recall'),candidates,'recall survives reload with stable candidates');
const act=(target,request)=>executeUnifiedRunTransactionInStat(target,{...request,source:{kind:'player',id:'test'}});
for(const action of ['rest','train','scavenge','recall']) {
  const target=structuredClone(stat);
  act(target,action==='rest'?{kind:'rest_heal'}:{kind:'rest_action',action,cardId:'dependent'});
  assert.equal(target.run.phase,'awaiting_choice');assert.equal(target.run.floor,node.floor);
  if(action==='rest')assert.equal(target.battle.core.hp,65);
  if(action==='train'){assert.equal(target.battle.core.max_hp,105);assert.equal(target.battle.core.hp,35);}
  if(action==='scavenge')assert.equal(target.run.gold-stat.run.gold,campfireGold(run.seed,node.id));
  if(action==='recall'){
    assert.ok(target.battle.cards.some(c=>c.id==='dependent'));
    assert.ok(target.battle.statuses.some(s=>s.id==='focus'),'recalled card registers its dependency');
    assert.ok(target.run.cardMemory.acquiredIds.includes('dependent'));
  }
  const settled=JSON.stringify(target);assert.throws(()=>act(target,{kind:'rest_action',action:'scavenge'}));
  assert.equal(JSON.stringify(target),settled,'second action is rejected without changing HP, gold, cards or route');
}
for(let seed=0;seed<100;seed++){const gold=campfireGold(seed,node.id);assert.ok(gold>=15&&gold<=35);assert.equal(gold,campfireGold(seed,node.id));}
const bad=structuredClone(stat),before=JSON.stringify(bad);
assert.throws(()=>act(bad,{kind:'rest_action',action:'recall',cardId:'missing'}));assert.equal(JSON.stringify(bad),before);
const shown=markTowerShopCardsShown(run,[card('old_a')]);
assert.ok(!towerMemoryCandidates(JSON.parse(JSON.stringify(shown)),'another-shop','shop').some(c=>c.id==='old_a'),'shown old stock never repeats, even if unbought');
assert.ok(towerMemoryCandidates(shown,node.id,'recall').some(c=>c.id==='old_a'),'shop exposure does not consume recall');
console.log('PASS fixed campfire migration, no generation, four exclusive actions, deterministic gold, recall dependencies, unique acquisition and one-time shop stock ledger.');
