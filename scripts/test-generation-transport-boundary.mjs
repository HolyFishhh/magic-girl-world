import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module:'CommonJS', moduleResolution:'node' });
require('ts-node/register/transpile-only');
const { TowerGenerationHost, createGlobalTowerGenerationPorts } = require('../src/sillytavern-extension/towerGenerationHost.ts');
const { GenerationTransportError, classifyGenerationTransportFailure, readProxyGenerationFailure } = require('../src/sillytavern-extension/generationTransportError.ts');
const { createGenerationTransportBoundary } = require('../src/sillytavern-extension/generationTransportObserver.ts');
const secret = 'DO_NOT_RETAIN_PROVIDER_SECRET';
const quota = { error: { message:'Insufficient Balance', type:'unknown_error', code:'invalid_request_error', debug:secret }, authorization:secret };
const endpoint = '/api/backends/chat-completions/generate';
const fixture = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type':'application/json' } });
const request = { chatId:'transport-chat', nodeId:'initial', requestId:'transport-test', prompt:'Original narrative facts', maxAttempts:3 };
function harness(status, body, { narrative = false, masked = false, finalText } = {}) {
  const calls = [], wire = [], responses = [];
  const fetchHost = { location:{ href:'http://127.0.0.1:8012/' }, fetch:async (input, init) => {
    wire.push([input,init]); const response=fixture(status,body); responses.push(response); return response;
  } };
  const originalFetch = fetchHost.fetch;
  const run = async config => {
    calls.push(structuredClone(config));
    const messages = narrative ? [{role:'user',content:config.user_input}] : config.ordered_prompts.filter(x=>typeof x==='object');
    const options = { method:'POST', body:JSON.stringify({messages,proxy_password:secret}), headers:{Authorization:secret}, signal:new AbortController().signal };
    const response = await fetchHost.fetch(endpoint,options);
    assert.equal(response,responses.at(-1),'observer returns the original Response object');
    assert.equal(wire.at(-1)[1],options,'same request options, headers and signal');
    const source = await response.text();
    assert.deepEqual(JSON.parse(source),body,'original body remains readable and unchanged');
    if (!response.ok) { if(masked)return ''; throw new Error(`Got response status ${status}`); }
    return finalText ? finalText(calls.length) : narrative ? 'Preset narrative preserved' : '{"ok":true}';
  };
  const ports = createGlobalTowerGenerationPorts({ generateRaw:run,generate:run,stopGenerationById:()=>true,
    createChatMessages:async()=>assert.fail('transport failure must not write a chat'),
  },()=>({chatId:'transport-chat',chatCompletionSettings:{chat_completion_source:'deepseek'}}),fetchHost);
  return {host:new TowerGenerationHost(ports),ports,calls,fetchHost,originalFetch,wire};
}
for (const narrative of [false,true]) {
  const h = harness(500,quota,{narrative});
  await assert.rejects(narrative ? h.host.generateNarrative(request) : h.host.generateNode(request),error=>{
    assert.ok(error instanceof GenerationTransportError); assert.equal(error.failure.kind,'quota');
    assert.equal(error.failure.httpStatus,500,'do not invent the hidden upstream HTTP status');
    assert.equal(error.failure.retryable,false); assert.match(error.message,/余额或额度不足/);
    assert.equal(JSON.stringify(error).includes(secret),false); return true;
  });
  assert.equal(h.calls.length,1,'irrecoverable provider failures stop after one real Helper attempt');
  assert.equal(h.fetchHost.fetch,h.originalFetch);
  assert.equal(h.host.getDiagnostics()[0].failureKind,'quota');
  assert.equal(h.host.getDiagnostics()[0].httpStatus,500);
  assert.equal(JSON.stringify(h.host.getDiagnostics()).includes(secret),false);
  assert.deepEqual(h.host.exportPendingArchiveRecords('transport-chat'),[]);
  await assert.rejects(narrative ? h.host.generateNarrative(request) : h.host.generateNode(request));
  assert.equal(h.calls.length,1,'same failed job does not silently regenerate');
}
for (const [status,body,kind,retries] of [
  [401,{error:{message:secret}},'authentication',1],
  [403,{error:true},'permission',1],
  [400,{error:{code:'context_length_exceeded',message:secret}},'request',1],
  [404,{error:true},'request',1],
  [429,{error:{code:'insufficient_quota'}},'quota',1],
  [429,{error:{code:'rate_limit_exceeded'}},'rate_limit',3],
  [500,{error:true},'server',3],
  [503,{error:{message:secret}},'server',3],
]) {
  const h=harness(status,body);
  await assert.rejects(h.host.generateNode(request),error=>error instanceof GenerationTransportError&&error.failure.kind===kind);
  assert.equal(h.calls.length,retries); assert.equal(h.fetchHost.fetch,h.originalFetch);
}
const masked=harness(500,quota,{masked:true});
await assert.rejects(masked.host.generateNode(request),error=>error.failure?.kind==='quota');
assert.equal(masked.calls.length,1,'a swallowed HTTP failure is not an empty-final fallback');
for(const narrative of [false,true]) {
  const h=harness(200,{ok:true},{narrative});
  const result=await (narrative?h.host.generateNarrative(request):h.host.generateNode(request));
  assert.equal(result.response,narrative?'Preset narrative preserved':'{"ok":true}');
  assert.equal(h.fetchHost.fetch,h.originalFetch);
  assert.equal(h.calls[0].custom_api,undefined,'no provider/preset transport switching');
}

