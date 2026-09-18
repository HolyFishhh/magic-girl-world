import assert from 'node:assert/strict';
import vm from 'node:vm';
import { startTowerFormExpression, initialProbeSnapshotExpression } from './lib/tavern-initial-probe.mjs';

for (const args of [['',{}], ['test',{run:{}}], ['test',{name:'x'.repeat(4001)}], ['test',[]]]) {
  assert.throws(()=>startTowerFormExpression(...args));
}
assert.throws(()=>initialProbeSnapshotExpression(null));
const harness = ({chatId='test',run=null,receipt,publication,busy=false,disabled=false,mode='tower'}={}) => {
  const inputs = new Map();
  const actions = [];
  const root={stat_data:{run,game_mode_lock:{mode},battle:{cards:[{quantity:2}]}},mwg_tower_initial_commit:receipt};
  const context={chatId,chat:[{is_user:false,swipe_id:1}],chatMetadata:{mwg_tower_initial_publication:publication}};
  const doc={getElementById(id) {
    if(id==='tower-start-button')return {disabled,click:()=>actions.push('start')};
    if(!inputs.has(id))inputs.set(id,{value:'stale',dispatchEvent:()=>actions.push(id)});
    return inputs.get(id);
  }};
  const sandbox=vm.createContext({SillyTavern:{getContext:()=>context},Mvu:{getMvuData:()=>root},
    MagicGirlDesignAssistant:{getTowerInitialPublicationStatus:()=>({ready:!busy,busy}),getTowerCoordinatorStatus:()=>({phase:'waiting'})},
    MagicGirlWorld:{getMvuMonitorSnapshot:()=>({phase:'success',generationId:'generation',detail:'done',timeline:[],
      reasoning:'DO NOT EXPORT',requestContent:'DO NOT EXPORT',rawOutput:'DO NOT EXPORT'})},
    document:{querySelector:()=>({contentDocument:doc})},Event:class {}});
  return {actions,inputs,run:expression=>vm.runInContext(expression,sandbox)};
};
for(const options of [{chatId:'other'},{run:{}},{busy:true},{disabled:true},{mode:'story'},{receipt:{}}]) {
  const h=harness(options);
  assert.throws(()=>h.run(startTowerFormExpression('test',{name:'测试'})));
  assert.equal(h.actions.length,0);
}
const valid=harness();
assert.equal(valid.run(startTowerFormExpression('test',{name:'新角色'})).dispatched,true);
assert.equal(valid.actions.at(-1),'start'); assert.equal(valid.actions.length,8);
assert.equal(valid.inputs.get('tower-start-name').value,'新角色');
assert.equal(valid.inputs.get('tower-start-card').value,'','unspecified fields do not inherit the previous form');

const receipt={chatId:'test',messageId:0,generationId:'g',stateDigest:'digest'};
const publication={...receipt,spec:'mwg.tower-initial-publication/v1',swipeId:1};
for(const options of [{},{receipt},{receipt,publication:{...publication,swipeId:0}},
  {receipt,publication:{...publication,stateDigest:'other'}},{receipt,publication,busy:true}]) {
  assert.notEqual(harness(options).run(initialProbeSnapshotExpression('test')).phase,'published-in-memory');
}
const snapshot=harness({receipt,publication}).run(initialProbeSnapshotExpression('test'));
assert.equal(snapshot.phase,'published-in-memory'); assert.equal(snapshot.requiresDiskVerification,true);
assert.equal(snapshot.cardQuantity,2);
assert.doesNotMatch(JSON.stringify(snapshot),/DO NOT EXPORT|reasoning|requestContent|rawOutput/);
assert.throws(()=>harness({chatId:'other'}).run(initialProbeSnapshotExpression('test')),/changed/);
console.log('Initial form probe preserves saves, validates scope and never confuses UI publication with disk verification.');
