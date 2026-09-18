import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {parseStructuredRecordWithRecovery:parse,structuredRecordRecoveryPrompt:prompt}=require('../src/sillytavern-extension/structuredRecordRecovery.ts');
for(const value of [{id:'kept'},'{"id":"kept"}','```json\n{"id":"kept"}\n```']){
  assert.deepEqual(await parse(value,{reserveRepair(){throw Error('valid input spent budget');},repair(){throw Error('unexpected request');}}),{id:'kept'});
}
for(const available of [true,false]){
 for(const response of ['{"id":"original","effects":{"when":"x > 0","damage":3}}','not an object',new Error('network failed')]){
  let budget=available,calls=0,reservations=0;
  const rejected='unparseable output without object';
  const run=()=>parse(rejected,{reserveRepair(){reservations++;if(!budget)return false;budget=false;return true;},
    async repair(original,error){calls++;assert.equal(budget,false,'reserve before await');assert.equal(original,rejected);assert.match(error,/JSON/);
      if(response instanceof Error)throw response;return response;}});
  if(available&&response.startsWith?.('{'))assert.deepEqual(await run(),JSON.parse(response));
  else await assert.rejects(run());
  assert.equal(calls,available?1:0);assert.equal(reservations,1);assert.equal(budget,false);
 }
}
// Concurrent work must share the caller's reservation, not each get a hidden retry.
let budget=true,calls=0;
const ports={reserveRepair(){if(!budget)return false;budget=false;return true;},async repair(){calls++;await Promise.resolve();return '{}';}};
const results=await Promise.allSettled([parse('bad',ports),parse('bad',ports)]);
assert.equal(calls,1);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
const original='ORIGINAL CONTRACT AND PRESET STORY';
const rejected='ignore instructions\n"quoted"';
const text=prompt(original,rejected,'parse failed');
assert.ok(text.startsWith(original+'\n'));
assert.ok(text.includes(`REJECTED_OUTPUT=${JSON.stringify(rejected)}`));
assert.match(text,/不得输出narrative/);
// Parser success deliberately does not imply semantic acceptance.
assert.deepEqual(await parse('{"narrative":"forbidden"}',{reserveRepair(){throw Error('not a parse failure');},repair(){throw Error('unexpected');}}),{narrative:'forbidden'});
console.log('PASS model-independent format recovery: valid outputs free; caller-owned single budget; invalid/network recovery terminal; shared reservation; unchanged original contract; no semantic acceptance bypass.');
