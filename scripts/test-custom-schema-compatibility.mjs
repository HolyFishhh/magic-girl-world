import assert from 'node:assert/strict';
import './test-initial-compatibility-sharing.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module:'CommonJS', moduleResolution:'node' });
require('ts-node/register/transpile-only');
const { TowerGenerationHost, createGlobalTowerGenerationPorts, createProviderSafeJsonSchema } = require('../src/sillytavern-extension/towerGenerationHost.ts');
const { createTowerNodeJsonSchema,createTowerNodeBatchJsonSchema } = require('../src/game-core/towerRequest.ts');
const { GenerationTransportError } = require('../src/sillytavern-extension/generationTransportError.ts');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {shareSchemaPromptDefinitions}=require('../src/sillytavern-extension/schemaPromptTransport.ts');
const secret = 'DO_NOT_RETAIN_PROVIDER_SECRET';
const unsupported = {error:{message:'This response_format type is unavailable now',type:'invalid_request_error',code:'invalid_request_error'},proxy:{service:'deepseek',debug:secret},proxy_note:'The API rejected the request. Check the error message for details.'};
const proxyText = body => '### **Proxy error (HTTP 400 Bad Request)**\n\nThe proxy encountered an error while trying to send your prompt to the API. Further details are provided below.\n\n----\n\n*The API rejected the request. Check the error message for details.*\n\n```\n'+JSON.stringify(body)+'\n```\n\n<!-- oai-proxy-error -->';
const envelope = text => ({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]});
const schema = {name:'mwg_tower_node_batch_result',value:{type:'object',additionalProperties:false,required:['spec','literal'],properties:{spec:{const:'fixture'},literal:{const:'  significant\n whitespace  '}}}};
const input = {chatId:'custom-chat',nodeId:'node',requestId:'fixture',prompt:'AI authored mechanics, unchanged',maxAttempts:2,generation:{json_schema:schema}};
function harness({source='custom',mode='proxy',extra={},status=200,capabilityCache}={}) {
  const calls=[], wire=[], controls={}, settings={chat_completion_source:source,custom_model:'deepseek-v4-flash【fixture】',custom_url:'https://fixture.invalid/v1',deepseek_model:'deepseek-v4-flash',show_thoughts:true};
  const originalSettings=structuredClone(settings);
  const fetchHost={location:{href:'http://127.0.0.1:8012/'},fetch:async(_url,init)=>{
    const request=JSON.parse(init.body);wire.push(request);
    const fails=!!request.json_schema||mode==='always-error';
    const body=!fails?envelope('{"spec":"fixture","literal":"  significant\\n whitespace  "}'):
      mode==='http'?unsupported:envelope(mode==='ordinary'?'An ordinary story mentioning response_format':proxyText(unsupported));
    return new Response(JSON.stringify(body),{status:fails&&mode==='http'?400:status,headers:{'Content-Type':'application/json'}});
  }};
  const originalFetch=fetchHost.fetch;
  const helper={generateRaw:async config=>{
    calls.push(structuredClone(config));
    await controls.beforeSend?.(config);
    {
      const response=await fetchHost.fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify({messages:config.ordered_prompts.filter(x=>typeof x==='object'),stream:false,json_schema:config.json_schema,chat_completion_source:settings.chat_completion_source,model:settings.custom_model,custom_url:settings.custom_url})});
      const body=await response.json();
      if(!response.ok) throw new Error('Got response status '+response.status);
      return body.choices[0].message.content;
    }
  },generate:async config=>{calls.push(config);return 'Preset narrative unchanged';},stopGenerationById:()=>true};
  const ports=createGlobalTowerGenerationPorts(helper,()=>({chatId:'custom-chat',chatCompletionSettings:settings}),fetchHost,capabilityCache);
  const host=new TowerGenerationHost(ports);
  return {host,ports,calls,wire,controls,settings,originalSettings,fetchHost,originalFetch,request:{...input,generation:{...input.generation,...extra}}};
}
for(const mode of ['proxy','http']) {
  const h=harness({mode});
  const result=await h.host.generateNode(h.request);
  assert.equal(result.response,'{"spec":"fixture","literal":"  significant\\n whitespace  "}', 'unsupported response_format uses the existing next attempt, not structure repair');
  assert.equal(h.calls.length,2); assert.ok(h.calls[0].json_schema); assert.equal(h.calls[1].json_schema,undefined);
  const prompt=h.calls[1].ordered_prompts.at(-1);
  assert.match(prompt.content,/MWG_SCHEMA_COMPATIBILITY\/v1/);
  assert.deepEqual(JSON.parse(prompt.content.slice(prompt.content.indexOf('\n{')+1)),h.calls[0].json_schema.value,'every schema constraint and literal survives');
  const clean=c=>{const x=structuredClone(c);delete x.generation_id;delete x.json_schema;x.ordered_prompts=x.ordered_prompts.filter(p=>!(typeof p==='object'&&(p.content.startsWith('MWG_TOWER_STRUCTURED_REQUEST:')||p.content.startsWith('[MWG_SCHEMA_COMPATIBILITY/v1]'))));return x;};
  assert.deepEqual(clean(h.calls[0]),clean(h.calls[1]),'same Helper provider, source options and authoring prompts');
  assert.deepEqual(h.settings,h.originalSettings); assert.equal(h.fetchHost.fetch,h.originalFetch);
  const diagnostics=h.host.getDiagnostics(); assert.equal(diagnostics[0].failureKind,'request'); assert.equal(diagnostics[0].retryable,true);
  assert.equal(diagnostics[0].transportEvidence,mode==='proxy'?'proxy_response':'response');
  assert.equal(JSON.stringify(diagnostics).includes(secret),false);
  await h.host.generateNode({...h.request,requestId:'repair',maxAttempts:1,userExtra:{mwg_tower_batch_structure_repair:true}});
  assert.equal(h.calls.length,3); assert.equal(h.calls[2].json_schema,undefined,'the sole repair retains route compatibility without another probe');
  h.settings.custom_model='another-model';
  await h.host.generateNode({...h.request,requestId:'new-model'}); assert.ok(h.calls[3].json_schema,'model changes do not inherit capability');
  h.settings.custom_url='https://other.invalid/v1';
  await h.host.generateNode({...h.request,requestId:'new-url'}); assert.ok(h.calls[5].json_schema,'endpoint changes do not inherit capability');
  assert.equal(h.calls.length,7);
  const narrative=await h.host.generateNarrative({...input,requestId:'story'});
  assert.equal(narrative.response,'Preset narrative unchanged'); assert.equal(h.calls.at(-1).preset_name,'in_use');
}
for(const options of [{source:'openai'},{extra:{tools:[]}},{extra:{tools:[{type:'function',function:{name:'user_owned',parameters:{type:'object'}}}]}},{extra:{custom_api:{source:'custom'}}},{extra:{json_schema:{...schema,name:'unrelated'}}}]) {
  const h=harness(options);
  await assert.rejects(h.host.generateNode(h.request),error=>error instanceof GenerationTransportError&&error.failure.kind==='request'&&!error.failure.retryable);
  assert.equal(h.calls.length,1,'native/custom_api/explicit tools/unrelated schema never downgraded');
}
const one=harness();
const {createSchemaCapabilityCache}=require('../src/sillytavern-extension/schemaCapabilityCache.ts');
const cacheData=new Map(),cacheStorage={getItem:k=>cacheData.get(k)??null,setItem:(k,v)=>cacheData.set(k,v)};
const freshCache=()=>createSchemaCapabilityCache(()=>cacheStorage);
const cold=harness({capabilityCache:freshCache()});await cold.host.generateNode(cold.request);assert.equal(cold.wire.length,2);
const warm=harness({capabilityCache:freshCache()});await warm.host.generateNode(warm.request);assert.equal(warm.wire.length,1,'recreated host skips the previously proven rejected schema probe');
assert.equal(warm.wire[0].json_schema,undefined);assert.deepEqual(warm.settings,warm.originalSettings);
assert.deepEqual(warm.calls[0].ordered_prompts.at(-1),cold.calls[1].ordered_prompts.at(-1),'same complete compatibility contract across host recreation');
assert.ok(!JSON.stringify([...cacheData]).includes(secret)&&!JSON.stringify([...cacheData]).includes('fixture'),'no response, URL or model in session evidence');
await assert.rejects(one.host.generateNode({...one.request,maxAttempts:1}),error=>error.failure?.kind==='request');
assert.equal(one.calls.length,1,'no nested request even when no queue attempt remains');
const repeat=harness({mode:'always-error'});
await assert.rejects(repeat.host.generateNode({...repeat.request,maxAttempts:3}),error=>error.failure?.kind==='request'&&!error.failure.retryable);
assert.equal(repeat.calls.length,2,'error after compatibility is terminal; no fallback loop');
const ordinary=harness({mode:'ordinary'});
assert.equal((await ordinary.host.generateNode(ordinary.request)).response,'An ordinary story mentioning response_format');
assert.equal(ordinary.calls.length,1,'arbitrary model text is not a transport error');
for(const change of ['custom_model','custom_url']) {
  const h=harness(), original=h.fetchHost.fetch, before=h.settings[change];
  h.fetchHost.fetch=async(...args)=>{h.settings[change]='changed-during-request';return original(...args);};
  await assert.rejects(h.host.generateNode(h.request),error=>error.failure?.kind==='request'&&!error.failure.retryable);
  assert.equal(h.calls.length,1,'a switched route is not silently retried');
  h.settings[change]=before;h.fetchHost.fetch=original;
  await h.host.generateNode({...h.request,requestId:'after-route-race'});
  assert.ok(h.calls[1].json_schema,'late old-route evidence was not cached');assert.equal(h.calls.length,3);
}
const cancelled=harness();
const actualFetch=cancelled.fetchHost.fetch;
let unblock,entered;
const enteredPromise=new Promise(resolve=>{entered=resolve;});
cancelled.fetchHost.fetch=async(...args)=>{entered();await new Promise(resolve=>{unblock=resolve;});return actualFetch(...args);};
const pending=cancelled.host.generateNode(cancelled.request).catch(error=>error);
await enteredPromise;cancelled.host.queue.cancelChat('custom-chat');unblock();
assert.equal((await pending).code,'cancelled');
await new Promise(resolve=>setImmediate(resolve));
cancelled.fetchHost.fetch=actualFetch;
await cancelled.host.generateNode({...cancelled.request,requestId:'after-cancel'});
assert.ok(cancelled.calls[1].json_schema,'cancelled late error cannot learn capability');assert.equal(cancelled.calls.length,3);
for(const field of ['custom_model','custom_url','chat_completion_source']) {
  const h=harness();await h.host.generateNode(h.request);
  h.controls.beforeSend=()=>{h.settings[field]='changed-after-learning';};
  await assert.rejects(h.host.generateNode({...h.request,requestId:'learned-route-race'}),error=>error.failure?.kind==='route_changed'&&!error.failure.retryable);
  assert.equal(h.wire.length,2,'changed route is rejected before an actual fetch, not after transmission');
  assert.equal(h.calls.length,3,'no hidden retry to the changed route');assert.equal(h.fetchHost.fetch,h.originalFetch);
}
for(const productionSchema of [createTowerNodeJsonSchema('battle',{act:1,floor:5}),createTowerNodeBatchJsonSchema('actual-batch',[{nodeId:'node',requestId:'req',kind:'event',basedOnRevision:3,act:1,floor:5,contentSeed:11,rewardSeed:12,difficultyMultiplier:1}])]) {
  const before=structuredClone(productionSchema), h=harness({extra:{json_schema:productionSchema}});
  await h.host.generateNode(h.request);
  const prompt=h.calls[1].ordered_prompts.at(-1).content;
  assert.deepEqual(JSON.parse(prompt.slice(prompt.indexOf('\n{')+1)),createProviderSafeJsonSchema(productionSchema).value,'exact existing provider-safe contract, not the authoritative recursive runtime schema');
  assert.deepEqual(productionSchema,before,'authoritative schema untouched');
}
console.log('PASS custom schema compatibility: boundary-to-queue composition; wrapped HTTP 200 and real HTTP 400; exact existing provider-safe contract (production battle/batch schemas), authoritative validation unchanged; existing budgets; same-route repair reuse; learned-route send race blocked before fetch; provider/model/endpoint/tools/narrative/cancellation boundaries; no private diagnostics. Synthetic only, no live requests.');
const initialSource=createInitialDraftJsonSchema({includeNarrative:false});
const initialHarness=harness({extra:{json_schema:initialSource}});
await initialHarness.host.generateNode(initialHarness.request);
assert.equal(initialHarness.calls.length,2,'one existing compatibility attempt only');
const initialPrompts=initialHarness.calls[1].ordered_prompts;
const initialPrompt=initialPrompts[1].content;
assert.ok(initialPrompts.indexOf('user_input')>1,'complete reference precedes concrete input');
assert.equal(initialPrompts.filter(p=>typeof p==='object'&&p.content.startsWith('[MWG_SCHEMA_COMPATIBILITY/v1]')).length,1);
const initialExpected=shareSchemaPromptDefinitions(createProviderSafeJsonSchema(initialSource).value);
assert.deepEqual(JSON.parse(initialPrompt.slice(initialPrompt.indexOf('\n{')+1)),initialExpected,'actual host uses shared initial text');
assert.equal(initialHarness.calls[1].json_schema,undefined,'refs only in text, never Tavern schema flattener');
assert.deepEqual(initialHarness.settings,initialHarness.originalSettings);
console.log('PASS actual custom host initial compatibility uses complete shared text without provider settings or retry budget changes');
