import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {observeNarrativeWire}=require('../src/sillytavern-extension/narrativeWireObservation.ts');
const secret='SENSITIVE_NARRATIVE_SECRET';
const enc=new TextEncoder();
function response(parts,{status=200}={}){
  const stream=new ReadableStream({start(c){for(const part of parts)c.enqueue(enc.encode(part));c.close();}});
  return new Response(stream,{status});
}
{
  const wire='data: {"choices":[{"delta":{"content":"hello","reasoning":"think"}}]}\r\n\r\ndata: {"choices":[{"message":{"content":" world","reasoning_content":"more"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7,"secret":"'+secret+'","completion_tokens_details":{"reasoning_tokens":2}}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const r=response([wire.slice(0,17),wire.slice(17,69),wire.slice(69)]), watched=observeNarrativeWire(r), original=r.text();
  await watched.settled; assert.equal(await original,wire);
  assert.deepEqual(watched.snapshot(),{events:2,bodyCharacters:11,reasoningCharacters:9,finishReasons:['stop'],usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7,reasoning_tokens:2},complete:true,truncated:false,readFailed:false});
  assert.doesNotMatch(JSON.stringify(watched.snapshot()),/SENSITIVE|hello|world|think|more/);
}
{
  const watched=observeNarrativeWire(response(['data: {"choices":[\n','data: {"delta":{"reasoning_content":"only"}}]}\n\n','data: {"error":{"status":429,"message":"'+secret+'"}}\n\n']));
  await watched.settled; const m=watched.snapshot();
  assert.equal(m.reasoningCharacters,4);assert.equal(m.bodyCharacters,0);assert.equal(m.failure?.kind,'rate_limit');assert.equal(m.readFailed,false);
  assert.doesNotMatch(JSON.stringify(m),/SENSITIVE/);
}
{
  const watched=observeNarrativeWire(response(['data: '+ 'x'.repeat(64*1024)+'\n\n'])); await watched.settled;
  assert.equal(watched.snapshot().truncated,true);
  let cancel;const slow=new Response(new ReadableStream({start(c){cancel=()=>c.close();}}));const closed=observeNarrativeWire(slow);closed.close();cancel();await closed.settled;assert.equal(closed.snapshot().truncated,true);
}
console.log('PASS clone-only bounded SSE wire metadata: split CRLF/multiline, reasoning/message fallbacks, classified errors, limits/cancel, and no raw text retention.');
