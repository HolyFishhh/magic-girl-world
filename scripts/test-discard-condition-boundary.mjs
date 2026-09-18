import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {compileCompactEffectList} = require('../src/game-core/compactEffectDsl.ts');

// Exact effect fragment from real initial47, not a new model success sample.
// The conditional reward must never become unconditional or query played cards.
const effects = [
  {discard:1,from:'hand',pick:'choose'},
  {energy:2,when:"last_discarded_card_type == 'attack'"},
];
const before = structuredClone(effects);
const result = compileCompactEffectList(effects);
assert.equal(result.ok,false,'unsupported discard-result query must fail closed');
assert.deepEqual(effects,before,'validation must not erase the conditional reward');
assert.ok(result.issues.some(issue => JSON.stringify(issue).includes('last_discarded_card_type')));
// The similar-looking public function has DIFFERENT semantics. It is not a fix.
const played = compileCompactEffectList({energy:2,when:"last_card_type('Attack')"});
assert.equal(played.ok,true);
console.log('Real47 condition boundary retained: unsupported discard query rejected, input unchanged; played-card predicate is not a semantic replacement. No live acceptance claimed.');

const core = require('../src/game-core/index.ts');
const {ReferenceBattleRuntimeHost} = require('../src/adapters/referenceBattleRuntimeHost.ts');
const {TavernEffectCommandHost} = require('../src/fish/core/effectCommandHost.ts');
const authored = compileCompactEffectList([{discard:1,from:'hand',pick:'choose'},{energy:2,when:"discarded_card_type('Attack')"}]);
assert.equal(authored.ok,true);
const conditionalOnly = compileCompactEffectList({energy:2,when:"discarded_card_type('Attack')"}).value;
for(const variant of ['Attack','Skill','cancel','empty','nested','error','multi','draw','cancel_after_success','unsupported']) {
  const state = core.createEmptyBattleState();
  const makeCard = (id,type) => ({id,name:id,type,cost:1,rarity:'Common',emoji:'x',description:id});
  state.player.hand = variant === 'empty' ? [] : [makeCard('chosen',variant === 'Skill' ? 'Skill' : 'Attack')];
  if(variant === 'nested') state.player.hand.push(makeCard('nested','Skill'));
  if(variant === 'multi' || variant === 'cancel_after_success') state.player.hand.push(makeCard('second','Attack'));
  if(variant === 'draw') { state.player.drawPile=state.player.hand;state.player.hand=[]; }
  const backing = new ReferenceBattleRuntimeHost(state);
  let earned = 0;
  let selections = 0;
  const runtime = backing.createCardEffectRuntime({
    drawCards:async()=>{},
    chooseCards:async cards => {
      selections++;
      if(variant === 'cancel' || (variant === 'cancel_after_success' && selections === 2)) return null;
      return variant === 'multi' ? cards.map(card=>card.id) : [cards[0].id];
    },
    onCardExhausted:async()=>{},
    onCardDiscarded:async entry => {
      if(variant === 'error') throw Error('lifecycle failure');
      if(variant === 'nested' && entry.id === 'chosen') {
        entry.type='Curse';
        await host.executeProgram(authored.value,true);
      }
    },
  });
  const actor = {hp:10,maxHp:10,lust:0,maxLust:100,energy:0,maxEnergy:9,block:0};
  const host = new TavernEffectCommandHost({
    readState:()=>({self:actor,opponent:actor}),isTerminal:()=>false,presentCommand:()=>{},
    executeCardCommand:async(command,context)=>{await runtime.execute(command,variant === 'unsupported' ? {} : context);},
    executeBattleCommand:async command=>{assert.equal(command.type,'gain_energy');earned+=command.amount;},
  });
  const steps = [{discard:variant === 'multi'?2:1,from:variant === 'draw'?'draw':'hand',pick:'choose'}];
  if(variant === 'cancel_after_success') steps.push({discard:1,from:'hand',pick:'choose'});
  steps.push({energy:2,when:"discarded_card_type('Attack')"});
  const variantProgram=compileCompactEffectList(steps);assert.equal(variantProgram.ok,true);
  if(variant === 'error') await assert.rejects(host.executeProgram(variantProgram.value,true),/lifecycle failure/);
  else if(variant === 'unsupported') await assert.rejects(host.executeProgram(variantProgram.value,true),/宿主没有提供/);
  else await host.executeProgram(variantProgram.value,true);
  assert.equal(earned,['Attack','nested'].includes(variant)?2:0,variant);
  await host.executeProgram(conditionalOnly,true);
  assert.equal(earned,['Attack','nested'].includes(variant)?2:0,'next invocation has no inherited result');
}
assert.equal(compileCompactEffectList({energy:2,when:"discarded_card_type('Attack','Skill')"}).ok,false);
console.log('DSL -> Tavern command host -> real card-zone commit -> conditional energy: Attack/Skill/cancel/empty/nested mutation/lifecycle failure and invocation isolation passed.');

// Portable hosts must not silently turn a missing result capability into false.
let unsupportedEarned=0;
await assert.rejects(core.runEffectCommandProgram(authored.value,{spentEnergy:0},{
  readState:()=>({}),execute:command=>{if(command.type==='gain_energy')unsupportedEarned+=command.amount;},
}),/宿主没有提供/);
assert.equal(unsupportedEarned,0);
const labels=JSON.stringify(core.effectProgramToDisplayTags(authored.value));
assert.match(labels,/最近一次弃牌恰好弃掉一张手牌/);
assert.doesNotMatch(labels,/上一张打出的牌/);
const inherited={spentEnergy:0,discardResult:{status:'committed',cards:[{id:'old',type:'Attack',source:'hand'}]}};
const inheritedBefore=structuredClone(inherited);
await core.runEffectCommandProgram(conditionalOnly,inherited,{
  readState:()=>({}),execute:()=>{throw Error('inherited result must not grant a reward');},
});
assert.deepEqual(inherited,inheritedBefore,'local result reset must not mutate caller context');
console.log('Extended matrix passed: multi-card, draw-pile source, success then cancellation, unsupported Tavern/portable hosts, derived rules and caller-context isolation.');
