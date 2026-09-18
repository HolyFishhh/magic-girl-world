import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const store=new core.BattleStateStore(core.createEmptyBattleState());
const registry=new core.StatusDefinitionRegistry();
assert.deepEqual(registry.replace([{id:'echo',name:'回声',emoji:'🔔',type:'buff',stacks_change:-1,
 triggers:{apply:{block:1},stack:{block:1},remove:{block:1},tick:{block:1},turn_start:{block:1}}}]).rejected,[]);
const seen=[];
const runtime=new core.StatusLifecycleRuntime({state:store,definitions:registry,
 transactions:{beginTransaction:()=>{store.createSnapshot('event');return 'event';},commitTransaction:t=>store.deleteSnapshot(t),rollbackTransaction:t=>store.restoreSnapshot(t)},
 record:e=>e.type==='trigger_completed'?undefined:{kind:e.type,statusId:e.status.id,actorId:'player',targetId:'player'},
 execute:async(_effect,_target,context)=>seen.push(structuredClone(context)),dispatch:async()=>{}});
await runtime.apply('player','echo',1);
await runtime.apply('player','echo',1);
await runtime.processEvent('player','turn_start',{},['echo']);
await runtime.remove('player','echo');
await runtime.apply('player','echo',1);
await runtime.processActionTiming('player','before_action');
await runtime.processTurnEnd('player');
assert.deepEqual(seen.map(c=>[c.triggerType,c.kind,c.statusId]),[
 ['apply','status_applied','echo'],['stack','status_applied','echo'],['turn_start',undefined,undefined],
 ['remove','status_removed','echo'],['apply','status_applied','echo'],['tick',undefined,undefined],['remove','status_removed','echo']]);
assert.deepEqual(seen.filter(c=>c.kind).map(c=>c.statusContext.stacks),[1,2,2,1,1]);
console.log('PASS status apply/stack/explicit remove/decay remove use their own recorded event; tick and turn_start do not inherit it.');

// Both owners and distinct holders must keep their own identity, including after reload.
for (const owner of ['player', 'enemy']) {
  const summonStore = new core.BattleStateStore(core.createEmptyBattleState());
  const holders = summonStore.spawnSummons(owner, {
    id: 'event_holder', name: '事件持有者', emoji: '🔔', maxHp: 8,
  }, 2).spawned;
  assert.equal(holders.length, 2);
  const contexts = [];
  let sequence = 0;
  const summonRuntime = new core.SummonStatusLifecycleRuntime({
    state: summonStore, definitions: registry,
    transactions: {
      beginTransaction: () => { const id = `summon_event_${++sequence}`; summonStore.createSnapshot(id); return id; },
      commitTransaction: id => summonStore.deleteSnapshot(id),
      rollbackTransaction: id => { summonStore.restoreSnapshot(id); summonStore.deleteSnapshot(id); },
    },
    record: event => event.type === 'trigger_completed' ? undefined : {
      kind: event.type, statusId: event.status.id, actorId: owner, targetId: event.summon.instanceId,
    },
    execute: async (_effect, source, context) => contexts.push({ source, ...structuredClone(context) }),
  });
  for (const holder of holders) {
    const ids = [holder.instanceId];
    await summonRuntime.apply(ids, 'echo', 1);
    await summonRuntime.apply(ids, 'echo', 1);
    await summonRuntime.remove(ids, 'echo');
    await summonRuntime.apply(ids, 'echo', 1);
  }
  summonStore.writeSummons(JSON.parse(JSON.stringify(summonStore.readSummons())));
  for (const holder of holders) await summonRuntime.processActionTiming(holder.instanceId,'before_action');
  await summonRuntime.processTurnEnd(owner);
  for (const holder of holders) {
    const own = contexts.filter(c => c.summonContext.instanceId === holder.instanceId);
    assert.deepEqual(own.map(c => [c.triggerType, c.kind]), [
      ['apply', 'status_applied'], ['stack', 'status_applied'], ['remove', 'status_removed'],
      ['apply', 'status_applied'], ['tick', undefined], ['remove', 'status_removed'],
    ]);
    for (const context of own.filter(c => c.kind)) {
      assert.equal(context.targetId, holder.instanceId);
      assert.equal(context.statusId, 'echo');
      assert.equal(context.source, owner);
    }
    assert.equal(summonStore.getSummonById(holder.instanceId).statusEffects.length, 0);
  }
}
console.log('PASS summon lifecycle event identity for both owners and two holders across JSON reload.');
