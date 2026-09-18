import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {describeCompactCard}=require('../src/game-core/contentDescription.ts');
const {compactContentToDisplayTags,effectProgramToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const render=effects=>describeCompactCard({type:'Skill',effects});
assert.match(render({block:'(self.energy + 2) * 3'}),/（自身能量 \+ 2） × 3/,'parentheses preserve multiplication of a sum');
assert.match(render({block:'self.energy - (self.block - 2)'}),/自身能量 - （自身格挡 - 2）/,'subtraction grouping is not reassociated');
assert.match(render({block:'(self.energy + 2) / 2'}),/（自身能量 \+ 2）的一半/);
assert.equal(render({block:'min(9, opponent.lust)'}),render({block:'min(opponent.lust, 9)'}),'cap order does not change wording');
assert.match(render({block:'max(self.energy, self.block, 3)'}),/自身能量.*自身格挡.*3.*较大值/,'no argument disappears');
assert.match(render({block:'unhandled(self.energy) + 3'}),/unhandled\(自身能量\) \+ 3/,'unknown display functions preserve the complete fallback');
assert.match(render({block:3,when:'!!self.has_summon'}),/当自身存在召唤物时/);
for(const formula of ['min(9, opponent.lust)','min(opponent.lust, 9)'])
  assert.match(compactContentToDisplayTags({effects:{block:formula}}).map(tag=>tag.text).join(''),/等同于敌方欲望的格挡，最多9点/);
const branch=(extra={})=>({spec:'mwg.effect/v1',steps:[{op:'if',condition:{op:'compare',relation:'gte',left:{op:'var',path:'opponent.lust'},right:8},then:[{op:'damage',target:'opponent',amount:11,...extra}],else:[{op:'damage',target:'opponent',amount:7,...extra}]}]});
for(const [extra,pattern] of [[{bypassBlock:true},/无视格挡/],[{lifesteal:0.5},/吸血|回复|恢复/],[{damageKind:'hp_loss'},/生命/]]){
  const program=branch(extra),before=JSON.stringify(program);
  assert.match(effectProgramToDisplayTags(program).map(tag=>tag.text).join(''),pattern,'conditional simplification preserves damage semantics');
  assert.equal(JSON.stringify(program),before,'display cannot rewrite execution');
}
console.log('PASS formula display precedence, cap order, full arguments, negation and conditional damage qualifiers.');

const linked = branch();
linked.steps[0].then = [{op:'add_card',count:1,zone:'hand',card:{id:'piece',name:'碎片',type:'Skill',cost:0,effectProgram:{spec:'mwg.effect/v1',steps:[{op:'gain_block',target:'self',amount:2}]}}}];
assert.equal(effectProgramToDisplayTags(linked)[0].references[0].name,'碎片','conditional child cards retain inspectable references');
