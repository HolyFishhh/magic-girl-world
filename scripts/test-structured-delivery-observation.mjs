import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createGlobalTowerGenerationPorts,TowerGenerationHost}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
for(const mode of ['empty','shrinking','success','no-events','exception']){
 const bus=new EventEmitter(),calls=[];
 const ports=createGlobalTowerGenerationPorts({generateRaw:async config=>{
  calls.push(structuredClone(config));
  if(mode!=='no-events'){
   bus.emit('js_stream_token_received_fully','UNRELATED_PRIVATE','other-request');
   bus.emit('js_stream_token_received_fully',mode==='shrinking'||mode==='success'?'PRIVATE_RESULT':'',config.generation_id);
   bus.emit('js_stream_token_received_fully','',config.generation_id);
   bus.emit('js_generation_ended',mode==='success'?'{}':'',config.generation_id);
  }
  if(mode==='exception')throw Error('PRIVATE_EXCEPTION');
  return mode==='success'?'{}':'';
 },stopGenerationById:()=>true},()=>({chatId:'test',eventSource:bus}));
 const host=new TowerGenerationHost(ports);
 const request={chatId:'test',nodeId:'initial',requestId:mode,prompt:'original',maxAttempts:1,
  generation:{structured_delivery:'text-json',json_schema:createInitialDraftJsonSchema()}};
 if(mode==='success')assert.equal((await host.generateNode(request)).response,'{}');
 else await assert.rejects(()=>host.generateNode(request));
 assert.equal(calls.length,1,'diagnostics do not add retries');
 for(const key of ['json_schema','tools','tool_choice','custom_api','observeStructuredDelivery'])assert.equal(Object.hasOwn(calls[0],key),false);
 const rows=host.getDiagnostics();assert.equal(rows.length,1);
 const metadata=rows[0].structuredDelivery;assert.ok(metadata);
 assert.equal(metadata.streamCharacters,mode==='no-events'?null:0);
 assert.equal(metadata.streamMaxCharacters,mode==='no-events'?null:mode==='shrinking'||mode==='success'?14:0);
 assert.equal(metadata.endCharacters,mode==='no-events'?null:mode==='success'?2:0);
 assert.equal(rows[0].finalCharacters,mode==='exception'?undefined:mode==='success'?2:0);
 assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
 metadata.streamCharacters=999;assert.notEqual(host.getDiagnostics()[0].structuredDelivery.streamCharacters,999);
 assert.deepEqual(bus.eventNames(),[],'listeners removed after each terminal path');
}
for(const timeout of [false,true]){
 const bus=new EventEmitter();let release,activeId;
 const host=new TowerGenerationHost(createGlobalTowerGenerationPorts({generateRaw:async config=>{
  activeId=config.generation_id;return new Promise(resolve=>{release=resolve;});
 },stopGenerationById:()=>true},()=>({chatId:'cancel',eventSource:bus})));
 const pending=host.generateNode({chatId:'cancel',nodeId:'initial',requestId:'cancel',prompt:'original',maxAttempts:1,
  ...(timeout?{timeoutMs:30}:{}),generation:{structured_delivery:'text-json',json_schema:createInitialDraftJsonSchema()}});
 const rejected=assert.rejects(pending);
 while(!release)await new Promise(resolve=>setTimeout(resolve,0));
 bus.emit('js_stream_token_received_fully','abc',activeId);
 if(timeout)await rejected;else host.queue.cancelChat('cancel');
 assert.deepEqual(bus.eventNames(),[],'abort removes listeners before late Helper settlement');
 bus.emit('js_stream_token_received_fully','late content',activeId);release('late');await rejected;
 assert.equal(host.getDiagnostics()[0].structuredDelivery.streamCharacters,3);
 assert.equal(host.getDiagnostics()[0].outcome,timeout?'timeout':'cancelled');
}
console.log('Structured Helper length diagnostics preserve text request parameters, invocation count, privacy, isolation and terminal/abort cleanup. Not upstream attribution.');
