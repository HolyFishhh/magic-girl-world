import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {createProviderSafeJsonSchema}=require('../src/sillytavern-extension/towerGenerationHost.ts');
const {createSchemaCompatibilityMessage,shareSchemaPromptDefinitions}=require('../src/sillytavern-extension/schemaPromptTransport.ts');
const schema=createProviderSafeJsonSchema(createInitialDraftJsonSchema({includeNarrative:false}));
const before=structuredClone(schema),message=createSchemaCompatibilityMessage(schema);
const delivered=JSON.parse(message.content.slice(message.content.indexOf('\n{')+1));
const shared=shareSchemaPromptDefinitions(schema.value);
console.log(JSON.stringify({original:JSON.stringify(schema.value).length,shared:JSON.stringify(shared).length,delivered:JSON.stringify(delivered).length}));
assert.ok(JSON.stringify(delivered).length<JSON.stringify(schema.value).length*.8,'actual custom initial compatibility must share repeated definitions');
function restore(value,defs=delivered.$defs){
 if(Array.isArray(value))return value.map(x=>restore(x,defs));
 if(!value||typeof value!=='object')return value;
 if(Object.keys(value).length===1&&/^#\/\$defs\/S\d+$/.test(value.$ref||''))return restore(defs[value.$ref.split('/').at(-1)],defs);
 return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='$defs').map(([k,v])=>[k,restore(v,defs)]));
}
assert.deepEqual(restore(delivered),schema.value,'all source constraints survive expansion');
assert.deepEqual(schema,before);
const ajv=new Ajv2020({strict:false,allErrors:true});
const oldCheck=ajv.compile(schema.value),newCheck=ajv.compile(delivered);
const retainedFiles=[[46,81],[47,84],[48,93],[49,93],[50,93],[51,93],[52,93],[53,102],...[58,59,60,61,62].map(n=>[n,113])];
for(const [number,version] of process.argv.includes('--retained') ? retainedFiles : []){
 const path=`tmp/initial${number}-mechanism-final-v${version}.json`,bytes=readFileSync(path);
 const entries=JSON.parse(bytes);let checked=0;
 for(const {value}of entries.filter(x=>x.value?.player)){
  assert.equal(newCheck(value),oldCheck(value),`retained ${number} acceptance unchanged`);
  for(const key of ['player','opening','registry']){const missing=structuredClone(value);delete missing[key];assert.equal(newCheck(missing),false,`required ${key}`);}
  checked++;
 }
 assert.deepEqual(readFileSync(path),bytes);
 console.log(JSON.stringify({sample:number,retainedDraftsChecked:checked,acceptanceUnchanged:true,evidenceUnchanged:true}));
}
for(const keyword of ['$dynamicAnchor','$recursiveAnchor','definitions']){
 const scoped={type:'object',properties:{a:{type:'object',[keyword]:keyword==='definitions'?{}:keyword==='$recursiveAnchor'?true:'anchor',description:'x'.repeat(200)}}};
 scoped.properties.b=structuredClone(scoped.properties.a);
 assert.deepEqual(shareSchemaPromptDefinitions(scoped),scoped,'existing reference scope is not relocated');
}
console.log('PASS custom initial sharing: lossless constraints, no input mutation, existing reference scopes preserved'+(process.argv.includes('--retained')?'; retained cohorts acceptance and required envelope checked':''));
