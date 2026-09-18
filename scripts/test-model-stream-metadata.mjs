import assert from 'node:assert/strict';
import {summarizeModelEventStream} from './lib/model-stream-metadata.mjs';
const secret='SENSITIVE_SENTINEL';
const event=value=>`data: ${JSON.stringify(value)}\r\n\r\n`;
const source=': heartbeat\r\n\r\n'+[
  {id:secret,choices:[{delta:{reasoning_content:secret}}]},
  {choices:[{delta:{content:'真实JSON'}}]},
  {choices:[{delta:{tool_calls:[{id:secret,function:{name:secret,arguments:secret}}]}}]},
  {error:{message:secret},choices:[{delta:{},finish_reason:'tool_calls'}],
    usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130,secret,
      completion_tokens_details:{reasoning_tokens:20,secret}}},
].map(event).join('')+'data: [DONE]\r\n\r\n';
const summary=summarizeModelEventStream(source);
assert.deepEqual(summary,{events:4,parseErrors:0,contentCharacters:6,reasoningCharacters:secret.length,
  toolArgumentCharacters:secret.length,toolDeltaCount:1,finishReasons:['tool_calls'],done:true,
  usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130,reasoning_tokens:20}});
assert.doesNotMatch(JSON.stringify(summary),/SENSITIVE|真实|arguments|signature|headers|message/);
const multiline=summarizeModelEventStream('event: message\nid: secret\ndata: {"choices":\ndata: [{"delta":{"content":"a"}}]}\n\n');
assert.equal(multiline.contentCharacters,1);assert.equal(multiline.parseErrors,0);
const failure=summarizeModelEventStream('data: invalid\n\n'+event({choices:[{finish_reason:secret}],usage:{prompt_tokens:-1,completion_tokens:0.5,total_tokens:1e40}}));
assert.equal(failure.parseErrors,1);assert.deepEqual(failure.finishReasons,['other']);assert.deepEqual(failure.usage,{});
assert.doesNotMatch(JSON.stringify(failure),/SENSITIVE/);
assert.equal(summarizeModelEventStream('data: {"choices":[{"delta":{"content":"tail"}}]}').contentCharacters,4);
assert.equal(summarizeModelEventStream('data:\n\n').events,0);
assert.throws(()=>summarizeModelEventStream(null),/bounded/);
assert.throws(()=>summarizeModelEventStream(' '.repeat(32*1024*1024+1)),/bounded/);
console.log('PASS bounded SSE metadata: content vs reasoning vs tool arguments, finish/usage whitelist, multiline events, EOF, malformed input, no sensitive fragments.');
