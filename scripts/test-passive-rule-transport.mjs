import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { createProviderSafeJsonSchema }=require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));
const { createTowerInitialContentJsonSchema,createTowerInitialRootRepairJsonSchema,createTowerNodeBatchJsonSchema,createTowerNodeJsonSchema }=require(resolve('src/game-core/towerRequest.ts'));
const { createInitialDraftJsonSchema }=require(resolve('src/game-core/initialDraftSchema.ts'));
const { compileCompactEffectList }=require(resolve('src/game-core/compactEffectDsl.ts'));
const { factorSchemaObjectProperties }=require(resolve('src/sillytavern-extension/schemaPromptTransport.ts'));
const publicSchema=require(resolve('schemas/mwg-card-effects-v1.schema.json'));
const ajv=new Ajv2020({strict:false,allErrors:true});
const validatePublic=ajv.compile({$defs:publicSchema.$defs,$ref:'#/$defs/cardPlayRuleEffect'});
const jobs=['battle','event'].map((kind,i)=>({nodeId:`act-1-floor-${i+2}-col-0`,requestId:`r${i}`,basedOnRevision:7,kind,act:1,floor:i+2,contentSeed:11,rewardSeed:12,difficultyMultiplier:1}));
const sources=[createTowerInitialContentJsonSchema(),createInitialDraftJsonSchema({includeNarrative:false}),
  createTowerNodeJsonSchema('battle',{nodeId:jobs[0].nodeId,act:1,floor:2}),createTowerNodeBatchJsonSchema('b45',jobs),
  createTowerInitialRootRepairJsonSchema([
    {token:'r0',kind:'opening_choice',preserveId:'gift_alpha'},
    {token:'r1',kind:'player_card',preserveId:'card_alpha'},
    {token:'r2',kind:'player_card',preserveId:'card_beta'},
    {token:'r3',kind:'player_core'},
    {token:'r4',kind:'player_ability',preserveId:'ability_alpha',nullable:true},
    {token:'r5',kind:'player_status_definition',preserveId:'status_alpha'},
  ])];
