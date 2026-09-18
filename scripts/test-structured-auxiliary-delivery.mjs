import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {TowerGenerationHost,createGlobalTowerGenerationPorts}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createTowerNodeBatchJsonSchema,parseTowerNodeBatchResult}=require('../src/game-core/towerRequest.ts');
const jobs=[{nodeId:'rest-node',requestId:'request-rest',basedOnRevision:7,kind:'rest',act:1,floor:11}];
const schema=createTowerNodeBatchJsonSchema('batch-fixture',jobs);
const data={spec:'mwg.tower-node-batch-result/v1',batch_id:'batch-fixture',based_on_revision:7,results:[{
 spec:'mwg.tower-node-result/v1',node_id:'rest-node',request_id:'request-rest',based_on_revision:7,kind:'rest',title:'休息',narrative:'停下脚步。',payload:{rest:{note:'  significant\n whitespace  '}}}]};
const text=JSON.stringify(data);
const responseBody=(aux=text,content='')=>({choices:[{index:0,message:{role:'assistant',content,reasoning_content:aux},finish_reason:'stop'}]});
const input={chatId:'aux-chat',nodeId:'batch',requestId:'fixture',prompt:'Complete game facts',maxAttempts:1,generation:{json_schema:schema}};
function harness({body=responseBody(),source='custom',extra={},responseType='application/json',status=200}={}){
 const calls=[],wire=[],responses=[],controls={};
 const settings={chat_completion_source:source,custom_model:'deepseek-v4-flash【fixture】',custom_url:'https://fixture.invalid/v1',deepseek_model:'deepseek-v4-flash'};
 const originalSettings=structuredClone(settings);
 const fetchHost={location:{href:'http://127.0.0.1:8012/'},fetch:async(url,init)=>{
  wire.push({url,init});await controls.beforeResponse?.();const r=controls.responseFactory?.()??new Response(JSON.stringify(body),{status,headers:{'Content-Type':responseType}});responses.push(r);return r;
 }};
 const originalFetch=fetchHost.fetch;
 const helper={generateRaw:async config=>{
  calls.push(structuredClone(config));await controls.beforeSend?.();
  const payload={messages:config.ordered_prompts.filter(x=>typeof x==='object'),stream:false,chat_completion_source:settings.chat_completion_source,model:settings.custom_model,custom_url:settings.custom_url,...controls.wireOverride};
  const options={method:'POST',body:JSON.stringify(payload),signal:new AbortController().signal};
  const r=await fetchHost.fetch('/api/backends/chat-completions/generate',options);
  assert.equal(r,responses.at(-1));assert.equal(wire.at(-1).init,options);
  const actual=await r.json();assert.deepEqual(actual,body,'original response body is never changed');
  if(controls.secondFetch){const second=await fetchHost.fetch('/api/backends/chat-completions/generate',options);await second.json();}
  await controls.afterResponse?.();
  if(controls.error)throw controls.error;
  return controls.helperResult!==undefined?controls.helperResult:actual.choices[0].message.content;
 },generate:async()=> 'Preset narrative unchanged',stopGenerationById:()=>true};
 const ports=createGlobalTowerGenerationPorts(helper,()=>({chatId:controls.chatId??'aux-chat',chatCompletionSettings:settings}),fetchHost);
 const host=new TowerGenerationHost(ports);
 return {host,ports,calls,wire,controls,settings,originalSettings,fetchHost,originalFetch,request:{...input,generation:{...input.generation,...extra}}};
}
const recovered=harness();
const result=await recovered.host.generateNode(recovered.request);
assert.equal(result.response,text,'complete owned auxiliary JSON must survive an empty Helper final');
assert.equal(recovered.calls.length,1,'no extra model request');
assert.equal(recovered.host.getDiagnostics()[0].responseDelivery,'auxiliary_json');
assert.deepEqual(parseTowerNodeBatchResult(result.response,'batch-fixture',jobs).results[0].payload,data.results[0].payload);
assert.deepEqual(recovered.settings,recovered.originalSettings);assert.equal(recovered.fetchHost.fetch,recovered.originalFetch);
console.log('PASS: owned complete auxiliary JSON returns unchanged through real host/queue in one call; original response/settings untouched.');

