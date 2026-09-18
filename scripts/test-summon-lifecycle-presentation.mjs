import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {presentCompactContent}=require('../src/game-core/contentPresentation.ts');
const {compactContentToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
// Representative of real sample30's repeated-summon slot, with no extra fields
// invented by presentation and no modifications to the generated save.
const base={id:'guardian',name:'守卫',emoji:'🛡️',max_hp:14,actions:[{id:'ram',name:'冲撞',effects:{damage:5}}],
 slot:'pet',on_existing:'reinforce',on_defeated:'revive_reset'};
const render=summon=>{
 const card={type:'Skill',cost:1,description:'恢复灯火',effects:{spawn_summon:summon}},before=structuredClone(card);
 const prose=presentCompactContent(card,'card');
 const compiled=compileCompactEffectList(card.effects);assert.equal(compiled.ok,true,JSON.stringify(compiled));
 const tags=compactContentToDisplayTags(card).map(t=>t.text).join('；');
 assert.deepEqual(card,before);assert.equal(prose.flavorText,'恢复灯火');return [prose.rulesText,tags];
};
for(const text of render(base)){
 assert.match(text,/同一召唤者.*唯一召唤物/);assert.match(text,/当前生命和生命上限各增加14/);
 assert.match(text,/复活.*14\/14/);
}
for(const text of render({...base,on_existing:undefined,on_defeated:undefined})){
 assert.match(text,/当前生命和生命上限各增加14/);assert.match(text,/倒下后再次召唤新单位/);
}
for(const text of render({...base,on_existing:'replace',on_defeated:'revive_reinforce'})){
 assert.match(text,/替换现有单位/);assert.match(text,/原生命上限增加14.*满生命复活/);
}
const noHp={...base,has_hp:false};delete noHp.max_hp;
for(const text of render(noHp)){
 assert.match(text,/重复召唤不改变现有无生命单位/);assert.doesNotMatch(text,/各增加|14\/14|满生命复活/);
}
const noSlot={...base};delete noSlot.slot;delete noSlot.on_existing;delete noSlot.on_defeated;
for(const text of render(noSlot))assert.doesNotMatch(text,/同槽位|各增加14|倒下后/);
console.log('PASS shared compact rules and effect tags expose same-owner slot reinforcement, replacement, revival and no-HP boundaries; authored input unchanged.');
