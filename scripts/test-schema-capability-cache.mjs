import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createSchemaCapabilityCache}=require('../src/sillytavern-extension/schemaCapabilityCache.ts');
const {createGlobalTowerGenerationPorts}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {GenerationTransportError}=require('../src/sillytavern-extension/generationTransportError.ts');
const data=new Map();let clock=1000;
const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
const cache=()=>createSchemaCapabilityCache(()=>storage,()=>clock);
const settings={chat_completion_source:'custom',custom_model:'fixture',custom_url:'https://fixture.invalid/v1'};
const c=cache(),fingerprint=await c.fingerprint(settings);
assert.match(fingerprint,/^[a-f0-9]{64}$/);assert.equal(c.has(fingerprint),false);c.remember(fingerprint);
assert.equal(cache().has(fingerprint),true,'new host/session cache recovers evidence');
assert.ok(!JSON.stringify([...data]).includes('fixture'),'no model or URL retained');
// Simulate separate tabs: local storage is shared, session storage is replaced.
// Exercise the production default accessor, not an injected cache accessor.
const localDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const sessionDescriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
const sharedData=new Map(),sharedStore={getItem:k=>sharedData.get(k)??null,setItem:(k,v)=>sharedData.set(k,v)};
const sessionStore=()=>{const d=new Map();return {getItem:k=>d.get(k)??null,setItem:(k,v)=>d.set(k,v)};};
try {
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:sharedStore});
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:sessionStore()});
 createSchemaCapabilityCache(undefined,()=>clock).remember(fingerprint);
 const stored=sharedData.get('mwg.schema-capability/v1');
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:sessionStore()});
 assert.equal(createSchemaCapabilityCache(undefined,()=>clock).has(fingerprint),true,'new tab recovers same-origin evidence');
 assert.equal(sharedData.get('mwg.schema-capability/v1'),stored,'read does not renew TTL');
 assert.equal(createSchemaCapabilityCache(undefined,()=>clock+30*60*1000).has(fingerprint),false);
 assert.ok(!stored.includes('fixture'),'shared store contains no route text');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('denied');}});
 const fallback=createSchemaCapabilityCache(undefined,()=>clock);fallback.remember(fingerprint);
 assert.equal(fallback.has(fingerprint),true,'session fallback when shared storage unavailable');
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw Error('denied');}});
 const denied=createSchemaCapabilityCache(undefined,()=>clock);denied.remember(fingerprint);assert.equal(denied.has(fingerprint),false);
} finally {
 if(localDescriptor)Object.defineProperty(globalThis,'localStorage',localDescriptor);else delete globalThis.localStorage;
 if(sessionDescriptor)Object.defineProperty(globalThis,'sessionStorage',sessionDescriptor);else delete globalThis.sessionStorage;
}
assert.equal(c.has(await c.fingerprint({...settings,custom_model:'other'})),false);
assert.equal(c.has(await c.fingerprint({...settings,custom_url:'https://other.invalid'})),false);
for(const patch of [{custom_include_body:'{}'},{custom_exclude_body:'response_format'},{chat_completion_source:'openai'}])assert.equal(await c.fingerprint({...settings,...patch}),undefined);
clock+=30*60*1000;assert.equal(c.has(fingerprint),false,'expired evidence is reprobed');
data.set('mwg.schema-capability/v1','bad');assert.equal(c.has(fingerprint),false);
const unavailable=createSchemaCapabilityCache(()=>{throw Error('denied');});unavailable.remember(fingerprint);assert.equal(unavailable.has(fingerprint),false);
const config={generation_id:'one',user_input:'authored game',json_schema:{name:'mwg_initial_draft',value:{type:'object',properties:{literal:{const:'  original  '}}}}};
let calls=[];let reject=true;const context={chatId:'chat',chatCompletionSettings:settings};
const helper={generateRaw:async raw=>{calls.push(structuredClone(raw));if(reject)throw new GenerationTransportError({kind:'request',retryable:false,evidence:'response',unsupportedResponseFormat:true});return '{}';},stopGenerationById:()=>true};
const first=createGlobalTowerGenerationPorts(helper,()=>context,{},cache());
await assert.rejects(first.generate(config));assert.equal(calls.length,1);assert.ok(calls[0].json_schema);
reject=false;const reloaded=createGlobalTowerGenerationPorts(helper,()=>context,{},cache());
assert.equal(await reloaded.generate({...config,generation_id:'two'}),'{}');assert.equal(calls.length,2);
assert.equal(calls[1].json_schema,undefined);
const reference=calls[1].ordered_prompts[1];
assert.match(reference.content,/MWG_SCHEMA_COMPATIBILITY/);
assert.ok(calls[1].ordered_prompts.indexOf('user_input')>1,'concrete authoring request follows the structural reference');
assert.equal(calls[1].ordered_prompts.filter(p=>typeof p==='object'&&p.content.startsWith('[MWG_SCHEMA_COMPATIBILITY/v1]')).length,1);
assert.equal(calls[1].user_input,config.user_input,'authored request is unchanged');
const delivered=JSON.parse(reference.content.split('\n').at(-1));assert.deepEqual(delivered,calls[0].json_schema.value);
const joint={...config,generation_id:'joint',json_schema:{...config.json_schema,name:'mwg_initial_joint_repair'}};
const beforeJoint=calls.length;
await reloaded.generate(joint);
assert.equal(calls.length,beforeJoint+1,'cached joint repair is one call, no schema probing retry');
assert.equal(calls.at(-1).json_schema,undefined,'new joint schema must honor known custom-route incompatibility');
assert.deepEqual(JSON.parse(calls.at(-1).ordered_prompts.at(-1).content.split('\n').at(-1)),joint.json_schema.value);
for(const extra of [{tools:undefined},{custom_api:{source:'custom'}},{json_schema:{name:'unrelated',value:{type:'object'}}}]){
 await createGlobalTowerGenerationPorts(helper,()=>context,{},cache()).generate({...config,...extra,generation_id:'excluded'});
 assert.ok(calls.at(-1).json_schema,'excluded requests retain schema');
}
settings.custom_include_body='{}';await reloaded.generate({...config,generation_id:'user-body'});assert.ok(calls.at(-1).json_schema);delete settings.custom_include_body;
for(const kind of ['authentication','quota','server','rate_limit']){
 data.clear();const isolated=cache();
 const ports=createGlobalTowerGenerationPorts({generateRaw:async()=>{throw new GenerationTransportError({kind,retryable:false,evidence:'response'});}},()=>context,{},isolated);
 await assert.rejects(ports.generate({...config,generation_id:kind}));assert.equal(data.size,0,'unrelated failure cannot become capability evidence');
}
for(const mode of ['cancel','route','chat']){
 let release;const delayed={...cache(),fingerprint:()=>new Promise(r=>{release=r;})};
 const local={chatId:'chat',chatCompletionSettings:{...settings}};let sent=0;
 const ports=createGlobalTowerGenerationPorts({generateRaw:async()=>{sent++;return '{}';},stopGenerationById:()=>true},()=>local,{},delayed);
 const task=ports.generate({...config,generation_id:mode});
 if(mode==='cancel')ports.stopGenerationById(mode);if(mode==='route')local.chatCompletionSettings.custom_model='new';if(mode==='chat')local.chatId='other';
 release(fingerprint);await assert.rejects(task);assert.equal(sent,0,'no call after asynchronous capability lookup race');
}
console.log('Same-origin schema capability: cross-tab default storage, fixed TTL, denied-storage fallback, opaque evidence, route/override isolation, exact schema delivery and cancellation/drift guards.');
