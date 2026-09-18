import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {describeCompactEffectList}=require('../src/game-core/contentDescription.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const {effectProgramToDisplayTags}=require('../src/game-core/effectDisplay.ts');
for(const kind of ['last_card_type','discarded_card_type'])for(const [type,name] of Object.entries({Attack:'攻击牌',Skill:'技能牌',Power:'能力牌',Event:'事件牌',Curse:'诅咒牌'}))for(const quote of ["'",'"'])for(const prefix of ['', '!']){
  const effect={block:1,when:`${prefix}${kind}(${quote}${type}${quote})`},before=structuredClone(effect);
  const compiled=compileCompactEffectList(effect);assert.equal(compiled.ok,true);
  for(const text of [describeCompactEffectList(effect),effectProgramToDisplayTags(compiled.value).map(t=>t.text).join('；')]){
    assert.ok(text.includes(name));assert.ok(!text.includes(kind));assert.ok(!text.includes(type));
    assert.ok(text.includes(kind==='last_card_type'?'上一张打出的牌':'最近一次弃牌恰好弃掉一张手牌'));
    if(prefix)assert.ok(text.includes('不满足'));
  }
  assert.deepEqual(effect,before);
}
const compound=describeCompactEffectList({block:1,when:"discarded_card_type('Attack') && self.hp > 0"});
assert.match(compound,/攻击牌且自身生命高于0/);
console.log('PASS compact/AST card-type predicates: all public types, quotes, direct negation, compound conditions and no input mutation.');