const projected=sources.map(source=>{
  const before=structuredClone(source);
  const schema=createProviderSafeJsonSchema(source);
  assert.deepEqual(source,before,'transport projection does not mutate the authoritative schema');
  return {name:source.name,schema};
});
for(const {name,schema} of projected){
  console.log(`${name}: ${JSON.stringify(schema).length} transport characters`);
  if(schema.value.properties.roots){
    console.log(Object.fromEntries(Object.entries(schema.value.properties.roots.properties).map(([k,v])=>[k,JSON.stringify(v).length])));
    assert.deepEqual(factorSchemaObjectProperties(schema.value),schema.value,'already-shared root repair is idempotent');
  }
}
const cases=[
  [{card_rule:'retain_hand'},true], [{card_rule:'retain_block'},true],
  [{card_rule:'retain_hand',limit:1},false], [{card_rule:'retain_block',limit:'all'},false],
  [{card_rule:'deny_card_play',card_type:'Attack'},true],
  [{card_rule:'deny_card_play',card_type:'Attack',limit:1},false],
  [{card_rule:'allow_card_play',card_type:'Skill'},true],
  [{card_rule:'limit_card_play',card_type:'Skill',limit:1},true],
  [{card_rule:'limit_draw',limit:3},true], [{card_rule:'limit_draw'},false],
  [{card_rule:'limit_block_gain',limit:10},true], [{card_rule:'limit_energy_gain',limit:3},true],
  [{card_rule:'replay',limit:1,extra:1},true],
  [{card_rule:'replay',limit:'stacks',extra:'stacks'},true],
  [{card_rule:'replay',limit:1},false], [{card_rule:'retain_hand',extra:1},false],
  [{card_rule:'free',limit:1,resources:['ink']},true], [{card_rule:'free',limit:'all'},true],
  [{card_rule:'free',limit:1,extra:1},false], [{card_rule:'retain_hand',resources:'all'},false],
  [{card_rule:'card_destination',card_type:'Attack',destination:'exhaust',priority:2},true],
  [{card_rule:'card_destination',card_type:'Attack',destination:'exhaust',limit:1},false],
  [{card_rule:'card_destination',card_type:'Attack'},false],
  [{card_rule:'retain_hand',destination:'exhaust'},false],
  [{card_rule:'free',limit:1,to:'opponent',keyword:'exhaust'},true],
  [{card_rule:'invented_rule'},false], [{card_rule:null},false], [{card_rule:{retain_hand:true}},false],
];
for(const card_rule of publicSchema.$defs.cardPlayRuleEffect.properties.card_rule.enum){
  for(let mask=0;mask<16;mask++){
    const candidate={card_rule,card_type:'Attack',
      ...(mask&1?{limit:1}:{}),...(mask&2?{extra:1}:{}),
      ...(mask&4?{destination:'exhaust'}:{}),...(mask&8?{resources:'all'}:{})};
    cases.push([candidate,validatePublic(candidate)]);
  }
}
for(const [value,expected] of cases){
  const before=structuredClone(value);
  assert.equal(validatePublic(value),expected,`public schema: ${JSON.stringify(value)}`);
  assert.equal(compileCompactEffectList(value).ok,expected,`compiler: ${JSON.stringify(value)}`);
  assert.deepEqual(value,before,'public schema and compiler do not mutate input');
}
// The provider outline deliberately does not duplicate every value/formula
// validator. These bad values must still fail the actual public/runtime gate;
// their acceptance by the outline is not semantic approval.
const invalidValues=[
  {card_rule:'free',limit:1,to:'teleport'},
  {card_rule:'free',limit:1,keyword:'invented_keyword'},
  {card_rule:'card_destination',card_type:'Attack',destination:'exhaust',priority:100001},
];
for(const value of invalidValues){
  assert.equal(validatePublic(value),false);
  assert.equal(compileCompactEffectList(value).ok,false);
}
let tested=0;
// Inspect every actual projected passive object, including nested status holds
// below rewards; merely testing a helper would miss the compact status route.
function walk(value,path,visit){
  if(!value||typeof value!=='object')return;
  if(!Array.isArray(value)&&value.type==='object'&&value.properties?.modify
    &&(value.properties?.card_rule||value.propertyNames?.enum?.includes('card_rule')))visit(value,path);
  for(const [key,child] of Object.entries(value))walk(child,`${path}/${key}`,visit);
}
for(const {name,schema} of projected){
  let locations=0;
  walk(schema.value,name,(item,path)=>{
    locations++;
    const validate=ajv.compile(item);
    for(const [value,expected] of cases){
      const before=structuredClone(value);
      assert.equal(validate(value),expected,`${path}: ${JSON.stringify(value)}`);tested++;
      assert.deepEqual(value,before,'schema checks never mutate authorship');
    }
    assert.equal(validate({modify:'damage',add:2}),true,`${path}: modifier remains legal`);
    assert.equal(validate({modify:'damage',add:2,card_rule:'retain_hand'}),false,`${path}: operations cannot be mixed`);
    assert.equal(validate({}),false,`${path}: empty passive is not content`);
    for(const value of invalidValues)assert.equal(validate(value),true,`${path}: value validation remains a separate runtime gate`);
    if(item.propertyNames)assert.deepEqual(new Set(item.propertyNames.enum),
      new Set(['modify','add','subtract','multiply','divide','set',...Object.keys(publicSchema.$defs.cardPlayRuleEffect.properties)]),
      `${path}: every public field name is preserved, no invented names added`);
  });
  assert.ok(locations>0,`${name} must expose passive rules`);
  assert.ok(JSON.stringify(schema).length<64000,`${name}: bounded transport remains below 64k`);
  assert.doesNotMatch(JSON.stringify(schema),/"\$(?:defs|ref)"/);
}
const actualRoots=projected.find(entry=>entry.name==='mwg_tower_initial_root_repair').schema.value.properties.roots;
const sharedCards=Object.entries(actualRoots.patternProperties||{}).filter(([pattern])=>new RegExp(pattern).test('r1')&&new RegExp(pattern).test('r2'));
assert.ok(sharedCards.length>0,'actual six-root transport contains a shared card conjunct, not only a size log');
assert.deepEqual(actualRoots.properties.r1.allOf,[{type:'object',properties:{id:{type:'string',const:'card_alpha'}},required:['id']}]);
assert.deepEqual(actualRoots.properties.r2.allOf,[{type:'object',properties:{id:{type:'string',const:'card_beta'}},required:['id']}]);
const actualPair={type:'object',required:['r1','r2'],additionalProperties:false,
  properties:{r1:actualRoots.properties.r1,r2:actualRoots.properties.r2},
  patternProperties:Object.fromEntries(sharedCards)};
const validatePair=ajv.compile(actualPair);
const card=id=>({id,name:id,type:'Skill',rarity:'Common',quantity:1,cost:1,effects:{block:3}});
const pair={r1:card('card_alpha'),r2:card('card_beta')};
assert.equal(validatePair(pair),true,JSON.stringify(validatePair.errors));
for(const mutate of [value=>value.r1.id='card_beta',value=>value.r2.id='card_alpha',
  value=>delete value.r1.type,value=>value.r2.quantity=0,value=>value.r1.extra=true,
  value=>delete value.r2,value=>value['r1\n']=card('card_alpha')]){
  const invalid=structuredClone(pair);mutate(invalid);
  assert.equal(validatePair(invalid),false,'actual shared schema preserves each slot ID, required fields, counts and closed shape');
}
console.log(`PASS ${tested} tested passive field-presence/example combinations match public schema and compiler; value validation remains a runtime gate. Actual six-root card sharing/slot IDs verified; no mutation, no recursive refs, bounded transport.`);
