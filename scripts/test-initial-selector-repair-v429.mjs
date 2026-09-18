import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets:plan,parseTowerInitialSlotRepairResponse:parse,mergeTowerInitialSlotRepair:merge}=require('../src/sillytavern-extension/controller.ts');
const {createTowerInitialSlotRepairJsonSchema,TOWER_INITIAL_SLOT_REPAIR_SPEC:spec}=require('../src/game-core/towerRequest.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const card={id:'knife_seeker',name:'觅刀术',type:'Skill',rarity:'Uncommon',cost:1,quantity:2,unique:false,
  description:'从弃牌堆回收1张名称包含“小刀”的牌，并从抽牌堆移动1张同类牌到手牌。',effects:[
    {recover:1,from:'discard',pick:'all',name_contains:'小刀'},
    {move_card:1,from:'draw',destination:'hand',position:'top',pick:'all',name_contains:'小刀'},
  ]};
const original={narrative:'保持原剧情',player:{cards:[card,{id:'untouched',effects:{block:5}}]},opening:{title:'保持馈赠',choices:[]}};
const errors=compileCompactEffectList(card.effects).issues.map(i=>`battle.cards[0].${i.path.replace(/^effects\.?/,'effects.')}：${i.message}`).join('；');
// Error paths from the live readiness formatter use zero-based effects slots.
const targets=plan(original,'battle.cards[0].effects[0].recover：INVALID_CARD_COUNT pick: all requires recover: all；battle.cards[0].effects[1].move_card：INVALID_CARD_COUNT pick: all requires move_card: all；battle.cards[0].effects[1].count：INVALID_CARD_COUNT pick: all does not accept count');
assert.equal(targets.length,1);assert.equal(targets[0].slots.length,2);assert.ok(errors);
const response={spec,roots:{r0:{slots:Object.fromEntries(targets[0].slots.map(slot=>[slot.token,{action:slot.action,value:{...slot.original,pick:'choose'}}]))}},support_statuses:[],support_resources:[]};
const valid=new Ajv2020({strict:false}).compile(createTowerInitialSlotRepairJsonSchema(targets).value);
assert.equal(valid(response),true,JSON.stringify(valid.errors));
const result=merge(original,targets,parse(response,targets));
const expected=structuredClone(original);expected.player.cards[0].effects.forEach(e=>e.pick='choose');assert.deepEqual(result,expected);
assert.equal(compileCompactEffectList(result.player.cards[0].effects).ok,true);
for(const invalid of [()=>{const r=structuredClone(response);r.roots.r0.slots.s0.value.unknown_selector=true;return r;},()=>{const r=structuredClone(response);r.roots.r0.slots.s0.value.pick='all';return r;}])assert.throws(()=>parse(invalid(),targets));
// Finite strategies must preserve both substring and exact ID filters.
for(const [operation,kind,value] of [['discard','discard_strategy',{mode:'discard_all'}],['copy','card_copy_strategy',{mode:'copy_at_original_cost'}]]){
  const effects=operation==='discard'?{discard:1,draw:'discard_count',from:'hand',pick:'all',name_contains:'小刀',id:'knife'}
    :{copy:1,from:'discard',pick:'choose',name_contains:'小刀',id:'knife',card_rule:'free',target_rule:'self'};
  const input={narrative:'保持',player:{cards:[{...card,effects:[effects,{block:5}]}]},opening:{choices:[]}};
  const diagnostic=operation==='discard'?'battle.cards[0].effects[0].discard：This operation must remain a separate effect object':'battle.cards[0].effects[0].copy：该操作必须单独占一个 effects 数组项；battle.cards[0].effects[0].card_rule：该操作必须单独占一个 effects 数组项；battle.cards[0].effects[0].target_rule：规则字段不符合浅层 effects 契约';
  const slots=plan(input,diagnostic);assert.equal(slots.length,1);assert.ok(slots[0].slots.some(s=>s.kind===kind));
  const repaired={spec,roots:{r0:{slots:Object.fromEntries(slots[0].slots.map(s=>[s.token,{action:s.action,value:s.kind===kind?value:input.player.cards[0].description}]))}},support_statuses:[],support_resources:[]};
  const output=merge(input,slots,parse(repaired,slots)),first=output.player.cards[0].effects[0];
  assert.equal(first.name_contains,'小刀');assert.equal(first.id,'knife');assert.equal(compileCompactEffectList(output.player.cards[0].effects).ok,true);
  assert.deepEqual(output.player.cards[0].effects.at(-1),{block:5});
}
console.log('PASS opening repair accepts supported name/ID selectors, preserves filters through discard/copy strategies, locks sibling content and still rejects invalid effects.');
