import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {decodeInitialDraftContainers:decode}=require('../src/sillytavern-extension/initialDraftDecoding.ts');
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const raw=JSON.parse(readFileSync(new URL('./fixtures/initial-draft-encoded-containers.json',import.meta.url),'utf8')).rawArguments;
const input=JSON.parse(raw),original=structuredClone(input);
const expected={...input,...Object.fromEntries(['player','opening','registry'].map(k=>[k,JSON.parse(input[k])]))};
assert.deepEqual(decode(input),expected);assert.deepEqual(input,original);
assert.equal(decode(expected),expected,'ordinary object representation needs no rewrite');
assert.deepEqual(decode(decode(input)),expected,'idempotent');
assert.equal(compileInitialDraftToMvu({...input,narrative:'isolated fixture narration'}).ok,false,'strict compiler itself still rejects encoded objects');
assert.equal(compileInitialDraftToMvu({...expected,narrative:'isolated fixture narration'}).ok,true);
for(const key of ['player','opening','registry']){
 const mixed={...expected,[key]:input[key]};assert.deepEqual(decode(mixed),expected);
 for(const bad of ['null','[]','true','7','"hello"','{"truncated":',"{'wrong':1}",'{"trailing":1,}',
  '{"same":1,"same":2}','{"same":1,"s\\u0061me":2}',
  '{"deep":{"x":1,"x":2}}',JSON.stringify(input[key]),'{"large":"'+'x'.repeat(1_000_000)+'"}',
  '['.repeat(65)+'0'+']'.repeat(65)]){
   const value={...input,[key]:bad},before=structuredClone(value);
   assert.throws(()=>decode(value),/JSON 对象/,`${key}: ${bad.slice(0,35)}`);
   assert.deepEqual(value,before,'no partial mutation after an earlier container decoded');
 }
 const nested='{'+Array.from({length:65},()=> '"a":{').join('')+'"x":0'+'}'.repeat(66);
 assert.throws(()=>decode({...input,[key]:nested}),/JSON 对象/);
}
const prose='{"same":1,"same":2}';
const proseInput={...expected,player:JSON.stringify({...expected.player,note:prose,
  inner:{description:'Escaped \\" quote, literal braces {[]}, colon :',empty:{}},sibling:{empty:{}}})};
const proseResult=decode(proseInput);assert.equal(proseResult.player.note,prose,'never interpret a JSON-looking prose value');
assert.equal(proseResult.player.inner.description,JSON.parse(proseInput.player).inner.description);
for(const spec of ['wrong',null,undefined]){const wrong={...input,spec};assert.equal(decode(wrong),wrong,'wrong version cannot opt into decoding');}
const unexpected={...input,narrative:'untrusted replacement',extra:'keep this rejected field'};
const unexpectedResult=decode(unexpected);assert.equal(unexpectedResult.narrative,unexpected.narrative);assert.equal(unexpectedResult.extra,unexpected.extra);
assert.equal(compileInitialDraftToMvu({...unexpectedResult,narrative:'fixture'}).ok,false,'unknown fields still fail strict compilation');
const partial={...expected,player:JSON.stringify({...expected.player,core:{emoji:'🪶'}})};
assert.deepEqual(decode(partial).player.core,{emoji:'🪶'},'no invented hp, profession, cost, cards or resources');
console.log('PASS real encoded draft containers: exact one-layer representation, strict bounded JSON, escaped duplicate-key rejection, no prose parsing/coercion/defaults, immutable source, unchanged strict compiler.');
