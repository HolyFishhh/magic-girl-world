import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'commonjs',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {cardPaymentPlans,validateCardPayment,describeCardPayment}=require('../src/game-core/cardPayment.ts');
const {withAiContentDefinitions}=require('../src/game-core/aiContentJsonSchema.ts');
const {describeCompactCardRuleGroups}=require('../src/game-core/contentDescription.ts');
const {compactContentToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const payment={additional:{hp:3,discard:{count:1,card_type:'Skill'},sacrifice:{count:1,template_id:'moon'}},alternatives:[{id:'blood',name:'血誓',cost:0,hp:8}]};
const authored={id:'ritual',name:'祭礼',type:'Skill',cost:2,rarity:'Rare',quantity:1,payment,effects:{block:5}};
const schema=new Ajv2020({strict:false}).compile(withAiContentDefinitions({$ref:'#/$defs/mwgCard'}));
assert.equal(schema(authored),true,JSON.stringify(schema.errors));
const screenshotPayment = {alternatives:[{id:'blood',name:'以血献祭',cost:0,hp:9}]};
assert.deepEqual(describeCardPayment(screenshotPayment), ['可选替代：以血献祭，0⚡能量，支付9点生命（至少保留1点）']);
assert.doesNotMatch(describeCompactCardRuleGroups({...authored,payment:screenshotPayment}).join('；'),/替换全部通常费用|替代费用「/);
assert.match(compactContentToDisplayTags({...authored,payment:screenshotPayment}).map(tag=>tag.text).join('；'),/可选替代：以血献祭，0⚡能量，支付9点生命/);
assert.equal(validateCardPayment(payment),null);
for(const invalid of [{alternatives:[{id:'normal',name:'x',cost:0}]},{additional:{hp:0}},{additional:{discard:{count:1,bogus:2}}}]) assert.ok(validateCardPayment(invalid));

// Regression from the reported story-mode card trio: alternatives.additional is invalid,
// and flattening only that proven error slot preserves its exact HP payment semantics.
const storyOptions = [
  { id: 'guardian_barrier', name: '守护结界', hp: 6 },
  { id: 'piercing_starlight', name: '贯穿星光', hp: 4 },
  { id: 'desperate_blessing', name: '绝境加护', hp: 8 },
];
const storyCards = storyOptions.map(({ id, name, hp }) => ({
  id, name, type: 'Skill', rarity: 'Uncommon', cost: 2, quantity: 1,
  effects: { block: 5 },
  payment: { alternatives: [
    { id: 'magic', name: '消耗能量', cost: 2 },
    { id: 'blood', name: '以血施法', cost: 1, additional: { hp } },
  ] },
}));
for (const card of storyCards) {
  assert.match(validateCardPayment(card.payment), /alternatives\[1\]\.additional.*hp.*同层/);
  assert.equal(schema(card), false, 'story card with nested alternative additional fails official schema');
}
const correctedStoryCards = storyCards.map(card => ({ ...card, payment: {
  alternatives: [card.payment.alternatives[0], {
    id: card.payment.alternatives[1].id, name: card.payment.alternatives[1].name,
    cost: card.payment.alternatives[1].cost, hp: card.payment.alternatives[1].additional.hp,
  }],
} }));
for (const [index, card] of correctedStoryCards.entries()) {
  assert.equal(validateCardPayment(card.payment), null);
  assert.equal(schema(card), true, JSON.stringify(schema.errors));
  const choice = cardPaymentPlans(card, { hp: 30, hand: [card], resources: { energy: 2 } })
    .find(option => option.id === 'blood');
  assert.equal(choice.affordable, true);
  assert.equal(choice.extra.hp, storyOptions[index].hp, 'corrected HP cost remains executable');
}
assert.equal(core.validateContentPackContract(core.createContentPack({cards: correctedStoryCards})).ok, true,
  'all three corrected story cards pass the content contract together');

// Explicit inline generation validates the same template contract.
const template=core.compileCompactEffectList({add_card:'ritual'}, {creates:[Object.fromEntries(Object.entries(authored).filter(([k])=>k!=='quantity'))]});
assert.equal(template.ok,true,JSON.stringify(template));
assert.deepEqual(template.value.steps[0].card.payment,payment);
const nativeSchema=new Ajv2020({strict:false}).compile(JSON.parse(readFileSync('schemas/mwg-effect-v1.schema.json','utf8')));
assert.equal(nativeSchema(template.value),true,JSON.stringify(nativeSchema.errors));
const paidFormula=core.compileCompactEffectList({block:'event_paid_hp + event_paid_discard + event_paid_sacrifices'});
assert.equal(paidFormula.ok,true);assert.equal(nativeSchema(paidFormula.value),true,JSON.stringify(nativeSchema.errors));
const pendingFormula=core.compileCompactEffectList({damage:'pending_amount',to:'self'});
assert.equal(pendingFormula.ok,true);assert.equal(nativeSchema(pendingFormula.value),true,JSON.stringify(nativeSchema.errors));
assert.equal(core.validateEffectProgramPolicy(pendingFormula.value).ok,false,'ordinary effects cannot read a pending interception');
for(const text of [describeCompactCardRuleGroups(authored).join('；'),compactContentToDisplayTags(authored).map(x=>x.text).join('；')]) {
 assert.match(text,/支付3点生命/);assert.match(text,/弃置1张其他手牌/);assert.match(text,/献祭1个/);assert.match(text,/血誓/);
}
const card={...authored,effectProgram:{spec:'mwg-effect/v1',steps:[]}};
let state={phase:'player_turn',hasOpponent:true,hp:12,hand:[card,{id:'offering',name:'献物',type:'Skill',effectProgram:{}},{id:'attack',name:'斩',type:'Attack',effectProgram:{}}],energy:2,cardsPlayedThisTurn:0,summons:[{instanceId:'moon_1',templateId:'moon',name:'月灵',currentHp:8}]};
let prepared=core.prepareCardPlay(card.id,state);assert.equal(prepared.ok,true);assert.equal(prepared.paymentPlans.filter(p=>p.affordable).length,2);
let committed=core.commitCardPlay(prepared,state);assert.equal(committed.ok,true);assert.equal(committed.hp,9);assert.equal(committed.energy,0);assert.deepEqual(committed.hand.map(c=>c.id),['attack']);assert.deepEqual(committed.sacrificedIds,['moon_1']);assert.equal(committed.payment.paidDiscard,1);
prepared.selectedPayment={optionId:'blood',discardIds:[],sacrificeIds:[]};
committed=core.commitCardPlay(prepared,{...state,energy:0});assert.equal(committed.ok,true);assert.equal(committed.hp,4);assert.equal(committed.hand.length,2);assert.equal(committed.payment.paidSacrifices,0);
assert.equal(core.prepareCardPlay(card.id,{...state,hp:3,energy:0}).ok,false);
assert.equal(core.commitCardPlay({...prepared,selectedPayment:{optionId:'normal',discardIds:['attack'],sacrificeIds:['moon_1']}},state).ok,false);
assert.equal(core.commitCardPlay({...prepared,selectedPayment:{optionId:'normal',discardIds:['offering'],sacrificeIds:['moon_1']}},{...state,summons:[]}).ok,false);
assert.equal(cardPaymentPlans(card,{hp:3,hand:state.hand,summons:state.summons,resources:{energy:0}},'all').some(p=>p.affordable),false,'free must not waive HP');
const channel={id:'channel',name:'引流',type:'Skill',cost:9,xValueBonus:2,payment:{alternatives:[{id:'all_in',name:'倾注',cost:{energy:'all',moon:2}}]}};
let channelPlan=cardPaymentPlans(channel,{hp:12,hand:[channel],resources:{energy:4,moon:2}}).find(p=>p.id==='all_in');
assert.equal(channelPlan?.affordable,true);assert.deepEqual(channelPlan?.payment.spent,{energy:4,moon:2});assert.equal(channelPlan?.payment.xValue,6,'replacement X energy keeps its card bonus');
channelPlan=cardPaymentPlans(channel,{hp:12,hand:[channel],resources:{energy:4,moon:2}},'all').find(p=>p.id==='all_in');
assert.deepEqual(channelPlan?.payment.spent,{energy:0,moon:0});assert.equal(channelPlan?.payment.xValue,2,'free X preserves only its explicit bonus');
assert.deepEqual(core.prepareCardPlay(card.id,JSON.parse(JSON.stringify(state))),core.prepareCardPlay(card.id,state),'save parity');
assert.equal(core.commitCardPlay({...prepared,selectedPayment:{optionId:'normal',discardIds:null,sacrificeIds:[]}},state).ok,false,'corrupt restored selection rejects without throwing');
let commits=0,rollbacks=0,executions=0;
const before=structuredClone(state);
const paymentEvents=[];
const ports={gate:new core.BattleSessionActionGate(),readCardPlayState:()=>state,isTerminal:()=>false,beginTransaction:()=>structuredClone(state),commitTransaction:()=>{commits++},rollbackTransaction:s=>{state=s;rollbacks++},beginCardTransit:()=>{},endCardTransit:()=>{},applyCardPlayCommit:c=>{state={...state,...c}},executeCardEffect:(_card,_payment,index)=>{executions++;return index===0?1:0},movePlayedCard:()=>{},triggerPostCardPlay:()=>{},recordCardPlayEvent:(_card,payment,event)=>paymentEvents.push({replayIndex:event.replayIndex,phase:event.phase,paidHp:event.replayIndex===0?payment.paidHp:0,paidDiscard:event.replayIndex===0?payment.paidDiscard:0,paidSacrifices:event.replayIndex===0?payment.paidSacrifices:0})};
await assert.rejects(core.playBattleSessionCard(card.id,{...ports,chooseCardPayment:()=>{throw Object.assign(Error('cancel'),{code:'CHOICE_CANCELLED'})}}),/cancel/);
assert.deepEqual(state,before);assert.equal(rollbacks,1);assert.equal(executions,0);
await assert.rejects(core.playBattleSessionCard(card.id,{...ports,executeCardEffect:()=>{throw Error('effect failed')}}),/effect failed/);
assert.deepEqual(state,before);assert.equal(rollbacks,2);
paymentEvents.length=0;
const result=await core.playBattleSessionCard(card.id,ports);assert.equal(result.status,'completed');assert.equal(commits,1);assert.equal(executions,2);assert.equal(state.hp,9);assert.deepEqual(paymentEvents.map(e=>[e.replayIndex,e.phase,e.paidHp,e.paidDiscard,e.paidSacrifices]),[[0,'before',3,1,1],[0,'after',3,1,1],[1,'before',0,0,0],[1,'after',0,0,0]],'replay journals payment only on its first resolution');
console.log('PASS card payment: schema/compile/display, alternative X/resource affordability, exact HP/discard/sacrifice costs, free constraints, stale/corrupt choices, save parity, replay and cancellation/effect rollback');
