import assert from 'node:assert/strict';
import vm from 'node:vm';
import { cardActionsExpression } from './lib/tavern-battle-probe.mjs';

for (const args of [[null,'node',[]], ['chat',{},[]], ['chat','node',['']],
  ['chat','node',Array(7).fill('card')], ['chat','node',[],'yes']]) {
  assert.throws(() => cardActionsExpression(...args), /explicit test scope/);
}

// The probe may call existing handlers, never patch battle data. Fake handlers below
// belong only to this isolated unit test, not to a real Tavern session.
const makeHarness = ({chat='chat', node='node', phase='player_turn', stall=false, changeChat=false}={}) => {
  const state = {currentTurn:1,phase,isGameOver:false,battleResult:'ongoing',
    player:{hand:[{id:'card',cost:1,description:'draw'}],energy:3,currentHp:42},enemy:{currentHp:10,block:0},summons:{living:[]}};
  const stats = {clicks:0,turns:0,ticks:0};
  const doc = {querySelectorAll(selector) {
    return selector === '[data-card-id]' ? [{getAttribute:()=> 'card',classList:{contains:()=>true},click() {
      stats.clicks++;
      if (!stall && stats.clicks === 2) state.player.hand=[];
    }}] : [{textContent:'结束回合',disabled:false,click() { stats.turns++; if (!stall) state.currentTurn++; }}];
  }};
  const context = vm.createContext({SillyTavern:{getContext:()=>({chatId:chat})},
    Mvu:{getMvuData:()=>({stat_data:{run:{currentNode:{id:node}}},__magic_girl_world:{battle_session:{state}}})},
    document:{querySelector:()=>({contentDocument:doc})},
    setTimeout(callback) { stats.ticks++; if(changeChat) chat='other-chat'; callback(); }});
  return {stats,run:(ids=[],end=false)=>vm.runInContext(cardActionsExpression('chat','node',ids,end),context)};
};
for (const options of [{chat:'other'}, {node:'other'}, {phase:'enemy_turn'}]) {
  const h=makeHarness(options);
  await assert.rejects(h.run(['card']), /changed|action window/);
  assert.equal(h.stats.clicks,0);
}
const changed=makeHarness({changeChat:true});
await assert.rejects(changed.run(['card'],true),/changed/);
assert.equal(changed.stats.turns,0);
const normal=makeHarness();
const result=JSON.parse(await normal.run(['card'],true));
assert.equal(normal.stats.clicks,2); assert.equal(normal.stats.turns,1);
assert.equal(result.round,2); assert.deepEqual(result.hand,[]);
const stalled=makeHarness({stall:true});
await assert.rejects(stalled.run(['card']),/card not settled/);
assert.equal(stalled.stats.ticks,60);
const stalledTurn=makeHarness({stall:true});
await assert.rejects(stalledTurn.run([],true),/turn has not settled/);
assert.equal(stalledTurn.stats.ticks,80);
console.log('Battle development probe scope, existing handlers and bounded waits passed.');
