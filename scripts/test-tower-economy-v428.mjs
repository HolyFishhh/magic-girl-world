import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const runCore=require('../src/game-core/runState.ts');
const {recommendTowerBattleRewardBudget,enforceBattleRewardBudget,towerShopRemovalPrice}=require('../src/game-core/contentBudget.ts');
const {rememberTowerCardOffer}=require('../src/game-core/towerCardMemory.ts');
const {parseTowerNodeResult,formatTowerNodeGenerationPrompt,createTowerNodeJsonSchema,createTowerNodeBatchJsonSchema}=require('../src/game-core/towerRequest.ts');
const {activateTowerNodeInStat}=require('../src/runtime/towerContentActivation.ts');
const {executeUnifiedRunTransactionInStat}=require('../src/common/runTransactions.ts');
const {availableTowerMemoryCards}=require('../src/runtime/towerCardMemory.ts');
const {validateRewardCandidateAgainstLibrary}=require('../src/game-core/rewardCandidateValidation.ts');
const card=(id,rarity='Common')=>({id,name:id,type:'Attack',rarity,cost:1,quantity:1,unique:true,effects:{damage:5}});
const relic=(id,rarity='Epic')=>({id,name:id,rarity,trigger:{on:'battle_start',effects:{block:3}}});
for(const kind of ['battle','elite','boss']) {
 const context={nodeId:'node',kind,act:1,floor:1,rewardSeed:123};
 const budget=recommendTowerBattleRewardBudget(context);
 assert.equal(budget.cards.candidates,3);assert.equal(budget.cards.pick,1);
 assert.deepEqual(recommendTowerBattleRewardBudget(context),budget);
 if(kind==='boss'){assert.deepEqual(budget.cards.slotRarities,['Legendary','Legendary','Legendary']);assert.deepEqual(budget.artifacts.slotRarities,['Legendary']);}
 if(kind==='elite')assert.equal(budget.artifacts.candidates,1);
 const reward={card:budget.cards.slotRarities.map((r,i)=>card('c'+i,r)),artifact:budget.artifacts?.slotRarities.map((r,i)=>relic('r'+i,r))||[],item:budget.items?[{id:'p',name:'药水',effects:{heal:5}}]:[]};
 assert.doesNotThrow(()=>enforceBattleRewardBudget(reward,budget));
 reward.card[0].rarity='Corrupt';assert.throws(()=>enforceBattleRewardBudget(reward,budget),/rarity must be/);
}
const frequencies={Common:0,Rare:0,Epic:0,potions:0};
for(let seed=0;seed<3000;seed++) {const b=recommendTowerBattleRewardBudget({nodeId:'same-node',kind:'battle',act:1,floor:1,rewardSeed:seed});b.cards.slotRarities.forEach(r=>frequencies[r]++);if(b.items)frequencies.potions++;}
assert.ok(frequencies.Common>4800&&frequencies.Common<6000);assert.ok(frequencies.Rare>2700&&frequencies.Rare<3600);assert.ok(frequencies.Epic>250&&frequencies.Epic<650);assert.ok(frequencies.potions>210&&frequencies.potions<390);
assert.equal(validateRewardCandidateAgainstLibrary('artifacts',relic('legend','Legendary'),{existing:[],statusDefinitions:[]}).ok,true);
function reachableShop(kind='shop'){
 for(let seed=1;seed<100;seed++) {
  let run=runCore.createRunState({seed,routeMode:'map'});run.opening={phase:'skipped',requestId:null,basedOnRevision:0,attempts:0};
  const path=run.map.acts[0].paths.find(path=>path.some(id=>run.map.nodes.find(n=>n.id===id)?.kind===kind));if(!path)continue;
  for(const id of path){const choice=run.choices.find(n=>n.id===id);if(choice.kind===kind)return {run,choice};run=runCore.completeRunNode(runCore.enterRunNode(run,id),{outcome:'cleared'});}
 }
 throw Error('missing shop');
}
let {run,choice}=reachableShop();run.gold=500;run=rememberTowerCardOffer(run,[card('old_a'),card('old_b'),card('recall_only')],[]);
const mapNode=run.map.nodes.find(n=>n.id===choice.id);
const job={nodeId:choice.id,requestId:'shop-test',basedOnRevision:run.stateRevision,kind:'shop',act:choice.act,floor:choice.floor,contentSeed:mapNode.contentSeed,rewardSeed:mapNode.rewardSeed,difficultyMultiplier:1,shopMemoryCards:[card('old_a'),card('old_b')]};
const raw={spec:'mwg.tower-node-result/v1',node_id:choice.id,request_id:job.requestId,based_on_revision:job.basedOnRevision,kind:'shop',title:'旧路商人',narrative:'铺开毯子。',payload:{shop:{}},reward:{cards:[card('new_a'),card('new_b'),card('new_c')],artifacts:[relic('r1'),relic('r2')],items:[{id:'p1',name:'药水一',count:1,effects:{heal:5}},{id:'p2',name:'药水二',count:1,effects:{block:5}}],limits:{cards:3,artifacts:2,items:2}}};
const parsed=parseTowerNodeResult(JSON.stringify(raw),job);assert.equal(parsed.reward.cards.length,5);assert.deepEqual(parsed.program_shop_memory_ids,['old_a','old_b']);
const prompt=formatTowerNodeGenerationPrompt(job,{difficultyPercent:100});assert.match(prompt,/cards=3/);assert.match(prompt,/程序另行补入旧候选卡/);
run.nodeContent[choice.id]={...run.nodeContent[choice.id],phase:'ready',requestId:job.requestId,content:parsed,reward:parsed.reward};
const stat={game_mode:'tower',game_mode_lock:{schemaVersion:1,mode:'tower'},run,battle:{core:{hp:50,max_hp:80,lust:0,max_lust:100,resources:[],card_removal_count:0},cards:[card('starter'),card('remove_me')],artifacts:[],items:[],statuses:[]},reward:{card:[],artifact:[],item:[],limits:{}}};
activateTowerNodeInStat(stat,choice.id);assert.equal(stat.reward.card.length,5);assert.ok(stat.run.cardMemory.shopShownIds.includes('old_a'));
const act=(request)=>executeUnifiedRunTransactionInStat(stat,{...request,source:{kind:'player',id:'test'}});
act({kind:'shop_purchase',selections:{cards:[0],artifacts:[],items:[]}});assert.equal(stat.run.phase,'in_node');assert.equal(stat.reward.card.length,4);assert.equal(stat.run.gold,455);
act({kind:'shop_purchase',selections:{cards:[0],artifacts:[],items:[]}});assert.equal(stat.reward.card.length,3);assert.equal(stat.run.gold,410);
const before=JSON.stringify(stat);assert.throws(()=>act({kind:'shop_purchase',selections:{cards:[],artifacts:[],items:[]}}));assert.equal(JSON.stringify(stat),before);
const selected=stat.battle.cards.find(c=>c.id==='remove_me');act({kind:'shop_remove_card',runInstanceId:selected.runInstanceId});assert.equal(stat.run.gold,335);assert.ok(!stat.battle.cards.some(c=>c.id==='remove_me'));assert.equal(towerShopRemovalPrice(stat.run),100);assert.equal(stat.battle.core.card_removal_count,0);
const after=JSON.stringify(stat);assert.throws(()=>act({kind:'shop_remove_card',runInstanceId:stat.battle.cards[0].runInstanceId}));assert.equal(JSON.stringify(stat),after);
act({kind:'shop_leave'});assert.equal(stat.run.phase,'awaiting_choice');
const reloaded=JSON.parse(JSON.stringify(stat));assert.equal(towerShopRemovalPrice(reloaded.run),100,'a successful paid removal remains counted after restore');const shopIds=availableTowerMemoryCards(reloaded,'next-shop','shop').map(c=>c.id);assert.deepEqual(shopIds,['recall_only']);assert.ok(availableTowerMemoryCards(reloaded,'campfire','recall').some(c=>c.id==='new_a'));
console.log('PASS program reward slots/distribution and legendary relics; old/new shop assembly, continuous purchases, paid removal once, atomic failure, persisted one-time exposure and recall.');

