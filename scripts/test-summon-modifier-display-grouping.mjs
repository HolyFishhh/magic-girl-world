import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {describeCompactCardRuleGroups}=require('../src/game-core/contentDescription.ts');
const {compactContentToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const selector={owner:'self',pick:'left',template_id:'doll'};
const change=(stat,add,selection=selector)=>({modify_summon:{selector:selection,stat,add}});
const options={summonNames:{doll:'心象人偶'}};
const card={effects:[change('max_hp',6),change('block',4)]};
const before=JSON.stringify(card);
for(const render of [value=>describeCompactCardRuleGroups(value,options),value=>compactContentToDisplayTags(value,options).map(tag=>tag.text)]){
  const grouped=render(card);
  assert.equal(grouped.length,1,'same deterministic summon gets one combined rule');
  assert.match(grouped[0],/最大生命增加6、格挡增加4/);
  assert.equal((grouped[0].match(/心象人偶/g)||[]).length,1,'target is stated once');
  for(const pick of ['random','lowest_hp','highest_hp','choose']){
    const selection={...selector,pick};
    const separate=render({effects:[change('max_hp',6,selection),change('block',4,selection)]});
    assert.equal(separate.length,2,`${pick} resolves independently for each operation`);
  }
  assert.equal(render({effects:[change('block',4,{...selector,pick:'random'}),change('block',4,{...selector,pick:'random'})]}).length,2,'identical random effects remain two selections');
  assert.equal(render({effects:[change('max_hp',6),change('block',4,{...selector,pick:'right'})]}).length,2,'different targets do not merge');
  assert.equal(render({effects:[change('max_hp',6),{draw:1},change('block',4)]}).length,3,'intervening effects preserve execution boundaries');
  assert.equal(render({effects:[{modify_summon:{selector,stat:'max_hp',subtract:6}},change('block',4)]}).length,2,'a reduction may change the surviving target');
}
assert.equal(JSON.stringify(card),before,'display never mutates executable structure');
assert.deepEqual(JSON.parse(before),card,'serialization retains separate executable operations');
console.log('PASS summon display grouping: stable targets, independent random selections, boundaries and unchanged executable effects.');
