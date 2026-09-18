import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createGlobalTowerGenerationPorts,TowerGenerationHost}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {GenerationTransportError,classifyGenerationTransportFailure}=require('../src/sillytavern-extension/generationTransportError.ts');
function setup(replies,settings={}){
  const calls=[],payloads=[],stopped=[],listeners=new Set();
  const context={chatId:'story-chat',chatCompletionSettings:structuredClone(settings),
    eventSource:{on:(_e,f)=>listeners.add(f),removeListener:(_e,f)=>listeners.delete(f)}};
  const ports=createGlobalTowerGenerationPorts({
    generate:async config=>{
      calls.push(structuredClone(config));
      const payload={...structuredClone(context.chatCompletionSettings),
        messages:[{role:'system',content:'EXISTING PRESET'},{role:'user',content:config.user_input},{role:'user',content:'EXISTING PRESET TAIL'}]};
      const before=structuredClone(payload);
      for(const f of listeners)f(payload);
      assert.deepEqual(payload,before,'recovery must not override provider settings or preset');
      payloads.push(payload);
      const next=replies.shift();if(next instanceof Error)throw next;return typeof next==='function'?next():next;
    },stopGenerationById:id=>{stopped.push(id);return true;},
  },()=>context);
  return {host:new TowerGenerationHost(ports),ports,context,calls,payloads,stopped,listeners};
}
const request={chatId:'story-chat',nodeId:'initial',requestId:'story',prompt:'Original opening task',maxAttempts:7,recoverEmptyNarrative:true};
const configurations=[
  {chat_completion_source:'deepseek',deepseek_model:'deepseek-v4-flash',show_thoughts:true},
  {chat_completion_source:'deepseek',deepseek_model:'deepseek-v4-pro',show_thoughts:false},
  {chat_completion_source:'custom',custom_model:'deepseek-v4-pro【果汁】',custom_url:'https://test.invalid/v1'},
  {chat_completion_source:'custom',custom_model:'deepseek-v4-flash【果汁】',show_thoughts:true,custom_include_body:'thinking: {type: enabled}',custom_exclude_body:'- top_k'},
  {chat_completion_source:'openai',openai_model:'unlisted-model',reasoning_effort:'high'},
  {chat_completion_source:'custom',custom_model:'private-model',custom_include_body:'not: [valid'},
];
for(const settings of configurations){
  const h=setup(['','Recovered preset narrative'],settings);
  assert.equal((await h.host.generateNarrative(request)).response,'Recovered preset narrative');
  assert.equal(h.calls.length,2);
  const [first,second]=h.calls;assert.notEqual(first.generation_id,second.generation_id);
  assert.deepEqual(second,{...first,generation_id:second.generation_id});
  assert.deepEqual(h.payloads[1],h.payloads[0]);assert.deepEqual(h.context.chatCompletionSettings,settings);
  assert.equal(h.listeners.size,0);
  for(const c of h.calls){
    assert.equal(c.preset_name,'in_use');assert.equal(c.max_chat_history,'all');
    for(const field of ['json_schema','response_format','tools','ordered_prompts','custom_api','empty_narrative_fallback'])assert.equal(Object.hasOwn(c,field),false);
  }
  assert.deepEqual(h.host.getDiagnostics().map(d=>[d.attempt,d.outcome,d.presetFinalFallbackRequested]),[[1,'empty_final',false],[2,'returned',true]]);
  await h.host.generateNarrative(request);assert.equal(h.calls.length,2,'accepted prose must be cached');
}
console.log('PASS generic preset recovery across six configurations: identical input/settings/preset, distinct IDs, one extra call, no format or thinking override.');
for(const [replies,count,passes] of [[['good'],1,true],[['',''],2,false],[[{},'ignored'],1,false],[[null],1,false],[[new Error('provider failed')],1,false],[['',new Error('provider failed')],2,false],[[{reasoning_content:'not prose'}],1,false]]){
  const h=setup(replies);if(passes)await h.host.generateNarrative(request);else await assert.rejects(h.host.generateNarrative(request));
  assert.equal(h.calls.length,count,'no third request or reasoning-to-prose conversion');
}
{
  const h=setup(['','ignored']);await assert.rejects(h.host.generateNarrative({...request,recoverEmptyNarrative:false,maxAttempts:1}));assert.equal(h.calls.length,1);
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
for(const fallback of [false,true]){
  let release;const h=setup([...(fallback?['']:[]),()=>new Promise(resolve=>{release=resolve;})]);
  const pending=h.host.generateNarrative(request),rejected=assert.rejects(pending,/取消|聊天/);
  while(!release)await tick();
  h.host.queue.cancelChat('story-chat');assert.equal(h.stopped.at(-1),h.calls.at(-1).generation_id);
  release('late narrative');await rejected;await tick();assert.equal(h.calls.length,fallback?2:1);
  assert.equal(h.host.getDiagnostics().at(-1).outcome,'cancelled');
}
{
  const h=setup([()=>{h.context.chatId='other';return '';}]);await assert.rejects(h.host.generateNarrative(request),/聊天/);assert.equal(h.calls.length,1);
}
{
  const h=setup(['','works without events']);delete h.context.eventSource;
  assert.equal((await h.host.generateNarrative(request)).response,'works without events');
}
{
  let release;const h=setup([()=>new Promise(resolve=>{release=resolve;})]);
  const config={generation_id:'same-id',user_input:'original',should_stream:true,should_silence:true};
  const pending=h.ports.generateNarrative(config);while(!release)await tick();
  await assert.rejects(h.ports.generateNarrative(config),/已经在运行/);
  h.ports.stopGenerationById(config.generation_id);
  await assert.rejects(h.ports.generateNarrative(config),/已经在运行/);
  release('late');await pending;assert.equal(h.calls.length,1);
}
console.log('PASS empty recovery budget, malformed/unknown error terminal handling, cancellation, chat isolation, no event-bus dependency and duplicate reservation.');
const http=status=>new GenerationTransportError(classifyGenerationTransportFailure(status));
for(const settings of configurations){
 const h=setup([http(502),'Recovered original preset'],settings);let notices=0;
 const task={...request,onNarrativeTransportRecovery(){notices++;}};
 assert.equal((await h.host.generateNarrative(task)).response,'Recovered original preset');
 assert.equal(h.calls.length,2);assert.equal(notices,1);
 assert.deepEqual(h.calls[1],{...h.calls[0],generation_id:h.calls[1].generation_id});
 assert.deepEqual(h.payloads[1],h.payloads[0]);assert.deepEqual(h.context.chatCompletionSettings,settings);
 assert.deepEqual(h.host.getDiagnostics().map(d=>[d.attempt,d.outcome,d.presetFinalFallbackRequested]),[[1,'exception',false],[2,'returned',false]]);
 await h.host.generateNarrative(task);assert.equal(h.calls.length,2,'transport-recovered story is cached');
}
for(const status of [502,503,504,429]){
 for(const second of ['good','',http(503)]){
  const h=setup([http(status),second,'must not be called']);
  if(second==='good')assert.equal((await h.host.generateNarrative(request)).response,'good');
  else await assert.rejects(h.host.generateNarrative(request));
  assert.equal(h.calls.length,2,'transport then empty/error shares one extra request');
 }
 const h=setup(['',http(status),'must not be called']);await assert.rejects(h.host.generateNarrative(request));assert.equal(h.calls.length,2);
}
for(const status of [400,401,402,403,413,422]){
 const h=setup([http(status),'must not be called']);await assert.rejects(h.host.generateNarrative(request));assert.equal(h.calls.length,1);
}
for(const action of ['cancel','switch']){
 const h=setup([http(502),'must not be called']);
 await assert.rejects(h.host.generateNarrative({...request,onNarrativeTransportRecovery(){
  if(action==='cancel')h.host.queue.cancelChat('story-chat');else h.context.chatId='other';
 }}),/取消|聊天/);
 assert.equal(h.calls.length,1,'scope change before second delivery stops recovery');
}
{
 const h=setup([http(502),'must not be called']);await assert.rejects(h.host.generateNarrative({...request,recoverEmptyNarrative:false,maxAttempts:1}));assert.equal(h.calls.length,1);
}
console.log('PASS explicit transient transport and empty text share one preset recovery; identical settings across six routes; no third call, auth retry, cache duplication or cancelled-chat delivery.');
