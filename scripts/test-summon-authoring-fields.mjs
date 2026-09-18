import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const fields=require('../src/game-core/summonAuthoringFields.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const {withAiContentDefinitions}=require('../src/game-core/aiContentJsonSchema.ts');
const schema=JSON.parse(readFileSync('schemas/mwg-card-effects-v1.schema.json','utf8')).$defs.spawnSummonEffect.properties.spawn_summon;
assert.deepEqual([...fields.SUMMON_AUTHORING_FIELDS].sort(),Object.keys(schema.properties).filter(k=>k!=='action').sort());
assert.deepEqual([...fields.SUMMON_ACTION_AUTHORING_FIELDS].sort(),Object.keys(schema.properties.actions.items.properties).sort());
assert.deepEqual([...fields.SUMMON_ABILITY_AUTHORING_FIELDS].sort(),Object.keys(schema.properties.abilities.items.properties).filter(k=>k!=='effects').sort());
const validate=new Ajv2020({strict:false,allErrors:true}).compile(withAiContentDefinitions({$ref:'#/$defs/mwgCardEffectList'}));
const summon={id:'probe',name:'探针',emoji:'◈',max_hp:5,
  actions:[{id:'strike',name:'攻击',effects:{damage:2},fixed:true,weight:2}],
  abilities:[{id:'start',name:'守护',trigger:{on:'turn_start',effects:{block:1}},fixed:true}],
  description:'用于验证字段',block:0,tags:['construct'],actions_per_activation:1,
  action_priority:0,speed:0,retain_corpse:true,capabilities:{selectable:true,accepts_status:true,acts:true,intercepts:false},
};
const before=structuredClone(summon);
assert.ok(validate({spawn_summon:summon}),JSON.stringify(validate.errors));
assert.equal(compileCompactEffectList({spawn_summon:summon}).ok,true);
assert.deepEqual(summon,before);
for(const extra of [{hp:5},{power:2},{trigger:{on:'turn_start',effects:{damage:1}}},{capabilities:{acts:'yes'}},{tags:['bad tag']},{actions_per_activation:21}]) {
  const value={spawn_summon:{...summon,...extra}};
  assert.equal(validate(value),false,JSON.stringify(extra));
  assert.equal(compileCompactEffectList(value).ok,false,JSON.stringify(extra));
}
assert.ok(fields.summonAuthoringShape('runtime').includes('creates?'));
assert.ok(!fields.summonAuthoringShape('initial-draft').includes('creates'));
const {SUMMON_EFFECT_REWRITE_LIFETIME}=require('../src/game-core/summonLifecycleDescription.ts');
const {describeCompactEffectList}=require('../src/game-core/contentDescription.ts');
const {effectProgramToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const {formatCompactEffectProtocol}=require('../src/game-core/authoredEffectProtocol.ts');
const rewrite={modify_summon_effect:{selector:{owner:'self',pick:'all'},stat:'damage',add:3}};
const originalRewrite=structuredClone(rewrite);
const rewritten=compileCompactEffectList(rewrite);assert.equal(rewritten.ok,true);
assert.ok(describeCompactEffectList(rewrite).includes(SUMMON_EFFECT_REWRITE_LIFETIME));
assert.ok(JSON.stringify(effectProgramToDisplayTags(rewritten.value)).includes(SUMMON_EFFECT_REWRITE_LIFETIME));
for(const placement of ['runtime','initial-draft'])assert.ok(formatCompactEffectProtocol(placement).includes(SUMMON_EFFECT_REWRITE_LIFETIME));
assert.deepEqual(rewrite,originalRewrite,'presentation never repairs authored mechanics');
const worldbook=readFileSync('worldbook_new/2战斗内容生成要求.md','utf8');
assert.ok(worldbook.includes(SUMMON_EFFECT_REWRITE_LIFETIME),'worldbook and generated contract share actual lifetime semantics');
for(const key of fields.SUMMON_AUTHORING_FIELDS)assert.ok(worldbook.includes(key),`worldbook lacks ${key}`);
console.log('PASS shared summon field vocabulary matches schema; real parser/schema accept authored fixed/actions/abilities/capabilities and reject malformed extensions. Not gameplay acceptance.');