const owner={generationId:'one',role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:one'};
const options=(content=owner.content)=>({method:'POST',body:JSON.stringify({messages:[{role:'system',content}]})});
const host={location:{href:'http://127.0.0.1:8012/'},fetch:async()=>fixture(500,quota)};
const originalFetch=host.fetch;
const boundary=createGenerationTransportBoundary(host);
// Confirmed failures are recorded while a Helper wrapper is pending, but do
// not auto-abort, auto-retry, or complete that wrapper.
{
  const terminalHost={location:{href:'http://127.0.0.1:8012/'},fetch:async()=>fixture(429,{error:{code:'rate_limit_exceeded'}})};
  const terminalBoundary=createGenerationTransportBoundary(terminalHost);
  const observed=[];const progress=[];let releaseHttp;let httpSettled=false;let httpError;
  const http=terminalBoundary.run({...owner,onTransportFailure:failure=>observed.push(failure),onTransportProgress:event=>progress.push(event)},async()=>{
    await terminalHost.fetch(endpoint,options());
    await new Promise(resolve=>{releaseHttp=resolve;}); return 'late';
  }).then(()=>{httpSettled=true;},error=>{httpSettled=true;httpError=error;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(observed[0]?.kind,'rate_limit'); assert.equal(httpSettled,false,'observed HTTP failure does not end a stuck Helper');
  assert.equal(JSON.stringify(observed).includes(secret),false,'observation never carries provider body or secret');
  assert.deepEqual(progress.map(event=>event.phase),['request_dispatched','response_received']);
  assert.equal(progress[1].httpStatus,429); assert.equal(progress[1].contentType,'json');
  releaseHttp(); await http; assert.equal(httpError?.failure?.kind,'rate_limit','settling still uses the already-observed failure');
  const sseError='data: '+JSON.stringify({error:{status:500,message:'upstream failed'}})+'\n\n';
  const sseHost={location:{href:'http://127.0.0.1:8012/'},fetch:async()=>new Response(sseError,{headers:{'Content-Type':'text/event-stream'}})};
  const sseBoundary=createGenerationTransportBoundary(sseHost);
  const sseObserved=[];let releaseSse;let sseSettled=false;let sseErrorValue;
  const sse=sseBoundary.run({...owner,onTransportFailure:failure=>sseObserved.push(failure)},async()=>{
    await sseHost.fetch(endpoint,options());
    await new Promise(resolve=>{releaseSse=resolve;}); return 'late';
  }).then(()=>{sseSettled=true;},error=>{sseSettled=true;sseErrorValue=error;});
  await new Promise(resolve=>setImmediate(resolve)); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sseObserved[0]?.kind,'server'); assert.equal(sseSettled,false,'observed SSE failure does not end a stuck Helper');
  releaseSse(); await sse; assert.equal(sseErrorValue?.failure?.kind,'server','settling still uses observed SSE failure');
  let releaseLong;
  const normalHost={location:{href:'http://127.0.0.1:8012/'},fetch:async()=>fixture(200,{ok:true})};
  const normalBoundary=createGenerationTransportBoundary(normalHost);
  let settled=false;
  const long=normalBoundary.run(owner,async()=>{
    await normalHost.fetch(endpoint,options());
    await new Promise(resolve=>{releaseLong=resolve;});
    return 'normal-long-stream';
  }).then(value=>{settled=true;return value;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false,'a successful owned transport never receives a synthetic terminal failure');
  releaseLong();
  assert.equal(await long,'normal-long-stream');
}
// Unrelated/manual/other-origin/ambiguous requests must not contaminate a job.
for(const [url,init] of [[endpoint,options('another')],['https://other.example'+endpoint,options()],
  [endpoint+'?unrelated=1',options()],['/api/settings/get',options()],[endpoint,{method:'GET'}],
  [endpoint,options('quoted '+owner.content)],
  [endpoint,{method:'POST',body:JSON.stringify({messages:[{role:'user',content:owner.content}]})}]]) {
  assert.equal(await boundary.run(owner,async()=>{await host.fetch(url,init);return 'unrelated failure ignored';}),'unrelated failure ignored');
  assert.equal(host.fetch,originalFetch);
}
await assert.rejects(boundary.run(owner,async()=>{
  await host.fetch(endpoint,options('Before\r\n'+owner.content+'\r\nAfter'));
  throw new Error('Got response status 500');
}),error=>error.failure?.kind==='quota','adjacent-message joining does not lose exact line-bounded ownership');
const owner2={...owner,generationId:'two',content:'MWG_TOWER_STRUCTURED_REQUEST:two'};
await boundary.run(owner,()=>boundary.run(owner2,async()=>{
  await assert.rejects(boundary.run({...owner2,generationId:'unique',content:'UNIQUE'},async()=>{
    await host.fetch(endpoint,options('UNIQUE')); throw new Error('Got response status 500');
  }),error=>error.failure?.kind==='quota');
  return 'outer jobs unaffected';
}));
assert.equal(host.fetch,originalFetch);
const boundary2=createGenerationTransportBoundary(host);
await boundary.run(owner,()=>boundary2.run(owner2,async()=>{
  boundary.cancel(owner.generationId);
  assert.notEqual(host.fetch,originalFetch,'another active boundary retains its observer');
  return 'other scope still active';
}));
assert.equal(host.fetch,originalFetch);
await boundary.run(owner,()=>boundary.run({...owner,generationId:'identical'},async()=>{
  await host.fetch(endpoint,options()); return 'ambiguous ownership ignored';
}));
assert.equal(host.fetch,originalFetch);

// Cancellation releases the hook before an uncooperative Helper resolves.
let release;
const pending=boundary.run(owner,async()=>{await new Promise(resolve=>{release=resolve;});throw new DOMException('cancelled','AbortError');}).catch(error=>error);
await new Promise(resolve=>setImmediate(resolve));
assert.notEqual(host.fetch,originalFetch); boundary.cancel(owner.generationId);
assert.equal(host.fetch,originalFetch); release(); assert.equal((await pending).name,'AbortError');
// Never overwrite a third-party hook installed while ours was active.
let external;
await boundary.run(owner,async()=>{const observed=host.fetch;external=(...args)=>observed(...args);host.fetch=external;});
assert.equal(host.fetch,external);
await assert.rejects(boundary.run(owner,async()=>{await host.fetch(endpoint,options());throw new Error('Got response status 500');}),error=>error.failure?.kind==='quota');
assert.equal(host.fetch,external);
host.fetch=originalFetch;

const locked={location:host.location};
Object.defineProperty(locked,'fetch',{value:originalFetch,writable:false});
const lockedBoundary=createGenerationTransportBoundary(locked);
await assert.rejects(lockedBoundary.run(owner,async()=>{await locked.fetch(endpoint,options());throw new Error('Got response status 500');}),
  error=>error.failure?.kind==='server'&&error.failure?.evidence==='exception','read-only hosts preserve generation and report only available evidence');
assert.equal(locked.fetch,originalFetch);
const opaque=new Proxy({}, {get(){throw new Error('opaque');}});
let caughtOpaque = false;
try { await boundary.run(owner,async()=>{throw opaque;}); }
catch (error) { caughtOpaque = true; assert.equal(error,opaque,'diagnostics cannot replace an opaque original exception'); }
assert.equal(caughtOpaque,true);

for(const response of [new Response('<html>'+secret+'</html>',{status:500}),
  new Response('x'.repeat(9000),{status:500}),
  new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));}}),{status:500})]) {
  host.fetch=async()=>response;
  const began=Date.now();
  await assert.rejects(boundary.run(owner,async()=>{await host.fetch(endpoint,options());throw new Error('Got response status 500');}),error=>{
    assert.equal(error.failure.kind,'server'); assert.equal(JSON.stringify(error).includes(secret),false);return true;
  });
  assert.ok(Date.now()-began<1500,'bounded diagnostics cannot hang generation');
  void response.body?.cancel().catch(()=>undefined);
}
assert.equal(classifyGenerationTransportFailure(500,{error:{message:'unrelated error'}}).kind,'server');
// Successful envelopes from an OpenAI proxy: strict recognition, no content
// substring guessing and no leaking a proxy's detailed body into diagnostics.
const proxyBody={error:{message:'This response_format type is unavailable now',type:'invalid_request_error'},proxy:{secret},proxy_note:'Rejected'};
const wrapper='### **Proxy error (HTTP 400 Bad Request)**\n\nThe proxy encountered an error while trying to send your prompt to the API. Further details are provided below.\n\n----\n\n```\n'+JSON.stringify(proxyBody)+'\n```\n\n<!-- oai-proxy-error -->';
const completion=(content=wrapper)=>({choices:[{message:{role:'assistant',content}}]});
const minimalProxy=readFileSync(new URL('./fixtures/minimal-proxy-504.txt',import.meta.url),'utf8').trim();
for(const text of [minimalProxy,minimalProxy.replace(/\n/g,'\r\n')])assert.deepEqual(readProxyGenerationFailure(completion(text)),
  {kind:'server',httpStatus:504,retryable:true,evidence:'proxy_response'},'complete minimal proxy envelope needs no optional proxy metadata');
