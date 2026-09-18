import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=label=>JSON.parse(readFileSync(`tmp/play82-${label}.json`,'utf8'));
const labels=['before-gift','after-gift','battle-start','watcher-played','ink-applied','attack-discarded'];
const captures=labels.map(read);
for(const c of captures){assert.equal(c.chatId,captures[0].chatId);assert.equal(c.swipeId,captures[0].swipeId);}
const before=captures[0].root.stat_data.battle.cards,after=captures[1].root.stat_data.battle.cards;
assert.equal(after.length,before.reduce((n,c)=>n+c.quantity,0));
for(const card of before){
 const instances=after.filter(c=>c.id===card.id);
 assert.equal(instances.length,card.quantity);
 for(const instance of instances){
  assert.equal(instance.quantity,1);
  for(const key of Object.keys(card).filter(k=>k!=='quantity'))assert.deepEqual(instance[key],card[key]);
 }
}
const state=i=>captures[i].root.__magic_girl_world.battle_session.state;
const watcher=state(3),applied=state(4),discarded=state(5);
assert.equal(watcher.player.block,0,'non-target echo_binding gain must not pay');
assert.deepEqual(watcher.player.statusEffects.map(s=>s.id),['echo_binding']);
assert.equal(applied.player.block,1,'ink_stained gain pays exactly once');
const generated=applied.player.hand.find(c=>c.id==='ink_scribble__1');
assert.equal(generated.origin,'generated');assert.equal(generated.type,'Attack');
assert.ok(!watcher.player.hand.some(c=>c.id===generated.id));
assert.ok(discarded.player.discardPile.some(c=>c.id===generated.id));
assert.ok(!discarded.player.hand.some(c=>c.id===generated.id));
const expectedExisting=applied.player.hand.filter(c=>!['ink_scribble__1','marginalia_echo__1'].includes(c.id));
const drawn=discarded.player.hand.filter(c=>!expectedExisting.some(e=>e.id===c.id));
assert.equal(drawn.length,2,'actual Attack discard must unlock draw2');
for(const c of drawn)assert.ok(applied.player.drawPile.some(d=>d.id===c.id));
assert.equal(discarded.player.energy,0);
assert.equal(discarded.player.block,1);
console.log('PASS sample82 live UI: gift only instantiates authored deck; non-target status no payoff; target gain pays and creates own template; actual generated Attack discard draws2. Not stack/reload/full battle or overall acceptance.');
