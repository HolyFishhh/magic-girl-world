import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets:plan,parseTowerInitialSlotRepairResponse:parse,mergeTowerInitialSlotRepair:merge}=require('../src/sillytavern-extension/controller.ts');
const {createTowerInitialSlotRepairJsonSchema:schema}=require('../src/game-core/towerRequest.ts');
const {compileCompactEffectList:compile}=require('../src/game-core/compactEffectDsl.ts');
const effects={modify_summon:{selector:{owner:'self',pick:'all',tags:['wisp']},stat:'max_hp',add:4},
 modify_summon_effect:{selector:{owner:'self',pick:'all',tags:['wisp']},stat:'damage',add:2}};
const original={player:{cards:[{id:'empower',name:'强化',type:'Skill',rarity:'Common',cost:1,quantity:1,effects}]}};
const error='battle.cards[0].effects.modify_summon：规则字段不符合浅层 effects 契约（具体原因：该操作必须单独占一个 effects 数组项）';
const before=structuredClone(original),targets=plan(original,error);
assert.equal(targets.length,1);assert.equal(targets[0].slots.length,1);
const slot=targets[0].slots[0];assert.equal(slot.kind,'effect_order_strategy');
assert.deepEqual(slot.operationNames,Object.keys(effects));
const wireSchema=schema(targets).value.properties.roots.properties.r0.properties.slots.properties.s0.properties.value;
assert.deepEqual(wireSchema.items.enum,Object.keys(effects));assert.equal(wireSchema.uniqueItems,true);
const reply=value=>({spec:'mwg.tower-initial-slot-repair/v1',roots:{r0:{slots:{s0:{action:'replace_effect',value}}}},support_statuses:[],support_resources:[]});
for(const order of [Object.keys(effects),Object.keys(effects).reverse()]) {
 const fixed=merge(original,targets,parse(reply(order),targets));
 const expected=structuredClone(original);expected.player.cards[0].effects=order.map(key=>({[key]:effects[key]}));
 assert.deepEqual(fixed,expected,'only AI-selected order changes; all original payloads are exact');
 assert.equal(compile(fixed.player.cards[0].effects).ok,true);
}
for(const invalid of [[],['modify_summon'],['modify_summon','modify_summon'],['modify_summon','damage'],
 [{modify_summon:effects.modify_summon},{modify_summon_effect:effects.modify_summon_effect}]])
 assert.throws(()=>parse(reply(invalid),targets),/唯一执行顺序/);
const nested=structuredClone(original);nested.player.cards[0].effects=[{damage:3},structuredClone(effects),{block:2}];
const nestedTargets=plan(nested,error.replace('effects.modify_summon','effects[1].modify_summon'));
assert.equal(nestedTargets[0].slots[0].kind,'effect_order_strategy');
const nestedFixed=merge(nested,nestedTargets,parse(reply(Object.keys(effects)),nestedTargets));
assert.deepEqual(nestedFixed.player.cards[0].effects,[{damage:3},...Object.keys(effects).map(key=>({[key]:effects[key]})),{block:2}],
 'array splice preserves the neighboring authored effects exactly');
for(const extra of [{when:'self.hp > 0'},{to:'self'},{targets:'all'},{scope:'turn'}]) {
 const shared=structuredClone(original);Object.assign(shared.player.cards[0].effects,extra);
 assert.ok(!plan(shared,error).some(root=>root.slots.some(s=>s.kind==='effect_order_strategy')),'shared parameters need a different semantic plan');
}
const invalid=structuredClone(original);invalid.player.cards[0].effects.modify_summon.stat='invented';
assert.ok(!plan(invalid,error).some(root=>root.slots.some(s=>s.kind==='effect_order_strategy')));
assert.deepEqual(original,before);
console.log('PASS exact-payload operation ordering: both permutations compile, omissions/duplicates/rewrites and ambiguous metadata rejected.');
