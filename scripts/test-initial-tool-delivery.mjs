import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createGlobalTowerGenerationPorts,createProviderSafeJsonSchema}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {SCHEMA_PROMPT_MARKER}=require('../src/sillytavern-extension/schemaPromptTransport.ts');
const {parseStructuredRecord}=require('../src/sillytavern-extension/structuredRecord.ts');
const envelope=JSON.parse(readFileSync(new URL('./fixtures/initial-tool-draft-response.json',import.meta.url),'utf8'));
const schema=createInitialDraftJsonSchema({includeNarrative:false});
const config={generation_id:'mwg-test__draft_empty_retry',user_input:'Locked preset narrative and all authored gameplay rules',
  should_stream:true,should_silence:true,max_chat_history:0,json_schema:schema,empty_json_fallback:true};
const settings={chat_completion_source:'deepseek',deepseek_model:'deepseek-v4-flash',show_thoughts:true,
  reasoning_effort:'high',function_calling:false,openai_max_tokens:65535};
const originalSettings=structuredClone(settings),originalConfig=structuredClone(config),originalEnvelope=structuredClone(envelope);
let helperConfig,calls=0;
const ports=createGlobalTowerGenerationPorts({generateRaw:async value=>{calls++;helperConfig=value;return envelope;}},()=>({chatCompletionSettings:settings}));
const result=await ports.generate(config);
assert.equal(result,envelope.tool_calls[0].function.arguments,'preserve the exact argument text for the controller monitor, not a repaired substitute or envelope');
assert.deepEqual(parseStructuredRecord(result),JSON.parse(envelope.tool_calls[0].function.arguments));
assert.equal(calls,1,'the transport itself never retries');
assert.deepEqual(helperConfig.custom_api,{source:'deepseek'},'use Helper own streaming parser without changing global function calling or credentials');
assert.equal(helperConfig.tool_choice,'auto','thinking mode rejects forced tool_choice');
assert.equal(helperConfig.tools.length,1);assert.equal(helperConfig.tools[0].function.name,'submit_initial_draft');
assert.equal('strict' in helperConfig.tools[0].function,false,'do not pretend the compact grammar meets provider strict subset');
assert.equal('json_schema' in helperConfig,false);assert.equal('empty_json_fallback' in helperConfig,false);
assert.equal(helperConfig.user_input,config.user_input);
assert.equal(helperConfig.ordered_prompts.some(p=>typeof p==='object'&&p.content.startsWith(SCHEMA_PROMPT_MARKER)),false,'do not duplicate the full schema in text');
const {$defs,...root}=helperConfig.tools[0].function.parameters;
const expand=value=>Array.isArray(value)?value.map(expand):!value||typeof value!=='object'?value:
  Object.keys(value).length===1&&/^#\/\$defs\/S\d+$/.test(value.$ref||'')?expand($defs[value.$ref.split('/').at(-1)]):
  Object.fromEntries(Object.entries(value).map(([key,child])=>[key,expand(child)]));