// Forced event drawbacks and optional card choices are separate settlement channels.
const reachedEvent=reachableShop('event');
const curse={id:'burden',name:'执念',type:'Curse',rarity:'Corrupt',quantity:1,lifecycle:{turn_end:'retain'},description:'无法打出，保留在手中占用空间。'};
const eventSource={...structuredClone(stat),run:reachedEvent.run,reward:{card:[],artifact:[],item:[],limits:{}}};
eventSource.run.nodeContent[reachedEvent.choice.id]={...eventSource.run.nodeContent[reachedEvent.choice.id],phase:'ready',requestId:'event',content:{title:'旧债',narrative:'选择代价。',payload:{event:{choices:[
 {id:'trade',label:'承担执念，获得金币',outcome:{gold:100,gain_cards:[curse]}},
 {id:'learn',label:'选择一门招式',outcome:{reward:{cards:[card('choice_a'),card('choice_b'),card('choice_c')],artifacts:[],items:[],limits:{cards:1,artifacts:0,items:0}}}},
 {id:'leave',label:'离开',outcome:{}}
]}}}};
activateTowerNodeInStat(eventSource,reachedEvent.choice.id);
const {settleTowerEventChoiceInStat}=require('../src/common/runTransactions.ts');
const trade=structuredClone(eventSource),tradeGold=trade.run.gold;
settleTowerEventChoiceInStat(trade,'trade');assert.equal(trade.run.gold,tradeGold+100);assert.ok(trade.battle.cards.some(c=>c.id==='burden'));assert.equal(trade.run.phase,'awaiting_choice');
const traded=JSON.stringify(trade);assert.throws(()=>settleTowerEventChoiceInStat(trade,'trade'));assert.equal(JSON.stringify(trade),traded);
const learn=structuredClone(eventSource);settleTowerEventChoiceInStat(learn,'learn');assert.equal(learn.reward.card.length,3);assert.equal(learn.reward.limits.cards,1);
executeUnifiedRunTransactionInStat(learn,{kind:'event_reward_claim',selections:{cards:[1],artifacts:[],items:[]}});assert.ok(learn.battle.cards.some(c=>c.id==='choice_b'));assert.ok(!learn.battle.cards.some(c=>c.id==='choice_a'||c.id==='burden'));
assert.ok(availableTowerMemoryCards(learn,'recall','recall').some(c=>c.id==='choice_a'));
const leave=structuredClone(eventSource);settleTowerEventChoiceInStat(leave,'leave');assert.equal(leave.run.gold,eventSource.run.gold);assert.ok(!leave.battle.cards.some(c=>c.id==='burden'));
console.log('PASS event three-card choice, compulsory curse + gold atomic settlement, refusal, repeat protection, and unchosen-card memory.');

const shopSchema=createTowerNodeJsonSchema('shop',job).value;
assert.equal(shopSchema.properties.reward.properties.cards.minItems,3,'schema requests only the missing new card slots');
assert.equal(createTowerNodeBatchJsonSchema('batch',[job]).value.properties.results.items.oneOf[0].properties.reward.properties.cards.minItems,3);
for(let seed=0;seed<40;seed++){
 const ctx={nodeId:'consistent',kind:'battle',act:1,floor:2,rewardSeed:seed};
 const budget=recommendTowerBattleRewardBudget(ctx),schema=createTowerNodeJsonSchema('battle',ctx).value;
 assert.equal(schema.properties.reward.properties.item.minItems,budget.items?.candidates||0,'schema and parser share seeded drop plan');
}
console.log('PASS both single and batch generation schemas carry the exact seed and old-card reservation.');
