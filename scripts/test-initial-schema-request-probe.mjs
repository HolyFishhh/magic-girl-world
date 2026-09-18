import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeInitialSchemaRequest} from './lib/initial-schema-request-probe.mjs';
const schema={type:'object',properties:{spec:{const:'sample'},player:{$ref:'#/$defs/S0'}},$defs:{S0:{type:'object',required:['hp'],properties:{hp:{type:'integer'}}}}};
const full={type:'object',properties:{spec:{const:'sample'},player:schema.$defs.S0}};
const event={method:'Network.requestWillBeSent',params:{requestId:'123.4',request:{url:'http://127.0.0.1:8012/api/backends/chat-completions/generate',method:'POST',headers:{Authorization:'PRIVATE_HEADER'},postData:JSON.stringify({
  proxy_password:'PRIVATE_PASSWORD',reasoning_content:'PRIVATE_REASONING',chat_completion_source:'deepseek',model:'deepseek-v4-flash',
  max_tokens:20000,stream:true,
  json_schema:{name:'mwg_initial_draft',value:{type:'object'}},messages:[
    {role:'system',content:'MWG_TOWER_STRUCTURED_REQUEST:mwg-single-floor-start-0-123456789__draft'},
    {role:'user',content:'PRIVATE_NARRATIVE'},
    {role:'system',content:`[MWG_RESPONSE_SCHEMA/v1]\nfull contract\n${JSON.stringify(schema)}`},
  ],
})}}};
const before=structuredClone(event);
const result=await summarizeInitialSchemaRequest(event);
assert.equal(result.schemaDigestComputed,true);
assert.equal(result.maximumReplyTokens,20000);assert.equal(result.streamRequested,true);
assert.equal(Object.hasOwn(result, 'schemaVerified'), false);
assert.equal(result.completeSchemaSha256,createHash('sha256').update(JSON.stringify(full)).digest('hex'));
assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|Authorization|proxy_password|messages|postData/);
assert.deepEqual(event,before);
const toolEvent = structuredClone(event), toolPayload = JSON.parse(toolEvent.params.request.postData);
delete toolPayload.json_schema;
toolPayload.messages = toolPayload.messages.slice(0, 2);
toolPayload.tools = [{ type: 'function', function: { name: 'submit_initial_draft',
  description: 'PRIVATE_DESCRIPTION', parameters: schema } }];
toolPayload.tool_choice = 'auto';
toolEvent.params.request.postData = JSON.stringify(toolPayload);
const toolBefore = structuredClone(toolEvent);
const toolResult = await summarizeInitialSchemaRequest(toolEvent);
assert.equal(toolResult.schemaDigestComputed, true);
assert.equal(toolResult.contractChannel, 'tool');
assert.equal(toolResult.nativeJsonModeRequested, false);
assert.equal(toolResult.toolCount, 1);
assert.equal(toolResult.toolChoice, 'auto');
assert.equal(toolResult.completeSchemaSha256, result.completeSchemaSha256);
assert.doesNotMatch(JSON.stringify(toolResult), /PRIVATE_|Authorization|proxy_password|messages|postData/);
assert.deepEqual(toolEvent, toolBefore);
const merged=structuredClone(toolEvent),mergedPayload=structuredClone(toolPayload);
mergedPayload.messages[0].content+='\n\nPRIVATE_COMBINED_SYSTEM_INSTRUCTIONS';
merged.params.request.postData=JSON.stringify(mergedPayload);
const mergedResult=await summarizeInitialSchemaRequest(merged);
assert.equal(mergedResult.completeSchemaSha256,toolResult.completeSchemaSha256);
assert.equal(mergedResult.generationId,toolResult.generationId);
assert.doesNotMatch(JSON.stringify(mergedResult),/PRIVATE_/);
for(const prefix of ['quoted: ','> ']) {
  const quoted=structuredClone(toolEvent),body=structuredClone(toolPayload);
  body.messages[0].content=prefix+body.messages[0].content;
  quoted.params.request.postData=JSON.stringify(body);
  assert.equal(await summarizeInitialSchemaRequest(quoted),null);
}
const ambiguous=structuredClone(toolEvent),ambiguousPayload=structuredClone(toolPayload);
ambiguousPayload.messages.push({...ambiguousPayload.messages[0],content:'MWG_TOWER_STRUCTURED_REQUEST:mwg-single-floor-start-0-987654321__draft'});
ambiguous.params.request.postData=JSON.stringify(ambiguousPayload);
assert.equal(await summarizeInitialSchemaRequest(ambiguous),null);
for (const patch of [
  { tools: [] }, { tools: [toolPayload.tools[0], toolPayload.tools[0]] },
  { tools: [{ ...toolPayload.tools[0], function: { ...toolPayload.tools[0].function, name: 'PRIVATE_TOOL' } }] },
  { messages: JSON.parse(event.params.request.postData).messages },
  { json_schema: { name: 'mwg_initial_draft', value: { type: 'object' } } },
]) {
  const bad = structuredClone(toolEvent);
  bad.params.request.postData = JSON.stringify({ ...toolPayload, ...patch });
  const summary = await summarizeInitialSchemaRequest(bad);
  assert.equal(summary.schemaDigestComputed, false, 'ambiguous/unexpected transport has no contract digest');
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_/);
}
for(const url of ['https://chatgpt.com/','http://127.0.0.1:8012/api/settings/get','http://127.0.0.1:9000/api/backends/chat-completions/generate']){
  const other=structuredClone(event);other.params.request.url=url;
  assert.equal(await summarizeInitialSchemaRequest(other),null);
}
for(const invalid of ['not JSON','{}',JSON.stringify({messages:[{role:'system',content:'PRIVATE_MARKER'}]})]){
  const other=structuredClone(event);other.params.request.postData=invalid;
  assert.equal(await summarizeInitialSchemaRequest(other),null);
}
const cyclic=structuredClone(event),payload=JSON.parse(cyclic.params.request.postData);
payload.messages[2].content='[MWG_RESPONSE_SCHEMA/v1]\n'+JSON.stringify({properties:{p:{$ref:'#/$defs/S0'}},$defs:{S0:{$ref:'#/$defs/S0'}}});
cyclic.params.request.postData=JSON.stringify(payload);
assert.equal((await summarizeInitialSchemaRequest(cyclic)).schemaDigestComputed,false);
console.log('Initial schema request probe returns bounded metadata only, exact schema digest, no secrets, and rejects cycles/unrelated requests.');