assert.equal(classifyGenerationTransportFailure(418).retryable,false,'unclassified client error cannot consume transient recovery');
assert.equal(classifyGenerationTransportFailure(undefined).retryable,false,'unknown status is not evidence of a temporary server error');
for(const text of ['引用：'+minimalProxy,JSON.stringify({narrative:minimalProxy}),minimalProxy.replace('<!-- oai-proxy-error -->',''),
  minimalProxy.replace('"message":','"not_message":'),minimalProxy+'\n正文继续'])assert.equal(readProxyGenerationFailure(completion(text)),undefined);
for(const outcome of ['success','proxy','empty','empty_proxy']){
 const h=harness(200,{ok:true},{narrative:true,finalText:n=>outcome==='empty_proxy'?(n===1?'':minimalProxy):n===1||outcome==='proxy'?minimalProxy:outcome==='empty'?'':'Preset narrative preserved'});
 const work=h.host.generateNarrative({...request,recoverEmptyNarrative:true});
 if(outcome==='success')assert.equal((await work).response,'Preset narrative preserved');else await assert.rejects(work);
 assert.equal(h.calls.length,2,'narrative proxy and empty recovery share one second call');
 const normalized=c=>{const copy=structuredClone(c);delete copy.generation_id;return copy;};
 assert.deepEqual(normalized(h.calls[0]),normalized(h.calls[1]),'same preset parameters on transient retry');
 assert.equal(h.fetchHost.fetch,h.originalFetch);
}
assert.deepEqual(readProxyGenerationFailure(completion()),{kind:'request',httpStatus:400,retryable:false,evidence:'proxy_response',unsupportedResponseFormat:true});
for(const body of [completion('a story about '+wrapper),completion(wrapper.replace('<!-- oai-proxy-error -->','')),
  completion(JSON.stringify({narrative:wrapper})),completion('This response_format type is unavailable now'),
  {choices:[...completion().choices,...completion().choices]},
  {choices:[{message:{role:'user',content:wrapper}}]},
  {choices:[{message:{role:'assistant',content:wrapper,tool_calls:[]}}]},
  completion(wrapper.replace(JSON.stringify(proxyBody),'{}')),completion(wrapper.replace('400','200')),
  completion(wrapper+'x'.repeat(9000)),completion(wrapper.replace('```\n{','```\nnot-json{'))]) assert.equal(readProxyGenerationFailure(body),undefined);
