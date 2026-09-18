import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseFragment} from 'parse5';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {renderBattleRewardsMenu}=require('../src/common/battleRewardsMenu.ts');
class Element {
  children=[];events={};dataset={};disabled=false;className='';
  constructor(tag='div'){this.tagName=tag;this.ownerDocument=doc;}
  set innerHTML(html){this.markup=html;const convert=node=>{const result=new Element(node.tagName||'text');for(const attr of node.attrs||[])if(attr.name==='class')result.className=attr.value;result.children=(node.childNodes||[]).map(convert);return result;};this.children=parseFragment(html).childNodes.map(convert);}
  get innerHTML(){return this.markup||'';}
  append(node){this.children.push(node);}
  addEventListener(event,callback){this.events[event]=callback;}
  setAttribute(){}
  querySelectorAll(selector){const matches=node=>selector==='button'?node.tagName==='button':selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):false;const walk=node=>node.children.flatMap(child=>[...(matches(child)?[child]:[]),...walk(child)]);return walk(this);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
const doc={createElement:tag=>new Element(tag)};
const root=new Element();let resolveClaim;const claims=[];
renderBattleRewardsMenu({root,stat:{reward:{gold:18,gold_claimed:false,card:[],artifact:[],item:[],limits:{cards:0,artifacts:0,items:0}}},enabled:true,renderCard:()=>'',renderSupport:()=>'',claim:request=>{claims.push(request);return new Promise(resolve=>{resolveClaim=resolve;});}});
const gold=root.querySelector('.battle-reward-category');
gold.events.click();gold.events.click();
assert.deepEqual(claims,[{kind:'gold'}],'gold click directly claims once even before persistence completes');
assert.equal(root.querySelector('.reward-confirm'),null,'no second confirmation page');
assert.equal(gold.disabled,true,'claim locks the menu until persistence completes');
resolveClaim();await Promise.resolve();await Promise.resolve();
assert.equal(gold.disabled,false,'a settled request releases the old controls');
console.log('PASS direct gold claim and in-flight double-click protection.');
