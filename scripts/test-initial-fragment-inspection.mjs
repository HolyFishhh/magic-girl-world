import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {compileInitialDraftToMvu,inspectInitialDraft,inspectInitialDraftFragments}=require('../src/game-core/initialDraft.ts');
const {assessInitialPlayerContent}=require('../src/game-core/playerContentReadiness.ts');
const {createContentPackFromMvuBattle}=require('../src/runtime/contentPackAdapter.ts');
const base={spec:'mwg.initial-draft/v1',narrative:'fixed story',player:{
 status:{time:'night',location:'library',profession:{name:'scribe',ability:'record'}},
 core:{emoji:'📘',hp:60,max_hp:60,lust:0,max_lust:100},
 cards:[{id:'start',name:'start',type:'Attack',rarity:'Common',cost:1,quantity:3,
 effects:[{damage:6,resource:{id:'charge',amount:1},when:'self.hp > 0'}]}],
},registry:{statuses:[],resources:[{id:'charge',name:'charge',emoji:'⚡',start:1,max:3,refresh:'retain'}],templates:[]},
opening:{title:'gift',narrative:'choose',choices:null}};
for(const opening of [base.opening,null,undefined]){
 const draft={...structuredClone(base),opening},before=structuredClone(draft);
 const compiled=compileInitialDraftToMvu(draft);assert.equal(compiled.ok,false);assert.equal('value' in compiled,false);
 const full=inspectInitialDraft(draft,()=>assert.fail('invalid envelope reached full preview'));assert.equal(full.inspected,false);
 const partial=inspectInitialDraftFragments(draft,view=>{
  assert.deepEqual(view.opening,opening,'no placeholder opening/choices');
  const core=view.player.core;
  const issues=assessInitialPlayerContent(createContentPackFromMvuBattle(view.player),{
   emoji:core.emoji,hp:core.hp,maxHp:core.max_hp,lust:core.lust,maxLust:core.max_lust}).issues;
  view.player.cards=[];return issues;
 });
 assert.equal(partial.inspected,true);assert.ok(partial.references.some(i=>i.code==='INVALID_DRAFT'));
 assert.ok(partial.rules.some(i=>i.code==='INVALID_EFFECT_BUNDLE'&&i.path.includes('cards[0].effects')));
 assert.deepEqual(draft,before,'consumer mutations never escape');
}
for(const field of ['player','registry']){
 const draft=structuredClone(base);draft[field]=null;let calls=0;
 inspectInitialDraftFragments(draft,view=>{calls++;assert.equal(view.player,null);return [];});
 assert.equal(calls,field==='player'?1:0,'unavailable registry does not pretend reference expansion succeeded');
}
assert.throws(()=>inspectInitialDraftFragments(base,()=>{throw Error('inspector failed');}),/inspector failed/);
console.log('PASS explicit partial diagnostics find independent rule defects under broken opening, preserve absent fragments and source, never expose full preview or successful compile, and propagate inspection errors.');
