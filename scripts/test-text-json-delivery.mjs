import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createGlobalTowerGenerationPorts}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createProviderSafeJsonSchema}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createSchemaCompatibilityMessage}=require('../src/sillytavern-extension/schemaPromptTransport.ts');
const configurations=[
 {chat_completion_source:'custom',custom_model:'deepseek-v4-pro【果汁】'},
 {chat_completion_source:'custom',custom_model:'deepseek-v4-flash【果汁】'},
 {chat_completion_source:'deepseek',deepseek_model:'deepseek-v4-pro'},
 {chat_completion_source:'openai',openai_model:'unlisted-model'},
 {chat_completion_source:'custom',custom_model:'player-private-model'},
];
const config={generation_id:'portable-test',user_input:'ORIGINAL STORY AND REQUIREMENTS',should_stream:true,should_silence:true,
 structured_delivery:'text-json',json_schema:{name:'mwg_initial_draft',strict:false,value:{type:'object',required:['player'],properties:{player:{type:'object'}}}}};
let baseline;
for(const settings of configurations){
 const before=structuredClone(settings),calls=[];
 const ports=createGlobalTowerGenerationPorts({generateRaw:async request=>{calls.push(structuredClone(request));return '{"player":{}}';}},()=>({chatId:'test',chatCompletionSettings:settings}));
 assert.equal(await ports.generate(config),'{"player":{}}');assert.equal(calls.length,1);
 const request=calls[0];
 for(const key of ['json_schema','tools','tool_choice','custom_api','deepseek_thinking_mode','structured_delivery','empty_json_fallback'])assert.equal(Object.hasOwn(request,key),false,key);
 assert.equal(request.user_input,config.user_input);assert.deepEqual(settings,before);
 assert.match(request.ordered_prompts[1].content,/"required":\["player"\]/);
 if(baseline)assert.deepEqual(request,baseline,'model labels must not change business delivery');else baseline=request;
 for(const patch of [{tools:[]},{custom_api:{source:'custom'}},{tool_choice:'auto'}]){
  await assert.rejects(ports.generate({...config,...patch}),/显式工具或自定义API/);
 }
 assert.equal(calls.length,1);
}
console.log('PASS actual generation ports deliver identical ordinary-text JSON contracts across five route/model settings; no native schema/tools, hidden retries or setting overrides.');

for(const name of ['mwg_rest_card_upgrade','mwg_rest_card_transform','mwg_initial_battle_repair','mwg_battle_settlement_repair']){
 const schema={name,value:{type:'object',properties:{result:{type:'string'}},required:['result']}};
 const contract=createSchemaCompatibilityMessage(schema);
 assert.ok(contract);
 assert.ok(contract.content.includes(JSON.stringify(schema.value)));
 const requests=[];
 const ports=createGlobalTowerGenerationPorts({generateRaw:async request=>{requests.push(request);return '{"result":"unchanged"}';}},()=>({chatId:'rest',chatCompletionSettings:{chat_completion_source:'custom',custom_model:'unlisted'}}));
 await ports.generate({...config,json_schema:schema});
 assert.equal(requests.length,1);
 for(const field of ['json_schema','response_format','tools','tool_choice','deepseek_thinking_mode'])assert.equal(Object.hasOwn(requests[0],field),false);
 assert.deepEqual(requests[0].ordered_prompts[1],contract);
}
console.log('PASS campfire and persistent MVU repair contracts delivered in ordinary text without native formatting parameters.');
