import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseFragment} from 'parse5';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {createBattleRewardMenuEntries,renderBattleRewardsMenu}=require('../src/common/battleRewardsMenu.ts');

class Element {
  children=[];events=new Map();dataset={};disabled=false;className='';tabIndex=0;
  constructor(tag='div',ownerDocument=null){this.tagName=tag.toLowerCase();this.ownerDocument=ownerDocument;}
  get classList(){return {toggle:(name,on)=>{const names=new Set(this.className.split(/\s+/).filter(Boolean));on?names.add(name):names.delete(name);this.className=[...names].join(' ');}};}
  set innerHTML(html){this.markup=html;this.children=parseFragment(html).childNodes.map(node=>this.from(node));}get innerHTML(){return this.markup||'';}
  from(node){const value=new Element(node.tagName||'#text',this.ownerDocument);value.parentElement=this;for(const attr of node.attrs||[]){if(attr.name==='class')value.className=attr.value;if(attr.name==='disabled')value.disabled=true;if(attr.name.startsWith('data-'))value.dataset[attr.name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase())]=attr.value;}value.children=(node.childNodes||[]).map(child=>value.from(child));return value;}
  append(node){node.parentElement=this;this.children.push(node);}setAttribute(){}addEventListener(type,callback){this.events.set(type,[...(this.events.get(type)||[]),callback]);}focus(){}
  matches(selector){if(selector==='button')return this.tagName==='button';if(selector.startsWith('.'))return this.className.split(/\s+/).includes(selector.slice(1));const data=selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);if(data){const value=this.dataset[data[1].replace(/-([a-z])/g,(_,char)=>char.toUpperCase())];return value!==undefined&&(data[2]===undefined||value===data[2]);}return false;}
  closest(selector){for(let value=this;value;value=value.parentElement)if(selector.split(',').some(part=>value.matches(part.trim())))return value;return null;}
  querySelectorAll(selector){const values=[];const walk=value=>value.children.forEach(child=>{if(selector.split(',').some(part=>child.matches(part.trim())))values.push(child);walk(child);});walk(this);return values;}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  dispatchClick(){for(let value=this;value;value=value.parentElement)for(const callback of value.events.get('click')||[])callback({target:this,currentTarget:value});}
}
const doc={createElement:tag=>new Element(tag,doc)};
const card=index=>({id:`card_${index}`,name:`卡${index}`,type:'Attack',rarity:'Common',cost:1,quantity:1,effects:{damage:index+1}});
const item=index=>({id:`item_${index}`,name:`道具${index}`,count:1,effects:{heal:index+1}});
const stat={battle:{core:{resources:[]},cards:[],artifacts:[],items:[],statuses:[]},reward:{card:[0,1,2,3].map(card),artifact:[],item:[0,1,2].map(item),limits:{cards:2,artifacts:0,items:2},card_choice_groups:[{id:'alpha',indices:[0,1,2,3],pick:2}]}};
const rows=createBattleRewardMenuEntries(stat);
assert.deepEqual(rows.map(row=>[row.kind,row.detail,row.pick]),[['cards','4选2',2],['items','3选2',2]],'each limited pool gets one X选Y entry');
const allCards={...stat,reward:{...stat.reward,card:[0,1].map(card),item:[],limits:{cards:2,artifacts:0,items:0},card_choice_groups:[{id:'all',indices:[0,1],pick:2}]}};
assert.deepEqual(createBattleRewardMenuEntries(allCards).map(row=>[row.kind,row.detail,row.pick]),[['cards','2选2',2]],'X等于Y still renders as one exact card-group choice');
const root=new Element('div',doc),claims=[];
renderBattleRewardsMenu({root,stat,enabled:true,renderCard:candidate=>candidate.name,renderSupport:candidate=>candidate.name,claim:async request=>{claims.push(request);}});
root.querySelectorAll('.battle-reward-category')[0].dispatchClick();
const cardOptions=root.querySelectorAll('.battle-reward-option'),confirm=root.querySelector('.reward-confirm');
assert.equal(confirm.disabled,true,'multi-pick waits for the exact selection count');
cardOptions[0].dispatchClick();cardOptions[2].dispatchClick();
assert.equal(confirm.disabled,false,'two distinct card choices enable confirmation');
cardOptions[0].dispatchClick();assert.equal(confirm.disabled,true,'deselecting returns the group to an incomplete state');
cardOptions[1].dispatchClick();confirm.dispatchClick();await Promise.resolve();
assert.deepEqual(claims,[{kind:'cards',indexes:[2,1],cardGroupId:'alpha'}],'one confirmation submits both card indexes in one claim');
console.log('PASS reward menus render one X选Y row and submit an exact multi-pick transaction.');