for(const content of ['Authoritative final',JSON.stringify({...data,batch_id:'final-wins'}),' malformed JSON ']){
 const h=harness({body:responseBody(text,content)});const r=await h.host.generateNode(h.request);
 assert.equal(r.response,content);assert.equal(h.host.getDiagnostics()[0].responseDelivery,undefined);
}
const invalidData=structuredClone(data);invalidData.results[0].payload={};
const invalid=harness({body:responseBody(JSON.stringify(invalidData))});
const invalidResult=await invalid.host.generateNode(invalid.request);
assert.throws(()=>parseTowerNodeBatchResult(invalidResult.response,'batch-fixture',jobs),/payload/,'delivery is not validation and cannot conceal invalid mechanics');
const wrongMember=structuredClone(data);wrongMember.results[0].request_id='another-request';
const duplicateMember=structuredClone(data);duplicateMember.results.push(structuredClone(data.results[0]));
for(const body of [
 responseBody('Thinking first\n'+text),responseBody('```json\n'+text+'\n```'),responseBody(text+'\n'+text),responseBody(text.slice(0,-1)),
 responseBody(JSON.stringify({...data,batch_id:'another-batch'})),responseBody(JSON.stringify(wrongMember)),responseBody(JSON.stringify(duplicateMember)),
 responseBody(JSON.stringify({...data,explanation:'not a data-only envelope'})),responseBody('[]'),responseBody('null'),
 {error:{message:'failed'},...responseBody()},
 {...responseBody(),choices:[...responseBody().choices,...responseBody().choices]},
 {choices:[{...responseBody().choices[0],finish_reason:'length'}]},
 {choices:[{...responseBody().choices[0],message:{...responseBody().choices[0].message,tool_calls:[]}}]},
 {choices:[{...responseBody().choices[0],message:{...responseBody().choices[0].message,role:'user'}}]},
 {choices:[{...responseBody().choices[0],message:{...responseBody().choices[0].message,refusal:'refused'}}]},
 ]) {
 const h=harness({body});await assert.rejects(h.host.generateNode(h.request));assert.equal(h.calls.length,1);
 assert.equal(h.host.getDiagnostics()[0].responseDelivery,undefined);
}
for(const options of [{source:'openai'},{extra:{tools:[]}},{extra:{custom_api:{source:'custom'}}},{extra:{json_schema:{...schema,name:'unrelated'}}},{responseType:'text/event-stream'}]){
 const h=harness(options);await assert.rejects(h.host.generateNode(h.request));assert.equal(h.calls.length,1);
}
for(const field of ['custom_model','custom_url','chat_completion_source']){
 const h=harness();h.controls.beforeSend=()=>{h.settings[field]='changed';};
 await assert.rejects(h.host.generateNode(h.request));assert.equal(h.wire.length,0,'changed route rejected before fetch');
}
for(const change of ['model','chat']){
 const h=harness();h.controls.afterResponse=()=>{if(change==='model')h.settings.custom_model='changed';else h.controls.chatId='another-chat';};
 await assert.rejects(h.host.generateNode(h.request));assert.equal(h.host.getDiagnostics()[0]?.responseDelivery,undefined);
}
for(const error of [new Error('Helper exception'),Object.assign(new Error('cancelled'),{name:'AbortError'})]){
 const h=harness();h.controls.error=error;await assert.rejects(h.host.generateNode(h.request));assert.equal(h.host.getDiagnostics()[0].responseDelivery,undefined);
}
const streaming=harness();streaming.controls.wireOverride={stream:true};await assert.rejects(streaming.host.generateNode(streaming.request));
const narrative=harness();assert.equal((await narrative.host.generateNarrative({...input,requestId:'story'})).response,'Preset narrative unchanged');
console.log('PASS: ordinary final precedence, invalid mechanics retained, prose/partial/multichoice/tool/refusal/scope/route/chat/error/stream boundaries.');

