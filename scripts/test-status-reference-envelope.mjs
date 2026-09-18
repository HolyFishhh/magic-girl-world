import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {normalizeMvuPlayerAuthoredContent:normalize}=require('../src/runtime/mvuBattleContentNormalizer.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
for(const operation of ['apply_status','remove_status'])for(const to of ['self','opponent',undefined]){
  const fields={...(operation==='apply_status'?{stacks:2}:{}),...(to?{to}:{})};
  const value={effects:{[operation]:{status_id:'resonance',...fields},when:'self.hp > 0'}};
  const before=structuredClone(value);
  const expected={effects:{[operation]:'resonance',...fields,when:'self.hp > 0'}};
  assert.deepEqual(normalize(value),expected,'closed alias envelope only moves explicit fields');
  assert.deepEqual(value,before);
  assert.deepEqual(normalize(normalize(value)),expected,'idempotent');
  const compiled=compileCompactEffectList(normalize(value).effects);
  assert.equal(compiled.ok,true,'the preserved operation must still be executable');
  assert.deepEqual(compiled,compileCompactEffectList(expected.effects),
    'canonical execution program exactly matches explicit authored recipient and stacks');
}
const envelope={apply_status:{status_id:'resonance',stacks:2,to:'self'}};
const nested={player:{cards:[{id:'card',name:'Card',effects:[envelope]}]},opening:{choices:[{id:'gift',outcome:{reward:{items:[{id:'item',name:'Item',effects:envelope}]}}}]},
  registry:{statuses:[{id:'status',triggers:{turn_end:envelope}}],templates:[{id:'template',name:'Template',effects:envelope}]}};
const expected={apply_status:'resonance',stacks:2,to:'self'};
const normal=normalize(nested);
assert.deepEqual(normal.player.cards[0].effects[0],expected);
assert.deepEqual(normal.opening.choices[0].outcome.reward.items[0].effects,expected);
assert.deepEqual(normal.registry.statuses[0].triggers.turn_end,expected);
assert.deepEqual(normal.registry.templates[0].effects,expected);
for(const value of [
  {apply_status:{status_id:'resonance',id:'other',stacks:2,to:'self'}},
  {apply_status:{status_id:'resonance',id:null,stacks:2}},
  {apply_status:{status_id:'',stacks:2}},
  {apply_status:{status_id:'resonance',stacks:2,to:'self'},to:'opponent'},
  {apply_status:{status_id:'resonance',stacks:2},stacks:3},
  {apply_status:{status_id:'resonance',stacks:2,unknown_mechanic:1}},
  {apply_status:{status_id:'resonance',stacks:2,triggers:{turn_end:{damage:1}}}},
  {remove_status:{status_id:'resonance',stacks:2}},
])assert.deepEqual(normalize({effects:value}),{effects:value},'conflicting/unknown/inline-rule envelopes remain invalid, never silently dropped');
assert.deepEqual(normalize({effects:{apply_status:{id:'resonance',status_id:'resonance',stacks:2}}}),
  {effects:{apply_status:'resonance',stacks:2}},'identical ID aliases agree');
assert.deepEqual(normalize({effects:{apply_status:{status_id:'resonance',stacks:2},description:'增益自己'}}),
  {effects:{apply_status:'resonance',stacks:2,description:'增益自己'}},'never invent a recipient from prose');
console.log('PASS status reference envelopes: exact ID alias, authored target/stacks, all draft owners, idempotence, conflict/unknown preservation; no semantic inference.');
