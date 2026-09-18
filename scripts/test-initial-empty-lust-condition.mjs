import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {normalizeInitialDraftEmptyLustCondition:normalize}=require('../src/sillytavern-extension/initialDraftDecoding.ts');
const file='tmp/initial102-final-browser-v183.json',bytes=readFileSync(file),capture=JSON.parse(bytes);
const original=JSON.parse(capture.evidence.find(e=>e.stage==='normalized-draft').text);
assert.equal(original.player.player_lust_effect.when,'');
const expected=structuredClone(original);delete expected.player.player_lust_effect.when;
const snapshot=structuredClone(original);
assert.deepEqual(normalize(original),expected);
assert.deepEqual(original,snapshot);
assert.deepEqual(normalize(normalize(original)),expected);
for(const when of ['   ','\t\n']){
 const input=structuredClone(original);input.player.player_lust_effect.when=when;
 assert.deepEqual(normalize(input),expected);
}
for(const when of [null,false,true,0,[],{},'false','true','欲望满溢时','self.hp < 5',' opponent.lust >= opponent.max_lust ']){
 const input=structuredClone(original);input.player.player_lust_effect.when=when;
 assert.equal(normalize(input),input,'nonempty/typed conditions are never removed');
}
const nested=structuredClone(expected);nested.player.player_lust_effect.effects.when='';
assert.equal(normalize(nested),nested,'do not rewrite effects conditions');
for(const spec of ['wrong',null,undefined]){
 const input={...original,spec};assert.equal(normalize(input),input);
}
assert.deepEqual(readFileSync(file),bytes);
console.log('PASS exact102 empty optional root condition only; nonempty/null/false/nested values and all other authored fields preserved. Not a semantic-completion claim.');
