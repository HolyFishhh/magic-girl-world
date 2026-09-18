import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {normalizeMvuPlayerAuthoredContent,normalizeMvuBattleContent,normalizeMvuAuthoredContent}=require('../src/runtime/mvuBattleContentNormalizer.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const {canonicalizePlayerPileSelfTargets}=require('../src/runtime/playerPileTargetNormalizer.ts');
const original={name:'已知玩家效果',effects:[{resource:{id:'radiance',amount:2},to:'self'},{draw:1,to:'self'}]};
const before=structuredClone(original);
const normalized=normalizeMvuPlayerAuthoredContent(original);
assert.deepEqual(normalized,{name:original.name,effects:[original.effects[0],{draw:1}]});
assert.deepEqual(original,before,'input is never mutated');
assert.deepEqual(normalizeMvuPlayerAuthoredContent(normalized),normalized,'idempotent canonical representation');
assert.deepEqual(normalizeMvuAuthoredContent(original),original,'unknown actor never loses to');
const cases = [
  {draw:2}, {scry:2}, {seek:1}, {discard:1,pick:'choose'}, {exhaust:'all',from:'hand'},
  {recover:1,from:'exhaust',pick:'choose'}, {reduce_cost:1,from:'hand',pick:'choose',count:1},
  {modify_card:'damage',add:2,from:'hand',pick:'choose',count:1},
  {patch_card:'retain',enabled:true,from:'hand',pick:'choose',count:1,scope:'combat'},
  {attach_card:{id:'test_attachment',kind:'affliction',name:'束缚',description:'费用增加1。',scope:'combat',
    changes:[{kind:'cost',operator:'add',value:1}]},from:'hand',pick:'choose',count:1},
  {upgrade_card:1,from:'hand',pick:'choose',scope:'permanent',levels:1,max_level:5,
    changes:[{kind:'numeric',stat:'damage',operator:'add',value:2}]},
  {double:1,pick:'choose'}, {draw:'self.hand_size + 1',when:'self.hp < self.max_hp'},
];
for (const effect of cases) {
  const baseline=compileCompactEffectList(effect);
  assert.equal(baseline.ok,true,JSON.stringify(baseline));
  const authored={name:'玩家牌区操作',effects:{...effect,to:'self'}};
  const result=normalizeMvuPlayerAuthoredContent(authored);
  assert.deepEqual(result.effects,effect,'only redundant receiver changes');
  assert.deepEqual(compileCompactEffectList(result.effects),baseline,'same complete executable program');
}
const redundant=()=>({draw:1,to:'self'});
const owner=()=>({name:'玩家所有者',effects:redundant(),discard_effects:redundant(),
  trigger:{on:'turn_start',effects:redundant()},events:[{on:'turn_end',effects:redundant()}],
  creates:[{id:'generated_card',name:'生成卡牌',effects:redundant()}]});
for(const key of ['cards','card','artifacts','artifact','items','item','player_abilities','player_lust_effect']) {
  const source={[key]:owner()}; const expected=structuredClone(source);
  const value=expected[key];value.effects={draw:1};value.discard_effects={draw:1};
  value.trigger.effects={draw:1};value.events[0].effects={draw:1};value.creates[0].effects={draw:1};
  const output=structuredClone(source);canonicalizePlayerPileSelfTargets(output);assert.deepEqual(output,expected,key);
}
const reward={opening:{choices:[{outcome:{reward:{cards:[{name:'赠卡',effects:redundant()}]}}}]}};
assert.deepEqual(normalizeMvuPlayerAuthoredContent(reward).opening.choices[0].outcome.reward.cards[0].effects,{draw:1});
const nested={name:'延迟选择',effects:{schedule:1,phase:'turn_start',effects:{choose:'draw_route',options:[
  {id:'one',label:'抽牌',effects:redundant()}, {id:'two',label:'格挡',effects:{block:2,to:'self'}},
]}}};
const expectedNested=structuredClone(nested);delete expectedNested.effects.effects.options[0].effects.to;
assert.deepEqual(normalizeMvuPlayerAuthoredContent(nested),expectedNested);
assert.deepEqual(compileCompactEffectList(expectedNested.effects),compileCompactEffectList(normalizeMvuPlayerAuthoredContent(nested).effects));
assert.equal(compileCompactEffectList(expectedNested.effects).ok,true);

// Exercise this narrowly scoped pass directly: the pre-existing generic
// normalizer has unrelated aliases which these assertions must not conflate.
const untouched = [
  {draw:1,to:'opponent'}, {draw:1,to:'player'}, {draw:1,to:'all'}, {draw:1,to:['self']},
  {draw:1,to:'self',targets:'all'}, {draw:1,to:'self',unexpected:1}, {draw:null,to:'self'},
  {draw:1,damage:2,to:'self'}, {copy:1,to:'hand'}, {add_card:'token',to:'discard'},
  {ensure_card:'token',to:'draw'}, {summoner_effects:redundant()},
  {schedule:1,to:'opponent',effects:redundant()},
  {choose:'route',to:'opponent',options:[{id:'a',label:'A',effects:redundant()}]},
  {unknown_wrapper:{effects:redundant()}},
];
for(const effect of untouched) {
  const source={name:'不可猜测',effects:effect};const result=structuredClone(source);
  canonicalizePlayerPileSelfTargets(result);assert.deepEqual(result,source);
}
const mixed={player:{cards:[owner()],player_lust_effect:owner()},
  registry:{statuses:[owner()],templates:[owner()]},enemy:{cards:[owner()],actions:[owner()]},
  enemies:[{actions:[owner()]}],summons:[owner()],statuses:[owner()],stances:[owner()],orbs:[owner()]};
const mixedBefore=structuredClone(mixed);const mixedResult=normalizeMvuPlayerAuthoredContent(mixed);
assert.deepEqual(mixedResult.player.cards[0].effects,{draw:1});
for(const key of ['registry','enemy','enemies','summons','statuses','stances','orbs']) {
  assert.deepEqual(mixedResult[key],normalizeMvuAuthoredContent(mixedBefore)[key],key+' is not a player ownership declaration');
}
assert.deepEqual(mixed,mixedBefore);
const battle={cards:[{id:'draw_card',name:'抽牌',quantity:1,effects:redundant()}],
  player_lust_effect:{name:'力量奔涌',effects:redundant()},enemy:{name:'敌人',effects:redundant()},statuses:[]};
const canonicalBattle=normalizeMvuBattleContent(battle);
assert.deepEqual(canonicalBattle.cards[0].effects,{draw:1});
assert.deepEqual(canonicalBattle.player_lust_effect.effects,{draw:1});
assert.deepEqual(canonicalBattle.enemy.effects,redundant());
assert.deepEqual(normalizeMvuBattleContent(canonicalBattle),canonicalBattle);
console.log('PASS 12 pile operations, exact player ownership, nested timing/choices, unchanged programs and inputs, fail-closed mixed scopes.');
