import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {normalizeCombatResourceStates,validateCombatResourceDefinitions,resolveCardResourcePayment}=require('../src/game-core/combatResource.ts');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const definition={id:'charge',name:'充能',emoji:'⚡',description:'积累后支付；不是自动获得。 <b>原说明</b>',start:2,max:5,refresh:'retain'};
const source=createInitialDraftJsonSchema().value;
const validate=new Ajv2020({strict:false}).compile({$ref:'#/$defs/mwgCombatResource',$defs:source.$defs});
assert.equal(validate(definition),true,JSON.stringify(validate.errors));
assert.deepEqual(validateCombatResourceDefinitions([definition]),[]);
for(const description of [null,3,{},[]]){
 assert.equal(validate({...definition,description}),false);
 assert.equal(validateCombatResourceDefinitions([{...definition,description}])[0].code,'INVALID_RESOURCE_DESCRIPTION');
}
const state=normalizeCombatResourceStates([definition]);
assert.equal(state.charge.description,definition.description);
assert.deepEqual(normalizeCombatResourceStates(JSON.parse(JSON.stringify(state))),state);
assert.deepEqual(resolveCardResourcePayment({charge:1},{energy:0,charge:state.charge.current}).spent,{charge:1});
assert.equal(state.charge.current,2,'description never creates resources or spends them');
const draft={spec:'mwg.initial-draft/v1',narrative:'preset',player:{core:{},cards:[]},opening:{choices:[]},registry:{resources:[definition],statuses:[],templates:[]}};
const compiled=compileInitialDraftToMvu(draft);assert.equal(compiled.ok,true);
assert.equal(compiled.value.player.core.resources[0].description,definition.description);
assert.equal(definition.start,2);
console.log('PASS resource explanation: schema/validator agreement, exact compiler/runtime/reload preservation, no inferred mechanics.');
