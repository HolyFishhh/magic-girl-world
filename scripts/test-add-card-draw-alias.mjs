import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const {normalizeMvuAuthoredContent:normalize}=require('../src/runtime/mvuBattleContentNormalizer.ts');
for(const wrap of [x=>({effects:x}),x=>({triggers:{turn_start:x}}),x=>({effects:[{schedule:1,phase:'turn_start',effects:x}]})]){
 const original=wrap({add_card:'leaf',to:'draw',count:2,when:'self.hp > 0'}),before=structuredClone(original);
 assert.deepEqual(normalize(original),wrap({add_card:'leaf',to:'deck',count:2,when:'self.hp > 0'}));assert.deepEqual(original,before);
 assert.deepEqual(normalize(normalize(original)),normalize(original));
}
for(const effect of [{add_card:'leaf',to:'self'},{add_card:'leaf',to:'enemy'},{add_card:'leaf'},{move_card:1,destination:'draw'},{discard:1,from:'draw'},{add_card:'leaf',to:'draw',damage:1}])assert.deepEqual(normalize({effects:effect}),{effects:effect});
console.log('PASS exact add_card draw-to-deck alias preserves destination, count, condition and input; idempotent, no inference for combat targets or ambiguous bundles.');
