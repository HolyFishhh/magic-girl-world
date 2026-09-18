import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {formatCompactEffectAuthoringContract}=require(resolve('src/game-core/towerRequest.ts'));
const {initialDraftAuthoringPrompt,initialDraftRegistryRepairPrompt}=require(resolve('src/sillytavern-extension/initialDraftPrompt.ts'));
const {createInitialDraftJsonSchema}=require(resolve('src/game-core/initialDraftSchema.ts'));
const {createTowerInitialContentJsonSchema}=require(resolve('src/game-core/towerRequest.ts'));
const runtime=formatCompactEffectAuthoringContract();
assert.equal(runtime,formatCompactEffectAuthoringContract('runtime'));
const draft=formatCompactEffectAuthoringContract('initial-draft');
const placementPairs=[["正式卡牌与 creates 模板","正式卡牌与 registry.templates 模板"],["battle.player_lust_effect 与敌人 lust_effect","player.player_lust_effect"],["emoji/description/creates/when","emoji/description/when"],["临时牌模板放在使用它的卡牌、能力、遗物、行动、道具或状态定义自身同级 creates。只有同一内容的 effects/trigger/triggers 确实用 add_card/ensure_card/transform_card 引用了模板时才写 creates","临时牌模板只在 registry.templates 登记一次，由卡牌、能力、遗物、召唤行动、道具或状态的 effects/trigger/triggers 使用 add_card/ensure_card/transform_card 引用；各内容对象不输出 creates"],["复制成 creates 卡牌模板","复制成 registry.templates 卡牌模板"],["因为它没有自己的 creates 容器","因为临时牌不支持自我生成"],["add_card/ensure_card 只能引用同一内容对象自身 creates 中的模板","add_card/ensure_card 只能引用 registry.templates 中已完整登记的模板"],["同一 creates 中的模板ID","registry.templates 中的模板ID"],["[{id,name,effects,when?,creates?}]","[{id,name,effects,when?}]"],["{id,name,trigger:{on,effects},creates?}","{id,name,trigger:{on,effects}}"],["自定义资源先在 core.resources 注册为 {id,name,emoji,max,refresh,start?或current?}；初始草稿模式则统一登记在 registry.resources。","玩家自定义资源只在 registry.resources 注册为 {id,name,emoji,max,refresh,start?或current?}。"]];
placementPairs.push(['并在 本结果 statuses 登记完整同ID定义','并在 registry.statuses 登记完整同ID定义']);
placementPairs.push(['自定义资源先在 core.resources 注册为 {id,name,emoji,max,refresh,end_of_battle?,start?或current?}；初始草稿模式则统一登记在 registry.resources。','玩家自定义资源只在 registry.resources 注册为 {id,name,emoji,max,refresh,end_of_battle?,start?或current?}。']);
placementPairs.push(['在 同一结果 statuses 中登记该状态','在 registry.statuses 中登记该状态']);
const { summonAuthoringShape } = require(resolve('src/game-core/summonAuthoringFields.ts'));
placementPairs.push([summonAuthoringShape('runtime'), summonAuthoringShape('initial-draft')]);
let restoredRuntime=draft;
for(const [runtimeText,draftText] of placementPairs)restoredRuntime=restoredRuntime.replaceAll(draftText,runtimeText);
assert.equal(restoredRuntime,runtime,'every character outside the explicit placement projection is retained');
const before=runtime.split('\n'),after=draft.split('\n');
assert.equal(before.length,after.length,'no contract clauses omitted');
const changed=before.map((line,i)=>line===after[i]?null:[line,after[i]]).filter(Boolean);
assert.equal(changed.length,7,'only definition-placement paragraphs change, including temporary rule ownership');
for(const name of ['damage_summon','spawn_summon','summoner_effects','transform_card','add_card','ensure_card','threshold_execute','card_rule','when','schedule','spent_resource']){
 assert.equal((runtime.match(new RegExp(name,'g'))||[]).length,(draft.match(new RegExp(name,'g'))||[]).length,`operation and context preserved: ${name}`);
}
assert.ok(draft.includes('临时牌模板只在 registry.templates 登记一次'));
assert.ok(draft.includes('add_card/ensure_card 只能引用 registry.templates 中已完整登记的模板'));
assert.ok(draft.includes('玩家自定义资源只在 registry.resources 注册'));
for(const forbidden of ['模板放在使用它的卡牌','同一内容对象自身 creates 中','同一 creates 中的模板ID','effects,when?,creates?','trigger:{on,effects},creates?','只可选 emoji、description、creates、when','自定义资源先在 core.resources'])assert.ok(!draft.includes(forbidden),forbidden);
assert.ok(runtime.includes('同一内容对象自身 creates 中的模板'));
assert.ok(runtime.includes(summonAuthoringShape('runtime')));
const prompt=initialDraftAuthoringPrompt({startPrompt:'进入高塔',config:{},narrative:'已成立的剧情',currentStat:{},designGuidance:null});
assert.ok(prompt.includes(draft));assert.ok(!prompt.includes(runtime));
const repair=initialDraftRegistryRepairPrompt({slots:[],original:{}});
assert.ok(repair.includes(draft));assert.ok(!repair.includes(runtime));
assert.ok(prompt.includes('hp 在 0..max_hp'),'AI still authors story-dependent values');
assert.match(prompt, /完全相同的非唯一卡/, 'initial authoring explicitly reuses an identical card definition through quantity');
assert.match(prompt, /只差小幅数值或换名/, 'near-identical card ideas reuse the existing definition instead of forcing cosmetic variants');
assert.match(prompt, /card_ref/, 'an opening reward can reference the exact owned card definition');
for(const includeNarrative of [true,false]){
 const schema=createInitialDraftJsonSchema({includeNarrative}).value;
 const player=schema.properties.player.properties;
 assert.ok(player.player_abilities.description.includes('registry.templates'));
 assert.ok(player.player_lust_effect.description.includes('registry.statuses'));
 const walk=value=>{
  if(!value||typeof value!=='object')return;
  for(const [key,child]of Object.entries(value)){
   if(key==='description'&&typeof child==='string')assert.ok(!/creates|player.statuses|core.resources/.test(child),'draft schema descriptions do not advertise removed containers');
   else walk(child);
  }
 };walk(schema);
}
const canonicalPlayer=createTowerInitialContentJsonSchema().value.properties.player.properties;
assert.ok(canonicalPlayer.player_abilities.description.includes('能力 creates'));
assert.ok(canonicalPlayer.player_lust_effect.description.includes('同级 player.statuses'));
console.log('Initial draft and registry repair use registry-only placement; seven placement paragraphs differ, full operation contract retained; runtime callers unchanged.');
