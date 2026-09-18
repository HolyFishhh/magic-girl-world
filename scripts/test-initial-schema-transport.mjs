import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createGlobalTowerGenerationPorts,createProviderSafeJsonSchema}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {SCHEMA_PROMPT_MARKER}=require('../src/sillytavern-extension/schemaPromptTransport.ts');
const {createInitialDraftSchemaPromptTransport}=require('../src/sillytavern-extension/schemaPromptTransport.ts');
const originalSchema=createInitialDraftJsonSchema({includeNarrative:false});
const providerSchema=createProviderSafeJsonSchema(originalSchema);
const originalCharacters=JSON.stringify(providerSchema.value,null,4).length;
function restore(document){
  const {$defs,...root}=document;
  const expand=value=>{
    if(Array.isArray(value))return value.map(expand);
    if(!value||typeof value!=='object')return value;
    if(Object.keys(value).length===1 && /^#\/\$defs\/S\d+$/.test(value.$ref||''))return expand($defs[value.$ref.split('/').at(-1)]);
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,expand(v)]));
  };
  return expand(root);
}
async function run({provider='deepseek',customApi,empty=false,schema=originalSchema,ordered}={}){
  let emitted;
  const ports=createGlobalTowerGenerationPorts({generateRaw:async config=>{
    const messages=config.ordered_prompts.map(p=>p==='user_input'?{role:'user',content:config.user_input}:structuredClone(p));
    emitted={config:structuredClone(config),messages};
    // Installed Helper's late optionsInjector and Tavern DeepSeek adapter.
    // An early event mutation cannot prevent this final schema assignment.
    if(config.json_schema)emitted.json_schema=config.json_schema;
    if(provider==='deepseek'&&!customApi&&emitted.json_schema){
      emitted.response_format={type:'json_object'};
      messages.push({role:'user',content:`JSON schema for the response:\n${JSON.stringify(emitted.json_schema.value,null,4)}`});
    }
    return '{}';
  }},()=>({chatCompletionSettings:{chat_completion_source:provider}}));
  const config={generation_id:empty?'initial-empty':'initial-first',user_input:'unchanged established narrative and authored gameplay contract',
    should_stream:true,should_silence:true,max_chat_history:0,json_schema:schema,empty_json_fallback:empty,
    temperature:0.83,top_p:0.94,max_tokens:65535,include_reasoning:true,reasoning_effort:'high',stop:['KEEP_STOP'],
    ...(customApi?{custom_api:customApi}:{}),...(ordered?{ordered_prompts:ordered}:{})};
  const before=structuredClone(config);
  await ports.generate(config);
  assert.deepEqual(config,before,'input config and nested schema are immutable');
  for(const key of ['user_input','should_stream','should_silence','max_chat_history','temperature','top_p','max_tokens','include_reasoning','reasoning_effort','stop','custom_api']){
    assert.deepEqual(emitted.config[key],before[key],`preserve ${key}`);
  }
  assert.equal('empty_json_fallback' in emitted.config,false);
  return emitted;
}
const ordered=[{role:'system',content:'original system instructions'},'user_input',{role:'assistant',content:'original assistant context'}];
const first=await run({ordered});
const fallback=await run({ordered,empty:true});
for(const [label,result] of [['first',first],['fallback',fallback]]){
  const schemaMessages=result.messages.filter(m=>m.content.startsWith(SCHEMA_PROMPT_MARKER)||m.content.startsWith('JSON schema for the response:'));
  const characters=schemaMessages.reduce((total,m)=>total+m.content.length,0);
  assert.ok(characters<originalCharacters*0.1,`${label}: eliminate repeated schema text without dropping constraints (${characters}/${originalCharacters})`);
  const full=result.messages.filter(m=>m.content.startsWith(SCHEMA_PROMPT_MARKER));
  assert.equal(full.length,1);assert.equal(full[0].role,'system');
  assert.deepEqual(restore(JSON.parse(full[0].content.split('\n').at(-1))),providerSchema.value,'every original constraint is recoverable exactly');
  assert.deepEqual(result.messages.slice(1,4),[ordered[0],{role:'user',content:result.config.user_input},ordered[2]],'preserve original prompt order');
  const outline=JSON.parse(schemaMessages.find(m=>m.content.startsWith('JSON schema for the response:')).content.split('\n').slice(1).join('\n'));
  assert.deepEqual(outline.required,providerSchema.value.required);
  assert.deepEqual(outline.properties.spec,providerSchema.value.properties.spec);
  assert.deepEqual(Object.keys(outline.properties).sort(),Object.keys(providerSchema.value.properties).sort());
  assert.equal(outline.additionalProperties,false);
  assert.doesNotMatch(JSON.stringify(outline),/"\$(?:ref|defs)"/,'no refs go through Tavern flattening');
}
assert.deepEqual(first.response_format,{type:'json_object'});
assert.equal(fallback.response_format,undefined,'only the existing empty-final retry omits JSON mode');
assert.deepEqual(fallback.messages.slice(1),first.messages.slice(1),'first and fallback effective contracts/messages are identical');
for(const [provider,customApi] of [
  ['openai'],['claude'],['custom'],[undefined],['deepseek',{source:'openai'}],['deepseek',{source:'deepseek'}],
])for(const empty of [false,true]){
  const result=await run({provider:provider??'unknown',customApi,empty});
  assert.equal(result.messages.some(m=>m.content.startsWith(SCHEMA_PROMPT_MARKER)),false);
  assert.deepEqual(result.config.json_schema,providerSchema,'native/custom provider schema is not narrowed');
}
for(const name of ['mwg_initial_draft_registry_repair','unrelated','mwg_tower_single_floor_initial_content']){
  const result=await run({schema:{...originalSchema,name}});
  assert.equal(result.messages.some(m=>m.content.startsWith(SCHEMA_PROMPT_MARKER)),false,'exact registry-draft name only');
  assert.deepEqual(result.config.json_schema,createProviderSafeJsonSchema({...originalSchema,name}));
}
for(const patch of [
  {value:{...providerSchema.value,$id:'https://example.test/existing-schema-scope'}},
  {value:{...providerSchema.value,$defs:{existing:{type:'object'}}}},
  {value:{...providerSchema.value,properties:{...providerSchema.value.properties,narrative:{type:'string'}}}},
  {value:{...providerSchema.value,properties:{spec:{const:'mwg.initial-draft/v1'},player:{type:'object'},opening:{type:'object'},registry:{type:'object'}}}},
]){
  const schema={...structuredClone(providerSchema),...patch};
  const snapshot=structuredClone(schema);
  assert.equal(createInitialDraftSchemaPromptTransport(schema,'deepseek'),null,'existing reference scopes, alternate roots and tiny contracts remain untouched');
  assert.deepEqual(schema,snapshot);
}
const defaultPrompts=await run();
assert.deepEqual(restore(JSON.parse(defaultPrompts.messages.find(m=>m.content.startsWith(SCHEMA_PROMPT_MARKER)).content.split('\n').at(-1))),providerSchema.value);
console.log(JSON.stringify({initialSchemaTransport:'passed',originalCharacters,
  effectiveSchemaCharacters:first.messages.filter(m=>m.content.startsWith(SCHEMA_PROMPT_MARKER)||m.content.startsWith('JSON schema for the response:')).reduce((n,m)=>n+m.content.length,0),
  exactRoundTrip:true,firstAndFallbackContractIdentical:true,nativeAndCustomPreserved:true}));
