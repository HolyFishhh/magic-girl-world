import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createGlobalTowerGenerationPorts,TowerGenerationHost}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const eventName='chat_completion_settings_ready';
function bus(){const listeners=new Set();return{
  on(name,fn){assert.equal(name,eventName);listeners.add(fn);},
  removeListener(name,fn){assert.equal(name,eventName);listeners.delete(fn);},
  emit(payload){for(const fn of listeners)fn(payload);},count(){return listeners.size;},
};}
for(const [mode,source,custom,schemaName,expected] of [
  ['disabled','deepseek',false,'mwg_initial_draft',false],
  ['disabled','deepseek',false,'mwg_initial_draft_registry_repair',false],
  ['disabled','deepseek',false,'mwg_tower_initial_slot_repair',false],
  [undefined,'deepseek',false,'mwg_initial_draft',true],
  ['disabled','openai',false,'mwg_initial_draft',true],
  ['disabled','deepseek',true,'mwg_initial_draft',true],
  ['disabled','deepseek',false,'mwg_tower_event_result',true],
])for(const fails of [false,true]){
  const events=bus();let observed;
  const ports=createGlobalTowerGenerationPorts({generateRaw:async config=>{
    assert.equal('deepseek_thinking_mode' in config,false,'private option never reaches Helper');
    const own={chat_completion_source:source,include_reasoning:true,reasoning_effort:'high',model:'deepseek-v4-flash',stream:true,
      messages:[{role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:owned-draft'}]};
    for(const patch of [
      {messages:[{role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:another-draft'}]},
      {messages:[{role:'user',content:'MWG_TOWER_STRUCTURED_REQUEST:owned-draft'}]},
      {messages:[{role:'system',content:'[MWG_TOWER_NARRATIVE_REQUEST] preset story'}]},
      {chat_completion_source:'openai'},
      {model:'deepseek-reasoner'},
      {model:'unrecognized-model'},
    ]){const other={...structuredClone(own),...patch},before=structuredClone(other);events.emit(other);assert.deepEqual(other,before);}
    observed=own;const before=structuredClone(own);events.emit(own);events.emit(own);
    assert.deepEqual(own,{...before,include_reasoning:expected},'only this request toggle may change, idempotently');
    if(fails)throw Error('injected helper failure');return '{}';
  }},()=>({chatCompletionSettings:{chat_completion_source:source},eventSource:events,eventTypes:{CHAT_COMPLETION_SETTINGS_READY:eventName}}));
  const config={generation_id:'owned-draft',user_input:'unchanged mechanics',should_stream:true,should_silence:true,
    json_schema:{name:schemaName,value:{type:'object'}},...(mode?{deepseek_thinking_mode:mode}:{}),...(custom?{custom_api:{source:'deepseek'}}:{})};
  const before=structuredClone(config);
  if(fails)await assert.rejects(ports.generate(config),/injected helper failure/);else await ports.generate(config);
  assert.deepEqual(config,before);assert.equal(events.count(),0,'listener removed on success and failure');
  observed.include_reasoning=true;events.emit(observed);assert.equal(observed.include_reasoning,true,'late events cannot inherit a completed job policy');
}
const missing= createGlobalTowerGenerationPorts({generateRaw:async()=>{throw Error('must not call Helper without supported event bus');}},()=>({chatCompletionSettings:{chat_completion_source:'deepseek'}}));
await assert.rejects(missing.generate({generation_id:'x',user_input:'x',should_stream:true,should_silence:true,
  json_schema:{name:'mwg_initial_draft',value:{type:'object'}},deepseek_thinking_mode:'disabled'}),/事件|event/i);
// Cross the actual v4 TOOL-selection guard, not only a same-named tiny schema.
// Installed Helper responseGenerator emits SETTINGS_READY on both its custom
// streaming/non-streaming paths before sending. The adapter must still apply
// the explicit per-request choice and clean it up without touching globals.
for (const mode of [undefined, 'disabled']) for (const fallback of [false, true]) for (const stream of [false, true]) {
  const events = bus(), settings = { chat_completion_source: 'deepseek', deepseek_model: 'deepseek-v4-flash',
    show_thoughts: true, reasoning_effort: 'high', function_calling: false };
  const beforeSettings = structuredClone(settings);
  let calls = 0, sent;
  const ports = createGlobalTowerGenerationPorts({ generateRaw: async config => {
    calls++;
    assert.deepEqual(config.custom_api, { source: 'deepseek' });
    assert.equal(config.tools[0].function.name, 'submit_initial_draft');
    assert.equal(config.should_stream, stream);
    assert.equal('deepseek_thinking_mode' in config, false);
    sent = { chat_completion_source: 'deepseek', model: 'deepseek-v4-flash', include_reasoning: true,
      reasoning_effort: 'high', messages: [{ role: 'system', content: 'MWG_TOWER_STRUCTURED_REQUEST:owned-tool' }] };
    const wrong = { ...structuredClone(sent), messages: [{ role: 'system', content: 'MWG_TOWER_STRUCTURED_REQUEST:other' }] };
    const wrongBefore = structuredClone(wrong); events.emit(wrong); assert.deepEqual(wrong, wrongBefore);
    events.emit(sent); assert.equal(sent.include_reasoning, mode !== 'disabled');
    assert.equal(sent.reasoning_effort, 'high'); return '{}';
  } }, () => ({ chatCompletionSettings: settings, eventSource: events,
    eventTypes: { CHAT_COMPLETION_SETTINGS_READY: eventName } }));
  await ports.generate({ generation_id: 'owned-tool', user_input: 'preserve narrative and mechanisms',
    should_stream: stream, should_silence: true, json_schema: createInitialDraftJsonSchema({ includeNarrative: false }),
    empty_json_fallback: fallback, ...(mode ? { deepseek_thinking_mode: mode } : {}) });
  assert.equal(calls, 1); assert.equal(events.count(), 0); assert.deepEqual(settings, beforeSettings);
  sent.include_reasoning = true; events.emit(sent); assert.equal(sent.include_reasoning, true);
}
// Reasoning-only EMPTY native DeepSeek v4 node replies reuse the existing
// fallback attempt with thinking disabled. First attempts, preset/custom/tools,
// other models/providers/schemas and subsequent unrelated requests are intact.
for (const schemaName of ['mwg_tower_node_batch_result','mwg_tower_battle_result','mwg_tower_elite_result',
  'mwg_tower_boss_result','mwg_tower_event_result','mwg_tower_shop_result','mwg_tower_treasure_result',
  'mwg_tower_rest_result','mwg_tower_opening_result','mwg_initial_draft','unrelated']) {
 for (const fallback of [false,true]) for (const model of ['deepseek-v4-flash','deepseek-v4-pro','deepseek-reasoner']) {
  for (const special of ['native','custom','tools','openai','error','cancel']) {
   const events=bus(),settings={chat_completion_source:special==='openai'?'openai':'deepseek',deepseek_model:model,
    show_thoughts:true,reasoning_effort:'high'},beforeSettings=structuredClone(settings);
   const eligible=fallback&&schemaName.startsWith('mwg_tower_')&&model.startsWith('deepseek-v4-')&&['native','error','cancel'].includes(special);
   let calls=0,own;
   const ports=createGlobalTowerGenerationPorts({generateRaw:async config=>{
    calls++;assert.equal('empty_json_fallback' in config,false);
    own={chat_completion_source:settings.chat_completion_source,model,include_reasoning:true,reasoning_effort:'high',
     messages:[{role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:node-owned'}]};
    const other={...structuredClone(own),messages:[{role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:other'}]};
    const preset={...structuredClone(own),messages:[{role:'system',content:'MWG_TOWER_NARRATIVE_REQUEST:story'}]};
    events.emit(other);events.emit(preset);assert.equal(other.include_reasoning,true);assert.equal(preset.include_reasoning,true);
    events.emit(own);assert.equal(own.include_reasoning,!eligible,`${schemaName}/${fallback}/${model}/${special}`);
    assert.equal(own.reasoning_effort,'high');
    if(special==='error'||special==='cancel')throw new Error('injected '+special);
    return '{}';
   }},()=>({chatCompletionSettings:settings,eventSource:events,eventTypes:{CHAT_COMPLETION_SETTINGS_READY:eventName}}));
   const config={generation_id:'node-owned',user_input:'unaltered content',should_stream:false,should_silence:true,
    json_schema:{name:schemaName,value:{type:'object'}},empty_json_fallback:fallback,
    ...(special==='custom'?{custom_api:{source:'deepseek'}}:{}),...(special==='tools'?{tools:[]}:{} )};
   const before=structuredClone(config);
   if(special==='error'||special==='cancel')await assert.rejects(ports.generate(config),/injected/);else await ports.generate(config);
   assert.equal(calls,1);assert.equal(events.count(),0);assert.deepEqual(config,before);assert.deepEqual(settings,beforeSettings);
   own.include_reasoning=true;events.emit(own);assert.equal(own.include_reasoning,true);
  }
 }
}
// Cross the real queue and transport together: only its existing second attempt
// changes mode; no nested invocation or recovery from non-final reasoning text.
for (const stillEmpty of [false, true]) {
 const events=bus(),sent=[];
 const ports=createGlobalTowerGenerationPorts({generateRaw:async config=>{
  const payload={chat_completion_source:'deepseek',model:'deepseek-v4-flash',include_reasoning:true,
   messages:[{role:'system',content:`MWG_TOWER_STRUCTURED_REQUEST:${config.generation_id}`}]};
  events.emit(payload);sent.push(structuredClone(payload));
  return payload.include_reasoning||stillEmpty?'':'{"actual_final":true}';
 }},()=>({chatId:'node-fallback',chatCompletionSettings:{chat_completion_source:'deepseek',deepseek_model:'deepseek-v4-flash'},
  eventSource:events,eventTypes:{CHAT_COMPLETION_SETTINGS_READY:eventName}}));
 const host=new TowerGenerationHost(ports);
 const request={chatId:'node-fallback',nodeId:'node',requestId:'request',prompt:'unchanged',maxAttempts:2,
  generation:{json_schema:{name:'mwg_tower_event_result',value:{type:'object'}}}};
 if(stillEmpty)await assert.rejects(host.generateNode(request),error=>error.code==='invalid_response');
 else {const result=await host.generateNode(request);assert.equal(result.response,'{"actual_final":true}');}
 assert.deepEqual(sent.map(p=>p.include_reasoning),[true,false]);assert.equal(events.count(),0);
 if(!stillEmpty)await host.generateNode(request);
 assert.equal(sent.length,2,stillEmpty?'budget exhausted without third request':'deduplication keeps completed retry');
}
// Fail closed when the standard host cannot enforce the promised request-only
// policy. Do not silently claim thinking is disabled or invoke another attempt.
for (const eventSource of [undefined, { on() {} }, { removeListener() {} }]) {
 let invoked=0;
 const ports=createGlobalTowerGenerationPorts({generateRaw:async()=>{invoked++;return '{}';}},()=>({
  chatCompletionSettings:{chat_completion_source:'deepseek',deepseek_model:'deepseek-v4-flash'},eventSource,
 }));
 await assert.rejects(ports.generate({generation_id:'missing-node-events',user_input:'unchanged',should_stream:false,
  should_silence:true,empty_json_fallback:true,json_schema:{name:'mwg_tower_node_batch_result',value:{type:'object'}}}),
  error=>error.code==='missing_api');
 assert.equal(invoked,0);
}
// Carry the actual host result through a bounded repair into the real global
// transport adapter, not only a controller stub observing a boolean flag.
for(const repairEmpty of [false,true]) {
 const events=bus(),sent=[];
 const settings={chat_completion_source:'deepseek',deepseek_model:'deepseek-v4-flash',reasoning_effort:'high'};
 const settingsBefore=structuredClone(settings);
 const ports=createGlobalTowerGenerationPorts({generateRaw:async config=>{
  const payload={chat_completion_source:'deepseek',model:'deepseek-v4-flash',include_reasoning:true,
   messages:[{role:'system',content:`MWG_TOWER_STRUCTURED_REQUEST:${config.generation_id}`}]};
  events.emit(payload);sent.push(structuredClone(payload));
  return sent.length===1||sent.length===3&&repairEmpty?'':'{"actual_final":true}';
 }},()=>({chatId:'repair-recovery',chatCompletionSettings:settings,eventSource:events,eventTypes:{CHAT_COMPLETION_SETTINGS_READY:eventName}}));
 const host=new TowerGenerationHost(ports);
 const request={chatId:'repair-recovery',nodeId:'node',requestId:'first',prompt:'authored facts',maxAttempts:2,
  generation:{json_schema:{name:'mwg_tower_event_result',value:{type:'object'}}}};
 const authored=await host.generateNode(request);assert.equal(authored.emptyJsonFallbackUsed,true);
 const repair={...request,requestId:'first__repair',prompt:'same rejected authored content and exact errors',maxAttempts:1,
  continueEmptyFinalRecovery:authored.emptyJsonFallbackUsed,userExtra:{mwg_tower_structure_repair:true}};
 if(repairEmpty)await assert.rejects(host.generateNode(repair),error=>error.code==='invalid_response');
 else {
  const result=await host.generateNode(repair);assert.equal(result.emptyJsonFallbackUsed,true);
  assert.deepEqual(await host.generateNode(repair),result);
 }
 assert.equal(sent.length,3);assert.deepEqual(sent.map(p=>p.include_reasoning),[true,false,false]);
 assert.equal(events.count(),0);assert.deepEqual(settings,settingsBefore);
}
// Explicit tools own their schema/delivery contract even after an empty result
// and through a provenance-carrying repair. Compare complete Helper configs,
// exempting only the exact per-attempt generation identity.
for(const tools of [[],[{type:'function',function:{name:'explicit_node',parameters:{type:'object'}}}]]) {
 const events=bus(),raw=[],payloads=[];
 const ports=createGlobalTowerGenerationPorts({generateRaw:async config=>{
  raw.push(structuredClone(config));
  const payload={chat_completion_source:'deepseek',model:'deepseek-v4-flash',include_reasoning:true,
    messages:[{role:'system',content:`MWG_TOWER_STRUCTURED_REQUEST:${config.generation_id}`}]};
  events.emit(payload);payloads.push(payload);return raw.length===1?'':'{}';
 }},()=>({chatId:'explicit-tools-repair',chatCompletionSettings:{chat_completion_source:'deepseek',deepseek_model:'deepseek-v4-flash'},
  eventSource:events,eventTypes:{CHAT_COMPLETION_SETTINGS_READY:eventName}}));
 const host=new TowerGenerationHost(ports);
 const first={chatId:'explicit-tools-repair',nodeId:'node',requestId:'first',prompt:'complete preserved facts',maxAttempts:2,
  generation:{tools,json_schema:{name:'mwg_tower_event_result',value:{type:'object'}}}};
 const result=await host.generateNode(first);
 await host.generateNode({...first,requestId:'repair',maxAttempts:1,continueEmptyFinalRecovery:result.emptyJsonFallbackUsed,
  userExtra:{mwg_tower_structure_repair:true}});
 assert.equal(raw.length,3);
 const withoutIdentity=config=>JSON.parse(JSON.stringify(config).replaceAll(config.generation_id,'OWNED_ID'));
 assert.deepEqual(withoutIdentity(raw[1]),withoutIdentity(raw[0]),'explicit-tools original fallback preserves complete Helper transport');
 assert.deepEqual(withoutIdentity(raw[2]),withoutIdentity(raw[0]),'explicit-tools repair preserves complete Helper transport');
 assert.ok(raw.every(config=>Object.hasOwn(config,'json_schema')));
 assert.ok(payloads.every(payload=>payload.include_reasoning===true));assert.equal(events.count(),0);
}
console.log('Initial opt-in and native v4 node empty fallback isolate exact request/provider/schema, preserve preset/custom/default, and clean up on success/failure. Queue-to-transport second attempt, repair continuation, explicit tools and deduplication also pass.');
