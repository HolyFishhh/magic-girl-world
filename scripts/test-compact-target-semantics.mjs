import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const {describeCompactEffectList,describeCompactStatus}=require('../src/game-core/contentDescription.ts');
const {formatCompactEffectAuthoringContract}=require('../src/game-core/towerRequest.ts');
const samples=[
  [{damage:3},'opponent'],[{lust:3},'opponent'],[{execute:3},'opponent'],[{kill:true},'opponent'],
  [{apply_status:'test_buff',stacks:2},'opponent'],[{remove_status:'debuffs'},'opponent'],
  [{heal:3},'self'],[{block:3},'self'],[{energy:3},'self'],[{resource:{id:'charge',amount:2}},'self'],
  [{set_resource:{id:'charge',value:2}},'self'],[{set_hp:3},'self'],[{set_lust:3},'self'],
  [{set_energy:3},'self'],[{set_block:3},'self'],[{stance:{id:'calm',name:'静心'}},'self'],
  [{channel_orb:{id:'spark',name:'火花',value:1,passive:{block:1}}},'self'],[{evoke_orb:1},'self'],
  [{orb_slots:2},'self'],[{modify_orb:'value',add:1},'self'],[{extra_turn:1},'self'],[{end_turn:true},'self'],
  [{spawn_summon:{id:'guard',name:'护卫',emoji:'◇',max_hp:8,actions:[{id:'wait',name:'等待',effects:{block:1}}]}},'self'],
  [{card_rule:'retain_hand'},'self'],[{modify:'damage',add:1},'self'],
];
for(const [effect,expected] of samples){
  const original=structuredClone(effect);
  for(const implicitTarget of [undefined,'self','opponent']) for(const to of [undefined,'self','opponent']) {
    const input={...effect,...(to?{to}:{})};
    const compiled=compileCompactEffectList(input,{implicitTarget});
    assert.equal(compiled.ok,true,JSON.stringify({input,issues:compiled.issues}));
    assert.equal(compiled.value.steps[0].target,to??implicitTarget??expected,JSON.stringify(input));
  }
  assert.deepEqual(effect,original);
}
// Choosing an enemy collection takes precedence over ordinary implicit defaults.
for(const enemyCollectionTarget of ['self','opponent']) {
  const compiled=compileCompactEffectList({apply_status:'test_buff',targets:{mode:'all'}}, {implicitTarget:'self',enemyCollectionTarget});
  assert.equal(compiled.ok,true,JSON.stringify(compiled.issues));
  assert.equal(compiled.value.steps[0].target,enemyCollectionTarget);
}
const options={statusNames:{test_buff:'测试增益'}};
assert.match(describeCompactEffectList({apply_status:'test_buff'},undefined,options),/敌方/,'a buff name never changes a root target');
assert.match(describeCompactEffectList({apply_status:'test_buff',to:'self'},undefined,options),/自身/);
const status={id:'holder_mark',name:'持有标记',type:'buff',triggers:{tick:{damage:3},apply:{apply_status:'test_buff'},remove:{remove_status:'debuffs'}}};
const text=describeCompactStatus(status,options);
assert.doesNotMatch(text,/敌方/,'status default effects target their exact holder, not their opponent');
assert.match(text,/自身造成3点伤害/);
assert.match(describeCompactStatus({...status,triggers:{tick:{damage:3,to:'opponent'}}},options),/敌方造成3点伤害/);
assert.match(describeCompactStatus({...status,triggers:{tick:{damage:3,targets:{mode:'all'}}}},options),/敌方造成3点伤害/,
  'enemy collection precedence is preserved even inside a holder-bound status');
assert.match(describeCompactStatus({...status,triggers:{tick:{damage:3,targets:{mode:'all'}}}},
  {...options,enemyCollectionTarget:'self'}),/自身造成3点伤害/);
const prompt=formatCompactEffectAuthoringContract();
assert.match(prompt,/damage\/lust\/execute\/kill\/apply_status\/remove_status 默认 opponent/);
assert.match(prompt,/Power 也不会因此默认对自己施加状态/);
assert.match(prompt,/状态定义内部的 triggers 则以精确持有者为 self/);
console.log('PASS 25 entity operations: explicit/implicit/default targets, enemy collections, root buff target, status-holder rules and prompt agreement.');
