import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createGlobalTowerGenerationPorts,createProviderSafeJsonSchema}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createTowerNodeJsonSchema,createTowerNodeBatchJsonSchema}=require('../src/game-core/towerRequest.ts');
const jobs=['battle','battle','battle'].map((kind,i)=>({nodeId:`node_${i}`,requestId:`request_${i}`,basedOnRevision:0,kind,act:1,floor:2,contentSeed:11+i,rewardSeed:21+i,difficultyMultiplier:1}));
function expand(doc){
 if(!doc.$defs)return doc;
 const {$defs,...root}=doc;
 const visit=v=>{
  if(Array.isArray(v))return v.map(visit);
  if(!v||typeof v!=='object')return v;
  if(Object.keys(v).length===1&&/^#\/\$defs\/S\d+$/.test(v.$ref||'')){const target=$defs[v.$ref.split('/').at(-1)];assert.ok(target);return visit(target);}
  return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));
 };return visit(root);
}
const measurements=[];
for(const schema of [...['battle','elite','boss','event','shop','treasure','rest'].map(kind=>createTowerNodeJsonSchema(kind,{act:1,floor:2})),createTowerNodeBatchJsonSchema('batch',jobs)]){
 const before=structuredClone(schema),expected=createProviderSafeJsonSchema(schema).value;
 let captured;
 const ports=createGlobalTowerGenerationPorts({generateRaw:async c=>{captured=c;return '{}';}},()=>({chatId:'offline',chatCompletionSettings:{chat_completion_source:'custom',custom_model:'unlisted'}}));
 await ports.generate({generation_id:'schema-test',user_input:'UNCHANGED GAMEPLAY',should_stream:true,should_silence:true,structured_delivery:'text-json',json_schema:schema});
 assert.equal(captured.user_input,'UNCHANGED GAMEPLAY');
 for(const key of ['json_schema','response_format','tools','custom_api','deepseek_thinking_mode'])assert.equal(Object.hasOwn(captured,key),false);
 const text=captured.ordered_prompts[1].content,actual=JSON.parse(text.slice(text.indexOf('{')));
 assert.deepEqual(expand(actual),expected,'all original field, branch, identity and limit constraints survive');
 assert.deepEqual(schema,before,'no source contract mutation');
 measurements.push({name:schema.name,before:JSON.stringify(expected).length,after:text.length});
}
const batch=measurements.at(-1);assert.ok(batch.after<batch.before,'batch sharing must actually reduce message size');
console.log(JSON.stringify({passed:true,scope:'Actual ordinary-text generation ports, seven node kinds and three-battle batch; exact expanded contract equality, no forced API format or gameplay deletion',measurements}));
