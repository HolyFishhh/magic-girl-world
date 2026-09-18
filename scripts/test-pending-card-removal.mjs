import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {PendingCardRemoval}=require('../src/common/pendingCardRemoval.ts');
const {TavernRunActionHost}=require('../src/common/runActionHost.ts');
const {executeUnifiedRunTransactionInStat:tx,settleTowerOpeningChoiceInStat:opening}=require('../src/common/runTransactions.ts');
const {createRunState}=require('../src/game-core/runState.ts');
const {migratePersistentRunDeck}=require('../src/game-core/cardProgression.ts');
const {flattenMvuArray}=require('../src/runtime/mvuArrays.ts');
const acq=require('../src/common/initialArtifactAcquisition.ts');
const relic={id:'remove_relic',name:'净化遗物',rarity:'Rare',on_acquire:{card_removals:1}};
function base(){return {run:createRunState({seed:174}),battle:{core:{hp:30,max_hp:30,lust:0,max_lust:100,card_removal_count:0,resources:[]},cards:[{id:'same',name:'相同卡',type:'Skill',rarity:'Common',cost:1,quantity:2,effects:{block:2}}],artifacts:[],items:[],statuses:[]},reward:{card:[],artifact:[],item:[],limits:{},disabled_categories:[]}}}
const cards=s=>migratePersistentRunDeck(flattenMvuArray(s.battle.cards));
function harness(s){let variables={stat_data:JSON.parse(JSON.stringify(s))};let active=true;let latest=true;let ready=true;let offers=0;let changes=0;let saveFailure=false;
const host=new TavernRunActionHost({isLatest:()=>latest,initialPublicationReady:()=>ready,updateVariablesWith:async fn=>{const draft=await fn(structuredClone(variables));if(saveFailure)throw new Error('save failed');variables=draft;return variables},continueWithPrompt:async()=>{}});
const ports={read:()=>variables.stat_data,active:()=>active,choose:async stat=>{offers++;return cards(stat)[0].runInstanceId},commit:(id,revision)=>host.removeCardWithAllowance(id,revision),changed:async()=>{changes++}};
return {ports,host,stat:()=>variables.stat_data,offers:()=>offers,changes:()=>changes,active:v=>active=v,latest:v=>latest=v,ready:v=>ready=v,failSave:v=>saveFailure=v};}
for(const source of ['gift','gift-relic','reward-relic','initial-relic']){
 const s=base();
 if(source.startsWith('gift')){s.run.opening={phase:'ready',requestId:'open',basedOnRevision:0,attempts:1,content:{title:'馈赠',narrative:'启程',choices:[{id:'accept',label:'接受',outcome:source==='gift'?{card_removals:1}:{reward:{artifacts:[relic]}}}]}};opening(s,'accept');}
 else if(source==='reward-relic'){s.reward.artifact=[relic];s.reward.limits={artifacts:1};tx(s,{kind:'reward_claim',selections:{cards:[],artifacts:[0],items:[]},expectedRevision:0});}
 else {s.battle.artifacts=[relic];s[acq.INITIAL_ARTIFACT_ACQUISITION_KEY]=acq.createInitialArtifactAcquisitionReceipt([relic],'initial',0);tx(s,{kind:'initial_artifact_acquisition',generationId:'initial',answers:{},expectedRevision:0});}
 assert.equal(s.battle.core.card_removal_count,1,source);
 const h=harness(s),before=cards(h.stat());assert.equal(before.length,2);
 await new PendingCardRemoval().offer(h.ports);
 assert.equal(h.offers(),1,source);assert.equal(h.changes(),1);assert.equal(h.stat().battle.core.card_removal_count,0);
 assert.deepEqual(cards(h.stat()).map(x=>x.runInstanceId),[before[1].runInstanceId]);
 assert.equal(h.stat().run_transaction_events.at(-1).type,'card_removed');
 assert.deepEqual(cards(JSON.parse(JSON.stringify(h.stat()))),cards(h.stat()));
 const saved=structuredClone(h.stat());await assert.rejects(()=>h.host.removeCardWithAllowance(before[0].runInstanceId,saved.run_transaction_revision));assert.deepEqual(h.stat(),saved);
}
const s=base();s.battle.core.card_removal_count=2;
const h=harness(s),q=new PendingCardRemoval();let cancelled=0;
const cancel={...h.ports,choose:async()=>{cancelled++;return null}};
const untouched=structuredClone(h.stat());await q.offer(cancel);await q.offer(cancel);assert.equal(cancelled,1);assert.deepEqual(h.stat(),untouched);
// Unrelated run transactions must not reopen a removal prompt the player deferred.
h.stat().run_transaction_revision=1;await q.offer(cancel);assert.equal(cancelled,1);
await q.offer(cancel,true);assert.equal(cancelled,2,'the character-panel action force-resumes the deferred prompt');
h.stat().battle.core.card_removal_count=3;await q.offer(cancel);assert.equal(cancelled,3,'earning a new allowance reopens the prompt');
q.resetDismissal();await q.offer(cancel);assert.equal(cancelled,4);
h.stat().battle.core.card_removal_count=2;
await new PendingCardRemoval().offer(h.ports);assert.equal(cards(h.stat()).length,0);assert.equal(h.stat().battle.core.card_removal_count,0);assert.equal(h.offers(),2);
const stale=harness(s),id=cards(stale.stat())[0].runInstanceId;
await assert.rejects(()=>stale.host.removeCardWithAllowance(id,99),/stale/);
await assert.rejects(()=>stale.host.removeCardWithAllowance('missing',0));
assert.deepEqual(stale.stat(),s);
stale.latest(false);await assert.rejects(()=>stale.host.removeCardWithAllowance(id,0),/历史/);stale.latest(true);stale.ready(false);await assert.rejects(()=>stale.host.removeCardWithAllowance(id,0),/保存/);assert.deepEqual(stale.stat(),s);
const failedSave=harness(s),failedSaveId=cards(failedSave.stat())[0].runInstanceId,failedSaveBefore=structuredClone(failedSave.stat());
failedSave.failSave(true);await assert.rejects(()=>failedSave.host.removeCardWithAllowance(failedSaveId,0),/save failed/);assert.deepEqual(failedSave.stat(),failedSaveBefore,'a persistence failure must retain the card and allowance');
const concurrent=harness(s),queue=new PendingCardRemoval();let resolve;let count=0;
const waiting={...concurrent.ports,choose:()=>{count++;return new Promise(r=>resolve=r)}};
const first=queue.offer(waiting);await queue.offer(waiting);assert.equal(count,1);concurrent.active(false);resolve(id);await first;assert.deepEqual(concurrent.stat(),s);
const empty=harness({...s,battle:{...s.battle,cards:[]}});await new PendingCardRemoval().offer(empty.ports);assert.equal(empty.offers(),0);assert.equal(empty.stat().battle.core.card_removal_count,2);
console.log('PASS acquisition removal: gifts, acquired/initial relics, exact copies, save restore, cancel/resume, repeated/stale/invalid/historical requests, concurrent/destroyed view, empty deck');
const {describeCompactContent}=require('../src/game-core/contentDescription.ts');
const {compactContentToDisplayTags}=require('../src/game-core/effectDisplay.ts');
assert.match(describeCompactContent(relic),/领取后立即选择/);
assert.match(compactContentToDisplayTags(relic).map(x=>x.text).join('；'),/领取后立即选择/);
const reacquired=harness(s),reacquiredQueue=new PendingCardRemoval();let reacquiredOffers=0;
reacquired.stat().battle.core.card_removal_count=1;
const reacquiredPorts={...reacquired.ports,choose:async()=>{reacquiredOffers++;return null}};
await reacquiredQueue.offer(reacquiredPorts);reacquired.stat().battle.core.card_removal_count=0;await reacquiredQueue.offer(reacquiredPorts);
reacquired.stat().battle.core.card_removal_count=1;await reacquiredQueue.offer(reacquiredPorts);assert.equal(reacquiredOffers,2,'a newly reacquired allowance after zero must offer again');
