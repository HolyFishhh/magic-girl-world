import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createGlobalTowerGenerationPorts}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const event='chat_completion_settings_ready',body='{"thinking":{"type":"disabled"}}';
function bus(){const listeners=new Set();return{on(n,f){assert.equal(n,event);listeners.add(f);},removeListener(n,f){listeners.delete(f);},emit(p){for(const f of listeners)f(p);},count(){return listeners.size;}};}
const settings=()=>({chat_completion_source:'custom',custom_model:'deepseek-v4-flash【果汁】',custom_url:'https://fixture.invalid/v1',show_thoughts:true,temperature:1,custom_include_body:'',custom_exclude_body:''});
const config=()=>({generation_id:'owned',user_input:'unchanged game authoring',should_stream:true,should_silence:true,json_schema:{name:'mwg_initial_draft',value:{type:'object'}}});
for(const fallback of [false,true]) {
 const events=bus(),s=settings(),before=structuredClone(s);let calls=0,payload;
 const c={chatId:'chat',chatCompletionSettings:s,eventSource:events,eventTypes:{CHAT_COMPLETION_SETTINGS_READY:event}};
 const ports=createGlobalTowerGenerationPorts({generateRaw:async raw=>{
  calls++;payload={chat_completion_source:'custom',model:s.custom_model,custom_url:s.custom_url,custom_include_body:'',custom_exclude_body:'',
   messages:[{role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:owned'}],stream:true,temperature:s.temperature};
  const previous=structuredClone(payload);events.emit(payload);events.emit(payload);
  assert.deepEqual(payload,{...previous,custom_include_body:body,temperature:0.2});
  return payload.custom_include_body===body?'{}':'';
 }},()=>c);
 assert.equal(await ports.generate({...config(),empty_json_fallback:fallback}),'{}');
 assert.equal(calls,1);assert.equal(events.count(),0);assert.deepEqual(s,before);
 payload.custom_include_body='';events.emit(payload);assert.equal(payload.custom_include_body,'');
}
console.log('PASS custom data-only request mode on first and existing fallback, one call, immutable settings and cleanup.');
const {createCustomStructuredThinkingPolicy}=require('../src/sillytavern-extension/customStructuredThinking.ts');
const payload=()=>({chat_completion_source:'custom',model:settings().custom_model,custom_url:settings().custom_url,
 messages:[{role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:owned'}],custom_include_body:'',custom_exclude_body:'',json_schema:{unchanged:true},stream:true,temperature:1});
const policy=createCustomStructuredThinkingPolicy(settings(),config());
for(const name of ['mwg_initial_joint_repair','mwg_initial_draft','mwg_initial_draft_registry_repair','mwg_initial_draft_template_repair','mwg_tower_initial_slot_repair','mwg_tower_single_floor_initial_content',
 ...['node_batch','opening','battle','elite','boss','event','shop','treasure','rest'].map(n=>'mwg_tower_'+n+'_result')]) {
 const p=createCustomStructuredThinkingPolicy(settings(),{...config(),json_schema:{name}});assert.ok(p,name);
 const data={...payload(),temperature:1},before=structuredClone(data);p.apply(data);assert.deepEqual(data,{...before,custom_include_body:body,temperature:0.2});
}
for(const patch of [{custom_model:'other'},{custom_url:''},{show_thoughts:false},{chat_completion_source:'deepseek'},
 {custom_include_body:'{}'},{custom_include_body:null},{custom_exclude_body:'temperature'}]) {
 assert.equal(createCustomStructuredThinkingPolicy({...settings(),...patch},config()),undefined);
}
for(const patch of [{tools:[]},{tools:undefined},{custom_api:{source:'custom'}},{json_schema:{name:'unrelated'}},
 {json_schema:undefined},{generation_id:''},{generation_id:'owned\nother'}]) {
 assert.equal(createCustomStructuredThinkingPolicy(settings(),{...config(),...patch}),undefined);
}
for(const patch of [{model:'other'},{custom_url:'https://other.invalid'},{chat_completion_source:'deepseek'},
 {tools:[]},{custom_include_body:'{}'},{custom_exclude_body:'temperature'},
 {messages:[{role:'user',content:'MWG_TOWER_STRUCTURED_REQUEST:owned'}]},
 {messages:[{role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:other'}]},
 {messages:[{role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:owned'},{role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:other'}]},
 {messages:[{role:'system',content:'MWG_TOWER_NARRATIVE_REQUEST:owned'}]}]) {
 const data={...payload(),...patch},before=structuredClone(data);policy.apply(data);assert.deepEqual(data,before);
}
for(const mode of ['chat','route','override','cancel','error']) {
 const events=bus(),s=settings();let own,finish,entered;const pending=new Promise(r=>finish=r);const started=new Promise(r=>entered=r);
 const ctx={chatId:'chat',chatCompletionSettings:s,eventSource:events,eventTypes:{CHAT_COMPLETION_SETTINGS_READY:event}};
 const ports=createGlobalTowerGenerationPorts({generateRaw:async()=>{
  entered();
  await pending;own=payload();events.emit(own);if(mode==='error')throw Error('injected');return '{}';
 },stopGenerationById:()=>true},()=>ctx);
 const active=ports.generate(config());await started;assert.equal(events.count(),1);
 if(mode==='chat')ctx.chatId='other';
 if(mode==='route')s.custom_url='https://other.invalid';
 if(mode==='override')s.custom_include_body='{"user":true}';
 if(mode==='cancel'){ports.stopGenerationById('owned');assert.equal(events.count(),0,'cancel removes before Helper settles');}
 finish();if(mode==='error')await assert.rejects(active,/injected/);else await active;
 assert.equal(own.custom_include_body,mode==='error'?body:'');assert.equal(events.count(),0);
 assert.equal(own.temperature,mode==='error'?0.2:1,'cancelled or changed-scope payload keeps original sampling');
}
// Missing event support refuses the promised mode before a provider call.
let missingCalls=0;
await assert.rejects(createGlobalTowerGenerationPorts({generateRaw:async()=>{missingCalls++;return '{}';}},
 ()=>({chatId:'chat',chatCompletionSettings:settings()})).generate(config()),/事件/);
assert.equal(missingCalls,0);
console.log('PASS all game schemas, exact marker/route, user overrides/tools/preset exclusions, chat switch and immediate cancel/error cleanup.');