assert.deepEqual(expand(root),createProviderSafeJsonSchema(schema).value,'all original constraints survive tool transport');
assert.deepEqual(settings,originalSettings);assert.deepEqual(config,originalConfig);assert.deepEqual(envelope,originalEnvelope);
// The proven data-only tool path should be the first request for the inspected
// v4 registry protocol, not a reward for first wasting an empty JSON-mode call.
for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
  for (const thinking of [false, true]) {
    let firstSeen, firstCalls = 0;
    const firstSettings = { ...settings, deepseek_model: model, show_thoughts: thinking };
    const firstSettingsBefore = structuredClone(firstSettings);
    const first = { ...config, generation_id: 'mwg-test__draft', empty_json_fallback: false };
    const firstBefore = structuredClone(first);
    const h = createGlobalTowerGenerationPorts({ generateRaw: async value => {
      firstCalls++; firstSeen = value; return structuredClone(envelope);
    } }, () => ({ chatCompletionSettings: firstSettings }));
    assert.equal(await h.generate(first), envelope.tool_calls[0].function.arguments);
    assert.equal(firstCalls, 1);
    assert.deepEqual(firstSeen.custom_api, { source: 'deepseek' });
    assert.equal(firstSeen.tool_choice, 'auto');
    assert.deepEqual(firstSeen.tools, helperConfig.tools, 'first and fallback keep exactly the same complete tool schema');
    assert.equal('json_schema' in firstSeen, false);
    assert.equal(firstSeen.user_input, first.user_input);
    assert.deepEqual(firstSettings, firstSettingsBefore, 'thinking/model/sampling globals remain untouched');
    assert.deepEqual(first, firstBefore);
  }
}
// A truly empty FIRST Helper result must still reach the controller's existing
// shared one-extra-request budget. The final fallback remains fail-closed.
for (const empty of ['', ' \n ']) {
  let count = 0;
  const h = createGlobalTowerGenerationPorts({ generateRaw: async () => { count++; return empty; } },
    () => ({ chatCompletionSettings: settings }));
  assert.equal(await h.generate({ ...config, generation_id: 'mwg-test__draft', empty_json_fallback: false }), empty);
  assert.equal(count, 1, 'adapter never retries internally');
  await assert.rejects(h.generate(config), /机制|草稿|工具/);
  assert.equal(count, 2);
}
for(const [label,patch,hostPatch] of [
  ['other provider',{}, {chat_completion_source:'openai'}],
  ['unknown model',{}, {deepseek_model:'other'}],
  ['old model',{}, {deepseek_model:'deepseek-reasoner'}],
  ['user custom route',{custom_api:{source:'deepseek',model:'keep-me'}},{}],
  ['other schema',{json_schema:{...schema,name:'mwg_initial_draft_registry_repair'}},{}],
  ['caller tools',{tools:[{type:'function',function:{name:'keep_me'}}]},{}],
]){
  let seen;
  const h=createGlobalTowerGenerationPorts({generateRaw:async v=>{seen=v;return 'unchanged-response';}},()=>({chatCompletionSettings:{...settings,...hostPatch}}));
  const input={...config,...patch};assert.equal(await h.generate(input),'unchanged-response',label);
  assert.deepEqual(seen.custom_api,input.custom_api,label);assert.deepEqual(seen.tools,input.tools,label);
}
for(const bad of ['',{},null,{tool_calls:[]},
  {...envelope,tool_calls:[...envelope.tool_calls,...envelope.tool_calls]},
  {...envelope,tool_calls:[{type:'function',function:{name:'delete_save',arguments:'{}'}}]},
  ...['',' '.repeat(3),'x'.repeat(1_000_001),null,{}].map(argumentsText=>({...envelope,tool_calls:[{type:'function',function:{name:'submit_initial_draft',arguments:argumentsText}}]})),
]){
  let count=0;
  const h=createGlobalTowerGenerationPorts({generateRaw:async()=>{count++;return bad;}},()=>({chatCompletionSettings:settings}));
  await assert.rejects(h.generate(config),/备用|草稿|工具|JSON/);assert.equal(count,1);
}
const prose=createGlobalTowerGenerationPorts({generateRaw:async()=>'{"player":{}}'},()=>({chatCompletionSettings:settings}));
assert.equal(await prose.generate(config),'{"player":{}}','auto may return ordinary final JSON, still subject to the existing complete validation gates');
// Synthetic counterexamples, not the uncaptured sample31 payload. An authorized
// data envelope must deliver even unparseable bytes to controller diagnostics;
// the unchanged authoritative parser must still reject them before publication.
for(const args of ['not json','[]','null','1','{"player":true false}','{"player":{"a":1}:2}','{"player":"\\u12G4"}']) {
  const original={tool_calls:[{type:'function',function:{name:'submit_initial_draft',arguments:args}}]};
  const before=structuredClone(original);
  let count=0;
  const h=createGlobalTowerGenerationPorts({generateRaw:async()=>{count++;return original;}},()=>({chatCompletionSettings:settings}));
  const delivered=await h.generate(config);
  assert.equal(delivered,args,'transport must not swallow or normalize invalid draft evidence');
  assert.throws(()=>parseStructuredRecord(delivered),/没有返回合法 JSON/);
  assert.equal(count,1);assert.deepEqual(original,before);
}
// Actual Helper-owned stream output had incomplete closing punctuation. It
// receives exactly the existing text parser's syntax recovery, not new rules.
const syntaxEnvelope=JSON.parse(readFileSync(new URL('./fixtures/initial-tool-draft-syntax-response.json',import.meta.url),'utf8'));
const syntaxSource=syntaxEnvelope.tool_calls[0].function.arguments;
assert.throws(()=>JSON.parse(syntaxSource),SyntaxError,'keep the original malformed model arguments in this fixture');
let syntaxCalls=0;
const syntaxPorts=createGlobalTowerGenerationPorts({generateRaw:async()=>{syntaxCalls++;return syntaxEnvelope;}},()=>({chatCompletionSettings:settings}));
const syntaxResult=await syntaxPorts.generate(config);
assert.equal(syntaxResult,syntaxSource,'the monitor must see original malformed arguments, not post-repair JSON');
const parsedSyntaxResult=parseStructuredRecord(syntaxResult);
const dataTokens=text=>(text.match(/"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)||[]).map(token=>JSON.parse(token));
assert.deepEqual(dataTokens(JSON.stringify(parsedSyntaxResult)),dataTokens(syntaxSource),'syntax recovery must preserve every field, text and numeric value in the captured draft');
assert.equal(syntaxCalls,1);assert.equal(parsedSyntaxResult.player.cards.reduce((n,c)=>n+c.quantity,0),13);
assert.deepEqual(parsedSyntaxResult.opening.choices.map(c=>c.id),['silver_wick','crimson_wick','tide_wick']);
// A possible explanation of sample28's normalized {player:null}, not a claim
// about its uncaptured upstream bytes. A parser may fill null from a truncation;
// the transport must not erase that distinction before monitoring.
const truncatedArgs='{"player":';
const truncatedPorts=createGlobalTowerGenerationPorts({generateRaw:async()=>({tool_calls:[{
  type:'function',function:{name:'submit_initial_draft',arguments:truncatedArgs},
}]})},()=>({chatCompletionSettings:settings}));
const truncatedResult=await truncatedPorts.generate(config);
assert.equal(truncatedResult,truncatedArgs);
assert.throws(()=>parseStructuredRecord(truncatedResult),/缺失值|空值/,'truncated field must reach recovery, never invent null');
console.log('PASS initial tool delivery: v4 registry first/fallback use exact data-only tool arguments and full schema, real empty first returns to the existing budget, no adapter retry or global changes, other providers/custom routes isolated.');
