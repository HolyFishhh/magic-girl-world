import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {formatCompactEffectRepairContract}=require('../src/game-core/towerRequest.ts');
const probes=[
  ['effects[0]: Unknown field: to_modify', '不把副本改为原费用'],
  ['Only Power templates can register a trigger', '不删除触发收益'],
  ['when: Unsupported boolean CEL node: Identifier battle_won', '不删除对应收益'],
  ['unsupported trigger: resource_changed', '不能改为 turn_start/turn_end/card_played'],
  ['UNKNOWN_STATUS: apply_status', '不删除对应 apply_status/remove_status'],
  ['effects: EMPTY_EFFECTS', '可选是指允许不创作'],
  ['opening.choices[0].outcome: 开局馈赠不支持字段: max_energy', '不能删除“增加能量上限”的承诺'],
  ['opening.choices[0].outcome.resource: 开局馈赠不支持字段: resource', '即时到账不能擅自换成未来收益'],
  ['unsupported trigger: summon_acted', '不能把原机制改成 turn_start/turn_end/card_played'],
  ['effects.scope: Unknown field: scope', '不得为通过校验将 Power 改成 Skill、删除持续触发或改成即时强化'],
  ['状态定义不合法: actions_per_activation', '不得用一次性强化替代持续规则、删除原状态施加或修改说明掩盖寿命差异'],
  ['INVALID_MODIFIER_FORMULA: Modifier formulas may only use numbers and status stacks', '不能用常数替代依赖层数的原机制'],
];
const forbidden=[
  '并把同一根 description 改成副本保留原费用',
  '无法由卡牌公开时机表达的承诺从 description 删除',
  '删除包含该 when 的整个附加 effects 项',
  '改用现有且最接近原设计的可执行触发时机',
  '就删除对应 apply_status/remove_status 效果项',
  '移除失去用途的 apply_summon_status 与状态定义',
];
for(const [error,required] of probes){
  const prompt=formatCompactEffectRepairContract(new Error(error));
  assert.ok(prompt.includes(required),`${error}: missing semantic boundary`);
  assert.ok(prompt.includes('保留失败'),`${error}: must not claim a downgraded success`);
  for(const phrase of forbidden)assert.ok(!prompt.includes(phrase),`${error}: contradictory downgrade instruction`);
}
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const {validateCompactStatusDefinition}=require('../src/game-core/index.ts');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/initial-draft-paper-discard.json',import.meta.url),'utf8'));
const compiled=compileInitialDraftToMvu({...fixture,narrative:'离线测试正文'});
assert.equal(compiled.ok,true,'referenced status template fixture must compile');
const status=structuredClone(compiled.value.player.statuses[0]);
assert.ok(status.creates?.length,'fixture owns templates');
assert.ok(JSON.stringify(status.triggers).includes(status.creates[0].id),'fixture references owned template');
status.type='invalid-type';
assert.equal(validateCompactStatusDefinition(status).ok,false,'unrelated status defect remains invalid');
const snapshot=structuredClone(status);
const statusPrompt=formatCompactEffectRepairContract(new Error('状态定义不合法: type'));
assert.match(statusPrompt,/根对象只用 [^；]*\/creates；/,'complete status field list must allow creates');
assert.ok(statusPrompt.includes('保留合法 creates 模板及其触发器引用'));
assert.deepEqual(status,snapshot,'guidance does not mutate source');
const repaired=structuredClone(status);
repaired.type=compiled.value.player.statuses[0].type;
assert.equal(validateCompactStatusDefinition(repaired).ok,true,'scoped type repair preserves executable templates');
delete repaired.creates;
assert.equal(validateCompactStatusDefinition(repaired).ok,false,'dropping referenced templates is not a valid repair');
console.log(`PASS ${probes.length} repair branch semantic-policy probes and referenced status-template preservation. No assertion of model compliance.`);
