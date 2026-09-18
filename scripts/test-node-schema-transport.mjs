import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createGlobalTowerGenerationPorts,createProviderSafeJsonSchema}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createTowerNodeJsonSchema,createTowerNodeBatchJsonSchema}=require('../src/game-core/towerRequest.ts');
const prefix='[MWG_NODE_RESPONSE_SCHEMA/v1]';
const jobs=['battle','event','rest'].map((kind,i)=>({nodeId:`node_${i}`,requestId:`request_${i}`,basedOnRevision:9,kind,
  act:1,floor:i+5,contentSeed:i+11,rewardSeed:i+21,difficultyMultiplier:1}));
async function run(schema,{source='deepseek',custom,empty=false,tools}={}){
  let sent;
  const listeners=new Set(), eventSource={on:(_name,fn)=>listeners.add(fn),removeListener:(_name,fn)=>listeners.delete(fn)};
  const ports=createGlobalTowerGenerationPorts({generateRaw:async config=>{
    sent={config:structuredClone(config),messages:config.ordered_prompts.map(p=>p==='user_input'
      ?{role:'user',content:config.user_input}:structuredClone(p))};
    // Installed Helper injects json_schema late. Actual Tavern DeepSeek adapter
    // appends its pretty schema and enables JSON-object mode, not enforcement.
    if(source==='deepseek'&&!custom&&config.json_schema){
      sent.response_format={type:'json_object'};
      sent.messages.push({role:'user',content:'JSON schema for the response:\n'+JSON.stringify(config.json_schema.value,null,4)});
    }
    const request={chat_completion_source:source,model:'deepseek-v4-flash',include_reasoning:true,messages:sent.messages};
    for(const listener of listeners)listener(request);
    assert.equal(request.include_reasoning,!(empty&&source==='deepseek'&&!custom&&!tools), 'existing node fallback changes only the marked request thinking mode');
    return '{}';
  }},()=>({chatCompletionSettings:{chat_completion_source:source,deepseek_model:'deepseek-v4-flash'},eventSource}));
  const config={generation_id:'node-compact-regression',user_input:'unchanged story and current MVU',json_schema:schema,
    ordered_prompts:[{role:'system',content:'original rules'},'user_input',{role:'system',content:'original final contract'}],
    empty_json_fallback:empty,should_stream:true,should_silence:true,temperature:0.82,top_p:0.94,max_tokens:65535,
    include_reasoning:true,reasoning_effort:'high',stop:['KEEP_STOP'],...(custom?{custom_api:custom}:{}),...(tools?{tools}: {})};
  const before=structuredClone(config);
  await ports.generate(config);
  assert.equal(listeners.size,0);
  assert.deepEqual(config,before,'input config is immutable');
  for(const key of ['generation_id','user_input','should_stream','should_silence','temperature','top_p','max_tokens',
    'include_reasoning','reasoning_effort','stop','custom_api','tools']) assert.deepEqual(sent.config[key],before[key],key);
  assert.deepEqual(sent.messages.slice(1,4),[config.ordered_prompts[0],{role:'user',content:config.user_input},config.ordered_prompts[2]]);
  return sent;
}
const schemas=[...['battle','elite','boss','event','shop','treasure','rest'].map(kind=>createTowerNodeJsonSchema(kind,{act:1,floor:5})),
  createTowerNodeBatchJsonSchema('batch_mixed',jobs),createTowerNodeBatchJsonSchema('batch_single',jobs.slice(0,1))];
for(const schema of schemas){
  const canonicalBefore=structuredClone(schema);
  const provider=createProviderSafeJsonSchema(schema);
  const first=await run(schema);
  const documents=first.messages.filter(m=>m.content.startsWith(prefix));
  assert.equal(documents.length,1,'first node request must carry the complete compact schema once');
  assert.equal(documents[0].role,'user');
  assert.deepEqual(JSON.parse(documents[0].content.split('\n').at(-1)),provider.value,'all provider constraints retained exactly');
  assert.deepEqual(first.response_format,{type:'json_object'},'do not disable first-result JSON mode');
  const outline=first.config.json_schema.value;
  assert.equal(outline.type,'object');
  assert.deepEqual(outline.required,provider.value.required);
  assert.deepEqual(Object.keys(outline.properties).sort(),Object.keys(provider.value.properties).sort());
  assert.deepEqual(outline.properties.spec,provider.value.properties.spec);
  assert.equal(outline.additionalProperties,provider.value.additionalProperties);
  assert.doesNotMatch(JSON.stringify(outline),/"\$(?:ref|defs)"/);
  const schemaChars=first.messages.slice(4).reduce((n,m)=>n+m.content.length,0);
  const prettyChars=JSON.stringify(provider.value,null,4).length;
  assert.ok(schemaChars<prettyChars*.3,`${schema.name}: remove at least70% formatting (${schemaChars}/${prettyChars})`);
  assert.deepEqual(schema,canonicalBefore);
  // Existing bounded empty-final recovery is unchanged: same full constraints,
  // no native JSON mode and no second, competing outline contract.
  const fallback=await run(schema,{empty:true});
  assert.equal(fallback.messages.some(m=>m.content.startsWith(prefix)),false);
  assert.equal(fallback.config.json_schema,undefined);
  assert.equal(fallback.response_format,undefined);
  assert.deepEqual(JSON.parse(fallback.messages.at(-1).content.split('\n').slice(1).join('\n')),provider.value);
  console.log(JSON.stringify({name:schema.name,prettyCharacters:prettyChars,firstSchemaCharacters:schemaChars,completeSchemaEqual:true}));
}
const representative=schemas.at(-1);
for(const opts of [{source:'openai'},{source:'claude'},{source:'unknown'},
  {custom:{source:'deepseek'}},{custom:{source:'openai'}},{tools:[{type:'function',function:{name:'explicit',parameters:{type:'object'}}}]}]){
  const sent=await run(representative,opts);
  assert.equal(sent.messages.some(m=>m.content.startsWith(prefix)),false);
  assert.deepEqual(sent.config.json_schema,createProviderSafeJsonSchema(representative));
}
for(const patch of [{name:'unrelated'}, {name:'mwg_tower_opening_result'},
  {value:{type:'object',properties:{spec:{const:'wrong'}}}},
  {value:{...representative.value,required:[]}},
  {value:{...representative.value,properties:{...representative.value.properties,spec:{const:'wrong'}}}}]){
  const schema={...representative,...patch};
  const sent=await run(schema);
  assert.equal(sent.messages.some(m=>m.content.startsWith(prefix)),false,'names alone must not narrow unrelated schemas');
  assert.deepEqual(sent.config.json_schema,createProviderSafeJsonSchema(schema));
}
console.log('PASS: compact first-node transport preserves complete constraints, JSON mode, original prompts/settings, native/custom/tools boundaries and existing fallback.');