const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {createStructuredAuxiliaryDecoder}=require('../src/sillytavern-extension/structuredAuxiliaryDelivery.ts');
const initial=JSON.parse(readFileSync('scripts/fixtures/initial-draft-paper-discard.json','utf8'));
const initialShape=createInitialDraftJsonSchema({includeNarrative:false});
const initialData=structuredClone(initial);delete initialData.narrative;delete initialData.spec;
const initialText=JSON.stringify(initialData);
const initialCase=harness({body:responseBody(initialText),extra:{json_schema:initialShape}});
assert.equal((await initialCase.host.generateNode(initialCase.request)).response,initialText,'real compact draft and optional fixed version remain authored bytes');
assert.equal(initialCase.calls.length,1);
const hugeData=structuredClone(data);hugeData.results[0].narrative='literal '.repeat(3000);
const large=harness({body:responseBody(JSON.stringify(hugeData))});
assert.equal((await large.host.generateNode(large.request)).response,JSON.stringify(hugeData),'complete data larger than error-only 8KiB limit is supported');
const tooLarge=harness({body:{...responseBody(),padding:'x'.repeat(2_097_152)}});
await assert.rejects(tooLarge.host.generateNode(tooLarge.request),undefined,'whole-response clone is bounded, including non-auxiliary metadata');assert.equal(tooLarge.calls.length,1);
const tooLong=JSON.stringify({...data,padding:'x'.repeat(1_000_000)});
assert.equal(createStructuredAuxiliaryDecoder(schema)(responseBody(tooLong)),undefined);
const slow=harness();
slow.controls.responseFactory=()=>new Response(new ReadableStream({start(controller){setTimeout(()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify(responseBody())));controller.close();},500);}}),{headers:{'Content-Type':'application/json'}});
await assert.rejects(slow.host.generateNode(slow.request));assert.equal(slow.host.getDiagnostics()[0].responseDelivery,undefined,'late clone reads after bounded observation cannot publish');
const twice=harness();twice.controls.secondFetch=true;await assert.rejects(twice.host.generateNode(twice.request));assert.equal(twice.wire.length,2,'ambiguous repeated owned fetch is not silently selected');
const wrongMarker=harness();wrongMarker.controls.wireOverride={messages:[{role:'system',content:'unrelated'}]};await assert.rejects(wrongMarker.host.generateNode(wrongMarker.request));
const objectResult=harness();objectResult.controls.helperResult={tool:'explicit'};await assert.rejects(objectResult.host.generateNode(objectResult.request));
let unblock,entered;
const enteredPromise=new Promise(resolve=>{entered=resolve;});
const cancelled=harness();cancelled.controls.beforeResponse=()=>{entered();return new Promise(resolve=>{unblock=resolve;});};
const pending=cancelled.host.generateNode(cancelled.request).catch(error=>error);
await enteredPromise;cancelled.host.queue.cancelChat('aux-chat');unblock();
assert.equal((await pending).code,'cancelled');await new Promise(resolve=>setImmediate(resolve));
assert.equal(cancelled.fetchHost.fetch,cancelled.originalFetch);assert.equal(cancelled.host.getDiagnostics()[0].responseDelivery,undefined);
assert.equal(JSON.stringify(recovered.host.getDiagnostics()).includes('significant'),false,'no authored or auxiliary content in diagnostics');
console.log('PASS: compact initial draft, large/oversized/slow response, repeated wire ambiguity, wrong marker, non-text Helper result and real queue cancellation.');