assert.equal(classifyGenerationTransportFailure(400,{error:{message:'response_format bad game text',type:'invalid_request_error'}}).unsupportedResponseFormat,undefined);
host.fetch=async()=>fixture(200,completion());
const wrappedFetch=host.fetch;
for(const [url,init] of [[endpoint,options('another')],['https://other.example'+endpoint,options()],[endpoint,options('quoted '+owner.content)]]) {
  assert.equal(await boundary.run(owner,async()=>{await host.fetch(url,init);return 'unrelated';}),'unrelated');
}
await assert.rejects(boundary.run(owner,async()=>{
  const response=await host.fetch(endpoint,options());
  assert.deepEqual(await response.json(),completion(),'original successful envelope untouched');
  return wrapper;
}),error=>error.failure?.evidence==='proxy_response'&&!JSON.stringify(error).includes(secret));
assert.equal(host.fetch,wrappedFetch);
let finishWrapped;
const cancelledWrapped=boundary.run(owner,async()=>{
  await new Promise(resolve=>{finishWrapped=resolve;}); await host.fetch(endpoint,options()); return 'late';
});
await new Promise(resolve=>setImmediate(resolve));
boundary.cancel(owner.generationId);finishWrapped();assert.equal(await cancelledWrapped,'late');
assert.equal(host.fetch,wrappedFetch);
// The inspected proxy also emits the same complete error as SSE assistant
// content. Do not clone/read SSE in the observer; inspect only Helper's final,
// after exactly one owned request, with the same strict full-wrapper matcher.
const wireSse='data: '+JSON.stringify({choices:[{delta:{role:'assistant',content:wrapper}}]})+'\n\ndata: [DONE]\n\n';
host.fetch=async()=>new Response(wireSse,{headers:{'Content-Type':'text/event-stream'}});
const streamFetch=host.fetch;
await assert.rejects(boundary.run(owner,async()=>{
  const response=await host.fetch(endpoint,options());assert.equal(await response.text(),wireSse);
  return wrapper;
}),error=>error.failure?.unsupportedResponseFormat===true&&!JSON.stringify(error).includes(secret));
assert.equal(host.fetch,streamFetch);
await assert.rejects(boundary.run(owner,async()=>{await host.fetch(endpoint,options());return minimalProxy;}),
 error=>error.failure?.httpStatus===504&&error.failure.retryable,'minimal proxy wrapper is rejected from an owned SSE final');
