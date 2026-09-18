import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const {observeNarrativeDelivery}=require('../src/sillytavern-extension/narrativeDeliveryObservation.ts');
const {createGlobalTowerGenerationPorts,TowerGenerationHost}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const bus=new EventEmitter(),a=observeNarrativeDelivery(bus,'a'),b=observeNarrativeDelivery(bus,'b');
assert.equal(a.snapshot().streamCharacters,null);
bus.emit('js_stream_token_received_fully','private text','a');bus.emit('js_generation_ended','','a');
assert.deepEqual(a.snapshot(),{eventsAvailable:true,streamEvents:1,streamCharacters:12,streamMaxCharacters:12,nonEmptyStreamEvents:1,endEvents:1,endCharacters:0});
assert.equal(b.snapshot().streamCharacters,null);
assert.ok(!JSON.stringify(a.snapshot()).includes('private'));const copy=a.snapshot();copy.streamCharacters=999;assert.equal(a.snapshot().streamCharacters,12);
a.close();bus.emit('js_stream_token_received_fully','late','a');assert.equal(a.snapshot().streamCharacters,12);b.close();assert.deepEqual(bus.eventNames(),[]);
assert.equal(observeNarrativeDelivery(undefined,'none').snapshot().eventsAvailable,false);
const shrink=observeNarrativeDelivery(bus,'shrink');
bus.emit('js_stream_token_received_fully','previous body','shrink');
bus.emit('js_stream_token_received_fully','','shrink');
bus.emit('js_generation_ended','','shrink');
assert.equal(shrink.snapshot().streamCharacters,0);
assert.equal(shrink.snapshot().streamMaxCharacters,13);
assert.equal(shrink.snapshot().nonEmptyStreamEvents,1);
assert.ok(!JSON.stringify(shrink.snapshot()).includes('previous body'));
shrink.close();
const broken=new EventEmitter();broken.on=function(e,f){EventEmitter.prototype.on.call(this,e,f);throw Error('registration failed');};
assert.equal(observeNarrativeDelivery(broken,'bad').snapshot().eventsAvailable,false);assert.deepEqual(broken.eventNames(),[]);
for(const mode of ['empty','divergence','no-events','exception']){
 const events=new EventEmitter(),calls=[];
 const context={chatId:'test',eventSource:events};
 const ports=createGlobalTowerGenerationPorts({generate:async config=>{
  calls.push(structuredClone(config));
  if(mode!=='no-events'){
   events.emit('js_stream_token_received_fully',mode==='divergence'?'visible':'',config.generation_id);
   events.emit('js_generation_ended','',config.generation_id);
  }
  if(mode==='exception')throw Error('transport failure');
  return '';
 }},()=>context);
 const host=new TowerGenerationHost(ports);
 await assert.rejects(()=>host.generateNarrative({chatId:'test',nodeId:'initial',requestId:mode,prompt:'unchanged',recoverEmptyNarrative:true,maxAttempts:1}));
 assert.equal(calls.length,mode==='exception'?1:2);
 const rows=host.getDiagnostics();
 for(const row of rows){
  assert.equal(row.narrativeDelivery.streamCharacters,mode==='no-events'?null:mode==='divergence'?7:0);
  assert.equal(row.narrativeDelivery.endCharacters,mode==='no-events'?null:0);
  assert.equal(Object.hasOwn(calls[0],'observeNarrativeDelivery'),false);
 }
 rows[0].narrativeDelivery.streamCharacters=500;assert.notEqual(host.getDiagnostics()[0].narrativeDelivery.streamCharacters,500);
 assert.deepEqual(events.eventNames(),[],'all attempt listeners removed');
}
{
 const events=new EventEmitter();let release,activeId;
 const host=new TowerGenerationHost(createGlobalTowerGenerationPorts({generate:async config=>{activeId=config.generation_id;return new Promise(resolve=>{release=resolve;});},stopGenerationById:()=>true},()=>({chatId:'cancel',eventSource:events})));
 const pending=host.generateNarrative({chatId:'cancel',nodeId:'initial',requestId:'cancel',prompt:'original',recoverEmptyNarrative:true});
 const rejected=assert.rejects(pending,/取消/);
 while(!release)await new Promise(resolve=>setTimeout(resolve,0));
 events.emit('js_stream_token_received_fully','abc',activeId);host.queue.cancelChat('cancel');
 assert.deepEqual(events.eventNames(),[],'cancel removes listeners before late provider settles');
 events.emit('js_stream_token_received_fully','late text',activeId);release('late');await rejected;
 assert.equal(host.getDiagnostics()[0].narrativeDelivery.streamCharacters,3);
 assert.equal(host.getDiagnostics()[0].outcome,'cancelled');
}
console.log('PASS request-ID-isolated numeric-only delivery evidence; missing vs empty vs lost text; failures do not add calls or alter Helper config; snapshots, cancellation and listener cleanup protected.');