// Model completion updates run preparation after the player has opened any category.
for(const category of [0,1]) {
 const page=new Element('div',doc),claimed=[];
 const options={root:page,stat:structuredClone(stat),enabled:true,renderCard:c=>c.name,renderSupport:c=>c.name,claim:async r=>claimed.push(r)};
 renderBattleRewardsMenu(options);
 page.querySelectorAll('.battle-reward-category')[category].dispatchClick();
 const first=page.querySelectorAll('.battle-reward-option')[0];first.dispatchClick();
 const before=page.querySelector('.reward-confirm');
 for(const phase of ['queued','generating','ready'])renderBattleRewardsMenu({...options,stat:{...options.stat,battle:{...options.stat.battle,design_context:{phase},lineage_memory:{phase}},run:{nodeContent:{future:{phase}},stateRevision:5}}});
 assert.equal(page.querySelector('.reward-confirm'),before,'background generation retains the actual selection subtree');
 assert.ok(first.className.includes('is-selected'),'selection retained');
 page.querySelectorAll('.battle-reward-option')[1].dispatchClick();
 before.dispatchClick();await Promise.resolve();
 assert.equal(claimed.length,1);assert.deepEqual(claimed[0].indexes,[0,1]);
 const changed=structuredClone(options.stat);changed.reward.pool_revision='new-pool';
 renderBattleRewardsMenu({...options,stat:changed});
 assert.ok(page.querySelector('.battle-reward-category-list'),'actual pool change returns to updated rewards');
 assert.equal(page.querySelector('.reward-confirm'),null);
}
console.log('PASS background preparation preserves card/item pages and selections; changed pool invalidates.');
const artifactPage=new Element('div',doc);
const artifactStat=structuredClone(stat);
artifactStat.reward.artifact=[0,1].map(i=>({id:`relic_${i}`,name:`遗物${i}`,rarity:'Common',emoji:'◇',trigger:{on:'battle_start',effects:{block:2}}}));
artifactStat.reward.limits.artifacts=1;
const artifactOptions={root:artifactPage,stat:artifactStat,enabled:true,renderCard:c=>c.name,renderSupport:c=>c.name,claim:async()=>{}};
renderBattleRewardsMenu(artifactOptions);
artifactPage.querySelectorAll('.battle-reward-category')[1].dispatchClick();
artifactPage.querySelector('.battle-reward-option').dispatchClick();
const artifactConfirm=artifactPage.querySelector('.reward-confirm');
assert.equal(artifactConfirm.disabled,false);
renderBattleRewardsMenu({...artifactOptions,stat:{...artifactStat,battle:{...artifactStat.battle,design_context:{updated:true}}}});
assert.equal(artifactPage.querySelector('.reward-confirm'),artifactConfirm);
renderBattleRewardsMenu({...artifactOptions,enabled:false});
assert.ok(artifactPage.querySelectorAll('.battle-reward-category').every(b=>b.disabled),'historical/disabled view never reuses active callbacks');
console.log('PASS artifact selection survives metadata refresh; permission changes invalidate controls.');
