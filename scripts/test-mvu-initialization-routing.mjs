import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {needsMvuInitializationRules}=require('../src/sillytavern-extension/mvuInitializationRouting.ts');
for(const cards of [[],undefined,null]) {
  const input={stat_data:{battle:{cards}}};
  const before=structuredClone(input);
  assert.equal(needsMvuInitializationRules(input,true),true);
  assert.equal(needsMvuInitializationRules(input,false),false,'later empty deck cannot reinitialize');
  assert.deepEqual(input,before);
}
for(const cards of [[{id:'held'}],[{}],{},'broken',0]) {
  assert.equal(needsMvuInitializationRules({stat_data:{battle:{cards}}},true),false,'existing or damaged content belongs to repair');
}
for(const value of [null,{},[],{stat_data:{}},{stat_data:{battle:[]}}]) assert.equal(needsMvuInitializationRules(value,true),false);
console.log('PASS scan activation requires first assistant floor and absent/empty cards; no state mutation.');
