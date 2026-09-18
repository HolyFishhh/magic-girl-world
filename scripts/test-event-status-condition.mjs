import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const {createBattleEventJournal,appendBattleEvent,battleTriggerContextFromEvent}=require('../src/game-core/battleEventJournal.ts');
const {resolveStatusOwnershipTriggerDispatch}=require('../src/game-core/battleEventDispatch.ts');
const {TavernEffectCommandHost}=require('../src/fish/core/effectCommandHost.ts');
const {collectEffectProgramStatusReferences}=require('../src/game-core/statusDefinitionValidation.ts');
const compiled=compileCompactEffectList({block:2,to:'self',when:"stacks > 0 && event_status_is('annotation')"});
assert.equal(compiled.ok,true,JSON.stringify(compiled));
assert.deepEqual([...collectEffectProgramStatusReferences(compiled.value)],['annotation']);
for(const bad of ["event_status_is()","event_status_is('annotation', 'other')","event_status_is(status_id)","event_status_is('bad-id')"])
  assert.equal(compileCompactEffectList({block:2,when:bad}).ok,false,bad);
assert.equal(compileCompactEffectList({block:2,when:"event == 'status_applied' && source_id == 'annotation'"}).ok,false,'legacy ambiguous aliases remain rejected');
const actor={hp:10,maxHp:10,lust:0,maxLust:100,energy:0,maxEnergy:3,block:0};
let blocks=0;
const host=new TavernEffectCommandHost({readState:()=>({self:actor,opponent:actor}),isTerminal:()=>false,
  presentCommand:()=>{},executeCardCommand:async()=>{},chooseEffectOption:async()=>null,
  executeBattleCommand:async command=>{assert.equal(command.type,'gain_block');blocks+=command.amount;},executeSpecialCommand:async()=>{},
});
for(const [statusId,sourceId,expected] of [['annotation','scribe',2],['other','annotation',0]]) {
  const recorded=appendBattleEvent(createBattleEventJournal(),{kind:'status_applied',turn:1,phase:'resolve',
    actorId:'player',targetId:'player',statusId,statusName:statusId,statusType:'buff',stacks:1,trigger:'apply',
    cause:{source:{kind:'card',id:sourceId}},
  });
  assert.equal(recorded.ok,true,JSON.stringify(recorded));
  const context=battleTriggerContextFromEvent(recorded.event,recorded.state);
  assert.equal(context.statusId,statusId);assert.equal(context.sourceId,sourceId);
  const dispatches=resolveStatusOwnershipTriggerDispatch({target:'player',statusType:'buff',change:'gain',eventContext:context});
  const owned=dispatches.find(entry=>entry.trigger==='gain_buff');assert.ok(owned);
  const start=blocks;
  await host.executeProgram(compiled.value,true,{...owned.context,statusContext:{stacks:1}});
  assert.equal(blocks-start,expected,'current affected status, not event source, controls payoff');
  await host.executeProgram(compiled.value,true,{statusContext:{stacks:1}});
  assert.equal(blocks-start,expected,'next invocation without event cannot inherit prior identity');
}
const start=blocks;
await host.executeProgram(compiled.value,true,{kind:'card_played',statusId:'annotation',statusContext:{stacks:1}});
await host.executeProgram(compiled.value,true,{kind:'status_applied',statusId:'annotation',statusContext:{stacks:0}});
assert.equal(blocks,start,'wrong event kind and zero active stacks cannot trigger');
const core=require('../src/game-core/index.ts');
const definitions=[
  {id:'binding',name:'binding',emoji:'✨',type:'buff',stacks_change:'keep',triggers:{gain_buff:{block:2,to:'self',when:"stacks > 0 && event_status_is('annotation')"}}},
  ...['annotation','other'].map(id=>({id,name:id,emoji:'✨',type:'buff',stacks_change:'keep',triggers:{hold:{modify:'block',add:1}}})),
];
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const registryDraft={spec:'mwg.initial-draft/v1',narrative:'story',player:{core:{},cards:[{id:'watch',effects:{block:2,when:"event_status_is('annotation')"}}]},opening:{choices:[]},registry:{statuses:[definitions[1]],resources:[],templates:[]}};
const registryCompiled=compileInitialDraftToMvu(registryDraft);assert.equal(registryCompiled.ok,true);
assert.deepEqual(registryCompiled.value.player.statuses.map(status=>status.id),['annotation'],'predicate-only reference closes its real definition');
assert.equal(registryCompiled.value.player.player_status_effects,undefined,'query never applies the referenced status');
const missingRegistry=structuredClone(registryDraft);missingRegistry.registry.statuses=[];
assert.ok(compileInitialDraftToMvu(missingRegistry).diagnostics.some(issue=>issue.code==='UNKNOWN_STATUS_REF'&&issue.ref==='annotation'));
let store=new core.BattleStateStore(core.createEmptyBattleState()),journal=createBattleEventJournal();
store.addStatusEffect('player',{id:'binding',name:'binding',type:'buff',stacks:1});
const makeRuntime=()=>{
  const registry=new core.StatusDefinitionRegistry();registry.replace(JSON.parse(JSON.stringify(definitions)));
  let token=0;
  const runtime=new core.StatusLifecycleRuntime({state:store,definitions:{get:id=>registry.get(id),getTriggerEffects:(id,trigger)=>registry.getTriggerEffects(id,trigger)},
    transactions:{beginTransaction:()=>{const id=`status:${++token}`;store.createSnapshot(id);return id;},commitTransaction:id=>store.deleteSnapshot(id),rollbackTransaction:id=>{store.restoreSnapshot(id);store.deleteSnapshot(id);}},
    execute:(program,target,context)=>host.executeProgram(program,target==='player',context),
    record:event=>{
      if(event.type!=='status_applied')return undefined;
      const appended=appendBattleEvent(journal,{kind:'status_applied',turn:1,phase:'resolve',actorId:'player',targetId:event.target,
        statusId:event.status.id,statusName:event.status.name,statusType:event.status.type,stacks:event.status.stacks,trigger:event.trigger,
        cause:{source:{kind:'card',id:'scribe'}},
      });assert.equal(appended.ok,true);journal=appended.state;return battleTriggerContextFromEvent(appended.event,journal);
    },
    dispatch:async values=>{for(const dispatch of values)if(dispatch.consumer==='ability')await runtime.processEvent(dispatch.target,dispatch.trigger,dispatch.context);},
  });return runtime;
};
let runtime=makeRuntime();
const lifecycleStart=blocks;
await runtime.apply('player','annotation',1);
await runtime.apply('player','annotation',1);
await runtime.apply('player','other',1);
assert.equal(blocks-lifecycleStart,4,'real status lifecycle apply and stack each dispatch once, other status never pays');
store=new core.BattleStateStore(JSON.parse(JSON.stringify(store.getGameState())));
journal=JSON.parse(JSON.stringify(journal));runtime=makeRuntime();
await runtime.processEvent('player','gain_buff');
assert.equal(blocks-lifecycleStart,4,'offline reload does not revive a previous event context');
await runtime.apply('player','annotation',1);
assert.equal(blocks-lifecycleStart,6,'new event after offline reload still executes');
console.log('PASS event_status_is: journal -> ownership dispatch -> Tavern command host; distinct cause/affected IDs, exact payoff, no cross-invocation inheritance, old aliases rejected');
