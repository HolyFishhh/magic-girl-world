import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {parseStructuredRecord:parse}=require('../src/sillytavern-extension/structuredRecord.ts');
const {parseStructuredRecordWithRecovery:recover}=require('../src/sillytavern-extension/structuredRecordRecovery.ts');
const duplicate='{"effects":{"damage":3},"effects":{"block":4}}';
for(const text of [duplicate,'```json\n'+duplicate+'\n```','结果：'+duplicate,
 '{"nested":[{"damage":3,"damage":4}]}','{"effects":{},"\\u0065ffects":{}}',
 "{'effects':{'damage':3},'effects':{'block':4},}"]){
 assert.throws(()=>parse(text),/重复/);
 let calls=0,reservations=0;
 const result=await recover(text,{reserveRepair(){reservations++;return true;},async repair(raw){calls++;assert.equal(raw,text);return '{"effects":[{"damage":3},{"block":4}]}';}});
 assert.deepEqual(result,{effects:[{damage:3},{block:4}]});assert.equal(calls,1);assert.equal(reservations,1);
}
for(const text of ['{"a":{"damage":3},"b":{"damage":4}}',
 '{"text":"a \\\"damage\\\":3, \\\"damage\\\":4","effects":{"damage":3}}',
 '{"effects":{"damage":3,}}'])assert.ok(parse(text));
let calls=0;
await assert.rejects(()=>recover(duplicate,{reserveRepair:()=>true,async repair(){calls++;return duplicate;}}),/重复/);
assert.equal(calls,1,'invalid repair never makes a third request');
await assert.rejects(()=>recover(duplicate,{reserveRepair:()=>false,async repair(){assert.fail('budget exhausted');}}),/重复/);
console.log('PASS duplicate keys including escaped/repaired keys reach one caller-owned repair; nested scopes and string literals preserved; no silent effect overwrite or hidden retry.');
for(const text of ['{"damage":','{"damage":}',"{'damage':undefined}",'{"description":"unfinished',
 '{"real":null,"missing":}', '{"text":"null","missing":}', '{"null":3,"missing":}',
 '{"n":/* null is only a comment */}', '{"values":[1,,3]}']){
 assert.throws(()=>parse(text));
 let requests=0;
 const result=await recover(text,{reserveRepair:()=>true,async repair(raw){requests++;assert.equal(raw,text);return '{"damage":3}';}});
 assert.deepEqual(result,{damage:3});assert.equal(requests,1);
}
for(const [text,expected]of [
 ["{'n':null,}",{n:null}], ["{'n':None}",{n:null}],
 ['{"n":null/* retained */,}',{n:null}], ['{"description":"null and \\\"quotes\\\"",}',{description:'null and "quotes"'}],
 ['{"damage":3',{damage:3}],
])assert.deepEqual(parse(text),expected,'complete authored values may keep punctuation recovery');
console.log('PASS missing/undefined values and unfinished strings use AI recovery; explicit null/None, comments, strings and complete-value closing punctuation preserved.');
