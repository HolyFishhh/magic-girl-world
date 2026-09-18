import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {describeCompactEffectList,describeCompactStatus}=require('../src/game-core/contentDescription.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const {effectProgramToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const options={statusNames:{ink_stained:'墨渍',stacks:'积痕'}};
for(const expression of ["event_status_is('ink_stained')",'event_status_is("ink_stained")',"stacks > 0 && event_status_is('ink_stained')","!event_status_is('ink_stained')","event_status_is('stacks')"]){
 const effect={block:1,to:'self',when:expression},original=structuredClone(effect);
 const compact=describeCompactEffectList(effect,undefined,options),compiled=compileCompactEffectList(effect);
 assert.equal(compiled.ok,true);
 const ast=effectProgramToDisplayTags(compiled.value,options).map(t=>t.text).join('；');
 for(const text of [compact,ast]){
  assert.match(text,/本次获得、叠加或移除的状态为/);
  assert.match(text,expression.includes("'stacks'")?/积痕/:/墨渍/);
  assert.doesNotMatch(text,/event_status_is|ink_stained|状态 ID/);
  if(expression.startsWith('!'))assert.match(text,/不满足/);
 }
 assert.deepEqual(effect,original);
}
const status={id:'echo_binding',triggers:{gain_buff:{block:1,when:"event_status_is('ink_stained')"}}};
assert.match(describeCompactStatus(status,options),/获得增益时.*墨渍/);
assert.doesNotMatch(describeCompactStatus(status),/ink_stained|event_status_is/);
console.log('PASS compact/AST/status event identity renders registered names, retains event semantics and negation, never changes effects.');