for(const text of ['ordinary narrative mentioning response_format','prefix '+wrapper,JSON.stringify({narrative:wrapper})]) {
  assert.equal(await boundary.run(owner,async()=>{await host.fetch(endpoint,options());return text;}),text);
}
for(const count of [0,2])assert.equal(await boundary.run(owner,async()=>{
  for(let i=0;i<count;i++)await host.fetch(endpoint,options());return wrapper;
}),wrapper,'unobserved or ambiguous Helper requests cannot acquire another request error');
let releaseStream;
const cancelledStream=boundary.run(owner,async()=>{
  await host.fetch(endpoint,options());await new Promise(resolve=>{releaseStream=resolve;});return wrapper;
});
while(!releaseStream)await new Promise(resolve=>setImmediate(resolve));
boundary.cancel(owner.generationId);releaseStream();assert.equal(await cancelledStream,wrapper);
assert.equal(host.fetch,streamFetch);
console.log('PASS generation transport: exact request ownership, native Helper and preset preserved, quota/auth/config stop retries, true transient budgets retained, original response/body unchanged, bounded private diagnostics, cancellation/concurrency/third-party hook cleanup. No model or live chat requests.');

// Preset-only SSE observation keeps the original response and never returns reasoning as prose.
let narrativeWire;
const observedOwner = { ...owner, onNarrativeWire: value => { narrativeWire = value; } };
const reasoningSse = `data: ${JSON.stringify({choices:[{delta:{reasoning_content:secret}}]})}\r\n\r\ndata: [DONE]\r\n\r\n`;
host.fetch = async () => new Response(reasoningSse, {headers:{'Content-Type':'text/event-stream'}});
assert.equal(await boundary.run(observedOwner, async () => {
  const response = await host.fetch(endpoint, options());
  assert.equal(await response.text(), reasoningSse);
  return '';
}), '');
assert.equal(narrativeWire.bodyCharacters, 0);
assert.equal(narrativeWire.reasoningCharacters, secret.length);
assert.equal(narrativeWire.complete, true);
assert.equal(JSON.stringify(narrativeWire).includes(secret), false);
host.fetch = async () => new Response(`data: ${JSON.stringify(quota)}\n\ndata: [DONE]\n\n`, {headers:{'Content-Type':'text/event-stream'}});
await assert.rejects(boundary.run(observedOwner, async () => {
  await (await host.fetch(endpoint, options())).text();
  return '';
}), error => error instanceof GenerationTransportError && error.failure.kind === 'quota' && !error.failure.retryable);
const {describeEmptyNarrative} = require('../src/sillytavern-extension/emptyNarrativeDiagnosis.ts');
assert.match(describeEmptyNarrative(), /未取得接口流证据/);
assert.match(describeEmptyNarrative({wire:{complete:true,bodyCharacters:0,reasoningCharacters:10,finishReasons:['length']}}), /只有思考.*长度限制/);
assert.match(describeEmptyNarrative({wire:{complete:true,bodyCharacters:10,reasoningCharacters:0,finishReasons:[]}}), /提取或过滤/);
assert.match(describeEmptyNarrative({wire:{complete:false,bodyCharacters:0,reasoningCharacters:0}}), /观察不完整/);
console.log('PASS narrative SSE boundary: metadata only, original body intact, explicit stream errors classified, empty evidence explained.');
