import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets:plan,parseTowerInitialSlotRepairResponse:parse}=require('../src/sillytavern-extension/controller.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const status={id:'wind_reading',name:'听风',emoji:'🌬️',type:'buff',description:'每回合第一张攻击牌造成伤害时，获得1点风压。',
 triggers:{attack_played:{scope:'turn',ordinal:'first',effects:{resource:{id:'pressure',amount:1}}}}};
const source={player:{statuses:[status]}};
const error='battle.statuses[0]：状态定义不合法（具体原因：triggers.attack_played.ordinal: 不支持的效果操作 ordinal）';
const targets=plan(source,error);
assert.deepEqual(targets,[],'generic effect-only slots cannot safely migrate a structured event filter');
for(const [key,value]of Object.entries({on:'attack_played',scope:'turn',ordinal:'first',n:2,event:'card_played',phase:'after',
 reason:'play',source_kind:'card',source_id:'a',damage_type:'attack',card_type:'Attack',template_id:'a',card_instance_id:'a',actor_id:'player',target_id:'enemy'})) {
 const variant=structuredClone(source);
 variant.player.statuses[0].triggers.attack_played={effects:{block:1},[key]:value};
 assert.deepEqual(plan(variant,`battle.statuses[0]：状态定义不合法（具体原因：triggers.attack_played.${key}: invalid placement）`),[],key);
 variant.player.statuses[0].triggers.attack_played={resource:{id:'pressure',amount:1},[key]:value};
 // Valid effect metadata is not an invalid listener envelope.
 if (!compileCompactEffectList(variant.player.statuses[0].triggers.attack_played).ok) {
  assert.deepEqual(plan(variant,`battle.statuses[0]：状态定义不合法（具体原因：triggers.attack_played.${key}: invalid placement）`),[],`direct ${key}`);
 }
}
// A stale or manually constructed plan must not bypass the receiver guard.
const stale=[{token:'r0',kind:'player_status',path:'player.statuses[0]',slots:[{
 token:'s0',kind:'status_trigger_effect_sequence',action:'replace_effect_sequence',
 path:'player.statuses[0].triggers.attack_played',relativePath:'triggers.attack_played',original:status.triggers.attack_played,
}]}];
const reply={spec:'mwg.tower-initial-slot-repair/v1',roots:{r0:{slots:{s0:{action:'replace_effect_sequence',value:[{resource:{id:'pressure',amount:1},to:'self'}]}}}},support_statuses:[],support_resources:[]};
assert.throws(()=>parse(reply,stale),/事件筛选语义/,'same payoff without first restriction is not a repair');
// Filters may be siblings of a shallow operation, without an effects wrapper.
const direct=structuredClone(source);
direct.player.statuses[0].triggers.attack_played={scope:'turn',ordinal:'first',resource:{id:'pressure',amount:1}};
assert.deepEqual(plan(direct,error),[],'direct shallow payoff must retain event restrictions');
const directStale=structuredClone(stale);
directStale[0].slots[0].original=direct.player.statuses[0].triggers.attack_played;
assert.throws(()=>parse(reply,directStale),/事件筛选语义/,'stale direct-effect plan cannot erase filters');
for(const description of ['', '每次攻击都获得资源。']) {
 const changed=structuredClone(source);changed.player.statuses[0].description=description;
 assert.deepEqual(plan(changed,error),[],'cannot evade by deleting or rewriting prose');
}
const plain=structuredClone(source);plain.player.statuses[0].triggers.attack_played={draw:'bad'};
assert.ok(plan(plain,'battle.statuses[0]：状态定义不合法（具体原因：triggers.attack_played.draw: invalid value）').length,
 'ordinary malformed effects still have their existing repair path');
console.log('PASS rejected structured status filter cannot become an unrestricted effect via generic repair; prose does not control the guard.');