// Sequential same-id calls below only test reservation cleanup. Callers must
// use fresh attempt ids for independent operations: stopGenerationById has no
// invocation token and cannot distinguish a stale caller reusing the same id.
for(const phase of ['beforeResponse','afterResponse']){
 const same=harness();let release,notify;
 const entered=new Promise(resolve=>{notify=resolve;});
 same.controls[phase]=()=>{if(same.calls.length===1){notify();return new Promise(resolve=>{release=resolve;});}};
 const config={generation_id:'same-invocation-id',user_input:'facts',should_stream:false,json_schema:schema};
 const first=same.ports.generate(config);
 await entered;
 try{
  await assert.rejects(same.ports.generate(config),/相同结构化请求已经在运行/,'same id must reject before touching first invocation');
  assert.equal(same.calls.length,1);assert.equal(same.wire.length,1,'duplicate cannot issue another model request');
 }finally{release();}
 assert.equal(await first,text,'original invocation keeps its exact auxiliary data');
 assert.equal(same.ports.takeStructuredResponseDelivery(config.generation_id),'auxiliary_json');
 assert.equal(same.ports.takeStructuredResponseDelivery(config.generation_id),undefined,'provenance consumed once');
 same.controls[phase]=undefined;
 assert.equal(await same.ports.generate(config),text,'settled invocation releases the id reservation');
 assert.equal(same.ports.takeStructuredResponseDelivery(config.generation_id),'auxiliary_json');
 assert.equal(same.fetchHost.fetch,same.originalFetch);
}
console.log('PASS: same-id reentry is rejected before/after response capture; first data/provenance survive and settled IDs release.');

const late=harness();let releaseLate,notifyLate;
const enteredLate=new Promise(resolve=>{notifyLate=resolve;});
late.controls.beforeResponse=()=>{notifyLate();return new Promise(resolve=>{releaseLate=resolve;});};
const lateConfig={generation_id:'cancelled-invocation-id',user_input:'facts',should_stream:false,json_schema:schema};
const lateFirst=late.ports.generate(lateConfig);await enteredLate;
late.ports.stopGenerationById(lateConfig.generation_id);
try{
 await assert.rejects(late.ports.generate(lateConfig),/相同结构化请求已经在运行/,'cancelled but unsettled invocation retains reservation');
 assert.equal(late.calls.length,1);
}finally{releaseLate();}
assert.equal(await lateFirst,'','late underlying empty Helper response is not rescued after cancellation');
assert.equal(late.ports.takeStructuredResponseDelivery(lateConfig.generation_id),undefined);
late.controls.beforeResponse=undefined;
late.controls.error=new Error('owned Helper failure');
await assert.rejects(late.ports.generate(lateConfig),/owned Helper failure/);
assert.equal(late.ports.takeStructuredResponseDelivery(lateConfig.generation_id),undefined);
late.controls.error=undefined;
assert.equal(await late.ports.generate(lateConfig),text,'cancellation and exceptions release reservation only after settlement');
assert.equal(late.ports.takeStructuredResponseDelivery(lateConfig.generation_id),'auxiliary_json');
assert.equal(late.fetchHost.fetch,late.originalFetch);
console.log('PASS: cancelled late invocations reject same-id reuse; settled cancellation/error cleanup permits later calls without stale provenance.');

const isolated=harness();
const oldConfig={generation_id:'settled-old-attempt',user_input:'facts',should_stream:false,json_schema:schema};
assert.equal(await isolated.ports.generate(oldConfig),text);
isolated.ports.takeStructuredResponseDelivery(oldConfig.generation_id);
let releaseNew,notifyNew;
const enteredNew=new Promise(resolve=>{notifyNew=resolve;});
isolated.controls.beforeResponse=()=>{notifyNew();return new Promise(resolve=>{releaseNew=resolve;});};
const newConfig={...oldConfig,generation_id:'independent-new-attempt'};
const newPending=isolated.ports.generate(newConfig);await enteredNew;
try{isolated.ports.stopGenerationById(oldConfig.generation_id);}finally{releaseNew();}
assert.equal(await newPending,text,'late old-id stop cannot invalidate an independent fresh-id invocation');
assert.equal(isolated.ports.takeStructuredResponseDelivery(newConfig.generation_id),'auxiliary_json');
assert.equal(isolated.fetchHost.fetch,isolated.originalFetch);
console.log('PASS: late stop for a settled old attempt preserves a new distinct-id invocation and its provenance.');
