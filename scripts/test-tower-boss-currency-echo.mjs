import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const tower=require('../src/game-core/towerRequest.ts');
const runCore=require('../src/game-core/runState.ts');
const content=require('../src/game-core/towerContentState.ts');
const {recommendTowerBattleRewardBudget}=require('../src/game-core/contentBudget.ts');
const {activateTowerNodeInStat}=require('../src/runtime/towerContentActivation.ts');
const {settleTowerBattleRewardInStat}=require('../src/runtime/towerBattleRewardSettlement.ts');

// Synthetic fresh run, no player snapshots, model calls, or host writes.
let run=runCore.createRunState({seed:20260918});
run.opening={...run.opening,phase:'skipped'};
while(!run.choices.some(n=>n.kind==='boss')) run=runCore.completeRunNode(runCore.enterRunNode(run,run.choices[0].id),{outcome:'cleared'});
const choice=run.choices.find(n=>n.kind==='boss');
let store=content.queueTowerNodeContent(run.nodeContent,choice.id,run.stateRevision).store;
store=content.claimTowerGeneration(store,choice.id).store;
const envelope=store[choice.id];
const job={nodeId:choice.id,requestId:envelope.requestId,basedOnRevision:envelope.basedOnRevision,kind:'boss',act:choice.act,floor:choice.floor,rewardSeed:run.map.nodes.find(n=>n.id===choice.id).rewardSeed};
const budget=recommendTowerBattleRewardBudget(job);
const authored={card:budget.cards.slotRarities.map((rarity,i)=>({id:`boss_card_${i}`,name:`首领奖励${i}`,type:'Skill',rarity,cost:1,quantity:1,effects:{block:7+i}})),artifact:budget.artifacts.slotRarities.map((rarity,i)=>({id:`boss_relic_${i}`,name:`首领遗物${i}`,rarity,emoji:'◇',trigger:{on:'battle_start',effects:{block:2+i}}})),item:[],limits:{cards:1,artifacts:1,items:0}};
const raw={spec:tower.TOWER_NODE_RESULT_SPEC,node_id:job.nodeId,request_id:job.requestId,based_on_revision:job.basedOnRevision,kind:job.kind,title:'首领',narrative:'前方的首领挡住去路。',payload:{battle:{enemy:{id:'boss',name:'守门者',emoji:'♛',hp:50,max_hp:50,lust:0,max_lust:100,actions:[{name:'挥击',effects:{damage:7}}],abilities:[],status_effects:[],action_mode:'random',action_config:{},defeat_reward:{gold:19}}}},reward:authored};
const parse=value=>tower.parseTowerNodeResult(JSON.stringify(value),job);
const baseline=parse(raw);
for(const extra of [{gold:136},{gold:999999999,gold_claimed:true},{gold:-99,gold_claimed:'yes'},{gold:{formula:'do not execute'},gold_claimed:null}]){
 const candidate={...raw,reward:{...authored,...extra}};const before=structuredClone(candidate);const parsed=parse(candidate);
 assert.deepEqual(candidate,before,'parser does not rewrite source');
 assert.deepEqual(parsed,baseline,'only program values survive echoed currency');
 assert.deepEqual(parsed.reward.card,authored.card);assert.deepEqual(parsed.reward.artifact,authored.artifact);
 assert.equal(parsed.reward.gold,budget.gold);assert.equal(parsed.reward.gold_claimed,false);
 assert.equal(parsed.payload.battle.enemy.defeat_reward.gold,19,'independent authored enemy loot untouched');
 assert.deepEqual(parse(parsed),parsed,'normalization remains stable after serialization');
 const batch={spec:tower.TOWER_NODE_BATCH_RESULT_SPEC,batch_id:'boss-batch',based_on_revision:job.basedOnRevision,results:[candidate]};
 const inspected=tower.inspectTowerNodeBatchResult(JSON.stringify(batch),'boss-batch',[job]);assert.equal(inspected.entries[0].ok,true);assert.deepEqual(inspected.entries[0].result,parsed);
}
assert.throws(()=>parse({...raw,reward:{...authored,price:1}}),/unsupported field: price/);
assert.throws(()=>parse({...raw,reward:{...authored,experience:10}}),/unsupported field: experience/);
assert.throws(()=>parse({...raw,request_id:'stale'}),/scope is stale/);
const schema=tower.createTowerNodeJsonSchema('boss',job).value;
assert.equal(schema.properties.reward.additionalProperties,false);assert.equal(schema.properties.reward.properties.gold,undefined);assert.equal(schema.properties.reward.properties.gold_claimed,undefined,'generation schema does not authorize AI currency');
assert.match(tower.formatTowerNodeGenerationPrompt(job,{difficultyPercent:100}),/禁止生成 gold 或 gold_claimed/);

// Parsed content -> committed node -> JSON restore -> activation -> victory.
store=content.commitTowerGeneration(store,{nodeId:choice.id,requestId:envelope.requestId,basedOnRevision:envelope.basedOnRevision,content:baseline,reward:baseline.reward}).store;
run={...run,nodeContent:store};
let stat=JSON.parse(JSON.stringify({game_mode:'tower',game_mode_lock:{schemaVersion:1,mode:'tower'},run,battle:{core:{emoji:'✨',hp:80,max_hp:100,lust:0,max_lust:100,resources:[]},cards:[{id:'starter',name:'起手防御',type:'Skill',rarity:'Common',cost:1,quantity:4,effects:{block:6}}],statuses:[],artifacts:[],items:[],player_abilities:[],player_status_effects:[],player_lust_effect:null,enemy:null,enemies:[],level:1,exp:0},reward:{card:[],artifact:[],item:[],limits:{}}}));
activateTowerNodeInStat(stat,choice.id);
const stagedGold=stat.run_node_reward.reward.gold;
assert.ok(Number.isInteger(stagedGold)&&stagedGold>0);assert.equal(stat.run_node_reward.reward.gold_claimed,false);
assert.equal(stat.reward.card.length,0,'no reward granted by preparation or entry');
stat=JSON.parse(JSON.stringify(stat));
settleTowerBattleRewardInStat(stat,'victory',choice.id,[{enemyId:'boss',reward:{gold:19}}]);
assert.equal(stat.reward.gold,stagedGold+19);assert.equal(stat.reward.gold_claimed,false);
assert.deepEqual(stat.reward.card.map(c=>c.id),authored.card.map(c=>c.id));
const after=JSON.stringify(stat);
settleTowerBattleRewardInStat(stat,'victory',choice.id,[{enemyId:'boss',reward:{gold:19}}]);
assert.equal(JSON.stringify(stat),after,'repeat victory cannot grant currency twice');
console.log(JSON.stringify({passed:true,kind:'boss',programGold:budget.gold,stagedGold,enemyLoot:19,echoCases:4,batch:true,schemaStrict:true,saveActivationVictory:true,noDoubleGrant:true}));

