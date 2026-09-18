import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {ReferenceBattleRuntimeHost}=require('../src/adapters/referenceBattleRuntimeHost.ts');
const {convertMvuCards}=require('../src/fish/core/mvuBattleAdapter.ts');
const formulaState={self:{hp:20,maxHp:20,lust:0,maxLust:100,energy:3,maxEnergy:3,block:0,statusStacks:{liberation:3}},opponent:{hp:50,maxHp:50,lust:0,maxLust:100,energy:0,maxEnergy:0,block:0,statusStacks:{}},currentTurn:1,cardsPlayedThisTurn:0,attacksPlayedThisTurn:0,skillsPlayedThisTurn:0};
const author={id:'liberation_burst',name:'解放爆发',type:'Attack',rarity:'Rare',cost:2,unique:true,quantity:1,effects:[{damage:'self.status.liberation.stacks >= 3 ? 18 : 10',lifesteal:0.5}]};
const cards=convertMvuCards([author,{...author,id:'other_attack',name:'另一攻击',unique:false},{id:'guard',name:'格挡',type:'Skill',rarity:'Common',cost:2,effects:{block:5}}]);
const context={state:formulaState,effect:{spentEnergy:0}};
const state=core.createEmptyBattleState();state.phase='player_turn';state.player.energy=1;state.player.hand=cards.map(c=>core.snapshotDynamicCardCostOnDraw(c,[],context));
// Restore an old save's fixed-cost snapshot too: it must not override new reductions.
state.player.hand[1].drawCostOverride=2;delete state.player.hand[1].drawnCostRules;
const host=new ReferenceBattleRuntimeHost(state);
const runtime=host.createCardEffectRuntime({drawCards:async()=>{},chooseCards:async cards=>cards.map(c=>c.id),onCardDiscarded:async()=>{},onCardExhausted:async()=>{}});
await runtime.execute({type:'reduce_card_cost',selector:{zone:'hand',pick:'all',filter:{types:['Attack']}},amount:1},{currentTurn:1});
const updated=host.getPlayer().hand;
assert.deepEqual(updated.map(c=>c.cost),[1,1,2]);
for(const card of updated.slice(0,2)) {
 const playState={phase:'player_turn',hasOpponent:true,hand:updated,energy:1,cardsPlayedThisTurn:0,dynamicCostRules:[],dynamicCostState:formulaState,dynamicCostContext:{spentEnergy:0}};
 const prepared=core.prepareCardPlay(card.id,playState);assert.equal(prepared.ok,true);assert.equal(prepared.payment.spentEnergy,1);
 assert.equal(core.commitCardPlay(prepared,playState).energy,0);
 const restored=JSON.parse(JSON.stringify(card));assert.equal(core.resolveDynamicCardCostAtPlay(restored,[],context),1,'save restores the same immediate cost');
}
const display=core.effectProgramToDisplayTags(cards[0].effectProgram,{statusNames:{liberation:'解放度'},damageAmountText:n=>String(n.amount+1)+'↑'}).map(t=>t.text).join('；');
assert.match(display,/造成11↑点伤害；如果.*解放度.*则造成19↑点伤害/);assert.match(display,/0.5倍恢复生命/);assert.doesNotMatch(display,/否则/);
const original=JSON.stringify(author);const publicText=core.describeCompactCard(author,{statusNames:{liberation:'解放度'}});
assert.match(publicText,/造成10点伤害；如果.*则造成18点伤害/);assert.equal(JSON.stringify(author),original);
// Freeze the operand of a real on-draw rule, but keep later base-cost patches live.
const dynamic=core.snapshotDynamicCardCostOnDraw({...cards[0],cost:4},[{id:'draw',source:{kind:'status',id:'draw'},timing:'on_draw',scope:'combat',operator:'subtract',value:{op:'var',path:'battle.turn_number'}}],context);
const reduced=core.appendCardPatch(dynamic,{id:'later',source:{kind:'card',id:'discount'},scope:'combat',createdTurn:1,priority:0,removeOn:'combat_end',kind:'cost',operator:'subtract',value:1});
assert.equal(core.resolveDynamicCardCostAtPlay(JSON.parse(JSON.stringify(reduced)),[],{...context,state:{...formulaState,currentTurn:9}}),2);
assert.equal('drawnCostRules' in core.clearDynamicCardCostAfterPlay(reduced),false);
console.log('PASS authored discount -> immediate filtered cost -> payment -> JSON restore; conditional damage/lifesteal display; frozen draw operands');

const scaled=convertMvuCards([{...author,effects:[{damage:'5 + self.status.liberation.stacks * 3',lifesteal:1}]}])[0];
const scaledText=core.effectProgramToDisplayTags(scaled.effectProgram,{statusNames:{liberation:'解放度'},damageAmountText:()=> '29↑'}).map(t=>t.text).join('；');
assert.match(scaledText,/解放度.*3/);assert.match(scaledText,/当前预计 29↑/);assert.match(scaledText,/1倍恢复生命/);
