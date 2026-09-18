import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {resolveCardLifecycle,validateCardLifecycle,describeCardTraits}=require('../src/game-core/cardLifecycle.ts');
const {resolvePlayedCardDestination,resolveTurnEndHandDisposition}=require('../src/game-core/cardRules.ts');
const {BattleStateStore,createEmptyBattleState}=require('../src/game-core/battleState.ts');
const {CardSystem}=require('../src/fish/combat/cardSystem.ts');
const {convertMvuCards}=require('../src/fish/core/mvuBattleAdapter.ts');
const {finalizeRuntimeCardProgression}=require('../src/fish/core/battleEndHost.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const {renderCardFace}=require('../src/shared/cardFace.ts');
const {describeDisplayCardTraits}=require('../src/shared/cardTraits.ts');
const traitNames=(card,context)=>describeDisplayCardTraits(card,context).map(t=>t.name);
assert.ok(traitNames({type:'Curse'}).includes('不可打出'));
assert.ok(!traitNames({type:'Curse',discard_effects:{hp_loss:3}}).includes('回合结束时'));
assert.ok(traitNames({type:'Curse',effects:{hp_loss:3}}).includes('回合结束时'));
assert.ok(!traitNames({type:'Curse'},{playAccess:'allowed'}).includes('不可打出'));
assert.ok(traitNames({type:'Skill'},{playAccess:'denied'}).includes('不可打出'));
assert.ok(!traitNames({origin:'generated'}).includes('临时·战后消失'));
assert.ok(traitNames({origin:'generated'},{temporary:true}).includes('临时·战后消失'));
assert.ok(traitNames({origin:'copied',parentCombatInstanceId:'root'}).includes('临时·战后消失'));
assert.ok(!traitNames({origin:'copied'}).includes('临时·战后消失'));
assert.ok(!traitNames({discardEffectProgram:{spec:'mwg.effect/v1',steps:[]}}).includes('弃置时'));
assert.ok(traitNames({discard_effects:{block:1}}).includes('弃置时'));
const attachment={id:'a',priority:0,changes:[{kind:'play_access',mode:'allow'},{kind:'dynamic_cost',timing:'on_draw',operator:'add',value:1}]};
assert.ok(!traitNames({type:'Curse',attachments:[attachment]}).includes('不可打出'));
assert.equal(traitNames({attachments:[attachment,attachment]}).filter(n=>n==='抽到时').length,1);
const {renderCardTraits}=require('../src/shared/cardTraits.ts');
const crowded=renderCardTraits({type:'Curse',innate:true,exhaust:true,lifecycle:{on_discard:'exhaust'}},{compact:true});
assert.equal((crowded.match(/class="card-trait /g)||[]).length,3);
assert.match(crowded,/特性 \+/);
assert.match(crowded,/弃置消耗/);
const {createContentPack,validateContentPackContract}=require('../src/game-core/index.ts');
for(const on_play of ['discard','exhaust','purge']) for(const on_discard of ['discard','exhaust','purge']) for(const turn_end of ['discard','retain','exhaust']) {
  const lifecycle={on_play,on_discard,turn_end};const c={id:'one',type:'Curse',effectProgram:{},lifecycle};
  assert.equal(validateCardLifecycle(lifecycle),null);
  assert.deepEqual(resolveCardLifecycle(c),lifecycle);
  assert.equal(resolvePlayedCardDestination(c),on_play==='purge'?'remove':on_play);
  assert.equal(resolveTurnEndHandDisposition([c])[turn_end==='retain'?'keep':turn_end].length,1);
}
assert.ok(validateCardLifecycle({on_play:'permanent'}));
const definitions=[{id:'curse',name:'测试诅咒',emoji:'🕸',type:'Curse',rarity:'Common',quantity:1,lifecycle:{turn_end:'retain',on_discard:'exhaust'}},{id:'purge',name:'测试销毁',emoji:'🃏',type:'Skill',rarity:'Rare',cost:0,quantity:2,effects:{block:1},lifecycle:{on_play:'purge'}}];
const cards=convertMvuCards(definitions);assert.equal(cards.length,3);assert.equal(cards[0].lifecycle.on_discard,'exhaust');
assert.equal(validateContentPackContract(createContentPack({cards:definitions})).ok,true);
assert.equal(validateContentPackContract(createContentPack({cards:[{...definitions[0],lifecycle:{turn_end:'bad'}}]})).ok,false);
for(const reason of ['effect','player_choice','turn_cleanup']) {
  const state=createEmptyBattleState();state.phase='player_turn';state.player.hand=[cards[0]];state.player.deck=cards;
  const store=new BattleStateStore(state);const host=Object.create(CardSystem.prototype);
  host.gameStateManager=store;host.triggerDiscardEffect=async()=>{};host.dispatchPlayerTrigger=async()=>{};
  host.relicTriggerHost={triggerRelics:async()=>{}};host.presentation={animateCardDeparture:()=>{},logDiscardCardDetail:()=>{},addLog:()=>{}};
  await host.discardCard(cards[0].id,reason);
  assert.equal(store.getPlayer().exhaustPile.length,reason==='turn_cleanup'?0:1);
  assert.equal(store.getPlayer().discardPile.length,reason==='turn_cleanup'?1:0);
}
const state=createEmptyBattleState();state.player.deck=cards;const store=new BattleStateStore(state);
store.purgeOwnedCard({...cards[1],origin:'copied',parentCombatInstanceId:cards[1].id});assert.equal(store.getGameState().purgedRunInstanceIds,undefined);
store.purgeOwnedCard(cards[1]);store.purgeOwnedCard(cards[1]);assert.deepEqual(store.getGameState().purgedRunInstanceIds,[cards[1].runInstanceId]);
const restored=new BattleStateStore(store.getGameState());
const final=finalizeRuntimeCardProgression(restored,{stat_data:{battle:{cards:definitions}}},false);
assert.equal(final.length,2);assert.ok(final.some(c=>c.runInstanceId===cards[2].runInstanceId));
assert.ok(!final.some(c=>c.runInstanceId===cards[1].runInstanceId));
const html=renderCardFace(cards[0],{costLabel:'—',rarityLabel:'普通',typeLabel:'诅咒'});
assert.match(html,/保留/);assert.match(html,/弃置消耗/);assert.match(html,/data-status-rules/);
const {quantity,...template}=definitions[0];
const generated=compileCompactEffectList({add_card:'curse',count:1},{creates:[template]});
assert.equal(generated.ok,true,JSON.stringify(generated));
assert.equal(generated.value.steps[0].card.lifecycle.on_discard,'exhaust');
assert.equal(compileCompactEffectList({add_card:'curse',count:1},{creates:[{...template,lifecycle:{on_play:'wrong'}}]}).ok,false);
assert.ok(describeCardTraits(cards[1]).some(t=>t.name==='销毁·永久'));
console.log('27 lifecycle combinations, discard causes, exact permanent identity, temporary-copy safety, session restore and settlement passed.');
const {animateCardDeparture}=require('../src/fish/ui/cardLifecycleAnimation.ts');
const effects=[],timers=[];
global.document={
  getElementById:()=>({getBoundingClientRect:()=>({left:10,top:20,width:500,height:180})}),
  querySelectorAll:()=>[],body:{append:x=>effects.push(x)},
  createElement:()=>({children:[],style:{setProperty(){}},setAttribute(){},append(x){this.children.push(x)},remove(){this.removed=true}}),
};
global.window={setTimeout:fn=>timers.push(fn),matchMedia:()=>({matches:false})};
animateCardDeparture(cards[1],'exhaust');animateCardDeparture(cards[1],'purge');
assert.equal(effects[0].className,'card-departure departure-exhaust');
assert.equal(effects[1].children.length,6);timers.forEach(fn=>fn());assert.ok(effects.every(x=>x.removed));
delete global.document;delete global.window;
console.log('Burn/shatter dispatch, six shards and bounded cleanup passed.');
