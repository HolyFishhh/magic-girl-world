import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseFragment } from 'parse5';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const { renderCardFace } = require('../src/shared/cardFace.ts');
const { renderSupportDetails } = require('../src/shared/supportPresentation.ts');
const source = readFileSync('src/common/index.ts','utf8');
const names = ['escapeHtml','towerRarity','renderCollectionCard','renderCollectionSupport','contentRuleDescription','contentRulesHtml','renderRewardOptionList','renderChoiceModule'];
const functions = names.map(name => {
  const found = source.match(new RegExp('function '+name+'\\([\\s\\S]*?(?=\\n(?:async )?function |\\n/\\*\\*)'));
  assert.ok(found, name);
  return found[0];
}).join('\n');
const core = require('../src/game-core/contentDescription.ts');
const cards = [{id:'test',name:'测试卡',emoji:'🃏',type:'Attack',rarity:'Rare',cost:{energy:1,ink:2},quantity:1,
  effects:{damage:7},description:'<img src=x onerror=alert(1)>',retain:true}];
const relics = [{id:'r',name:'测试遗物',emoji:'📿',effects:{block:3},description:'遗物故事'}];
const items = [{id:'i',name:'测试道具',emoji:'🧪',effects:{heal:4},description:'道具故事',count:2}];
class FakeElement {
  constructor(tagName='div') {
    this.tagName=tagName; this.dataset={}; this.style={}; this.children=[]; this.className=''; this.attrs={}; this.rawHtml=null; this.textContent='';
    const names=()=>new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList={
      add:(...values)=>{const next=names();values.forEach(value=>next.add(value));this.className=[...next].join(' ');},
      remove:(...values)=>{const next=names();values.forEach(value=>next.delete(value));this.className=[...next].join(' ');},
      toggle:(value,force)=>{const next=names(),enabled=force??!next.has(value);enabled?next.add(value):next.delete(value);this.className=[...next].join(' ');return enabled;},
    };
  }
  append(...children) { this.rawHtml=null; this.children.push(...children); }
  replaceChildren(...children) { this.rawHtml=null; this.children=[...children]; }
  setAttribute(name,value) { this.attrs[name]=String(value); }
  querySelector(selector) {
    const matches=node=>selector.startsWith('.') ? node.className.split(/\s+/).includes(selector.slice(1)) : node.tagName===selector;
    const visit=node=>{for(const child of node.children){if(matches(child))return child;const found=visit(child);if(found)return found;}return null;};
    return visit(this);
  }
  set innerHTML(value) { this.rawHtml=String(value); this.children=[]; }
  get innerHTML() { return this.rawHtml ?? this.children.map(child=>child.toHtml()).join(''); }
  toHtml() {
    const attrs={...this.attrs};
    if(this.className) attrs.class=this.className;
    if(this.type) attrs.type=this.type;
    if(this.value!==undefined) attrs.value=this.value;
    if(this.disabled) attrs.disabled='';
    if(this.open) attrs.open='';
    const attributeText=Object.entries(attrs).map(([key,value])=>` ${key}="${String(value)}"`).join('');
    if(this.tagName==='input') return `<input${attributeText}>`;
    return `<${this.tagName}${attributeText}>${this.textContent||''}${this.innerHTML}</${this.tagName}>`;
  }
}
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id,new FakeElement());
  return elements.get(id);
};
let bound = false;
const context = {
  rewardPreviewLabel: require('../src/shared/rewardSelectionInteraction.ts').rewardPreviewLabel,
  presentCompactContent: require('../src/game-core/contentPresentation.ts').presentCompactContent,
  renderRulePills: require('../src/shared/rulePills.ts').renderRulePills,
  collectCardDisplayNames: require('../src/game-core/cardDisplayNames.ts').collectCardDisplayNames,
  collectSummonDisplayNames: require('../src/game-core/summonDisplayNames.ts').collectSummonDisplayNames,
  renderStatusReferences: require('../src/shared/statusReference.ts').renderStatusReferences,
  describeCompactStatus: core.describeCompactStatus,
  __STAT__:{},readRewardRoot:()=>({card:cards,artifact:relics,item:items}),
  getRewardLimits:()=>({cards:1,artifacts:1,items:1}),
  inspectRewardCandidates:()=>({cards:[{ok:true}],artifacts:[{ok:true}],items:[{ok:true}]}),
  normalizeOptionsList:value=>value, document:{getElementById:element,createElement:tag=>new FakeElement(tag)},readRunState:()=>null,
  currentTowerScreen:()=> 'room',hasSelectableRewards:()=>false,
  setupChoiceEvents:()=>{bound=true;},renderCardFace,renderSupportDetails,
  CARD_RARITY_LABELS:{Rare:'稀有'},translateCardType:()=> '攻击',contentCardCostLabel:()=> '1能量 + 2墨水',
  contentDescriptionEnemyNames:()=>({}),collectStanceDefinitions:()=>({}),contentDescriptionStatusNames:()=>({}),contentDescriptionStatusDefinitions:()=>({}),
  contentDescriptionResourceNames:()=>({}),collectStanceNames:()=>({}),
  describeCompactCard:core.describeCompactCard,describeCompactContent:core.describeCompactContent,
  compactContentEffectTagsHtml:()=>'',contentDescriptionResourceDefinitions:()=>({}),
  describeCardCost:()=>'',battleItemUsageHtml:()=>'<p>每回合使用限制</p>',
  createRewardSelectionOption: (document, options) => {
    const option=document.createElement('article'); option.className=`option reward-selection-option${options.className?` ${options.className}`:''}`;
    const pick=document.createElement('label'); pick.className='reward-pick';
    const input=document.createElement('input'); input.type='checkbox'; input.value=options.value; input.disabled=Boolean(options.disabled);
    const label=document.createElement('span'); label.textContent=options.label; pick.append(input,label);
    const details=document.createElement('details'); details.className='reward-preview';
    const summary=document.createElement('summary'); summary.textContent=options.previewLabel??'查看奖励详情';
    const preview=document.createElement('div'); details.append(summary,preview); option.append(pick,details);
    return {option,input,preview,details};
  },
};
const before = JSON.stringify([cards,relics,items]);
runInNewContext(ts.transpileModule(functions+'\nrenderChoiceModule();',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
assert.ok(bound, 'reward selection handlers remain bound');
assert.equal(element('choice-container').style.display,'flex');
const card = element('card-options').innerHTML, relic = element('artifact-options').innerHTML, item = element('item-options').innerHTML;
assert.match(card,/enhanced-card/); assert.match(card,/7点伤害/); assert.match(card,/保留/);
assert.match(card,/1能量 \+ 2墨水/); assert.match(card,/&lt;img/); assert.doesNotMatch(card,/<img/);
assert.ok(element('card-options').className.includes('mwg-card-choice-list'), 'classic card choices use the shared responsive layout');
assert.match(card,/mwg-card-choice/);
assert.match(card,/<details class="reward-preview" open="">/, 'classic card rewards show the complete face by default');
assert.match(card,/<summary hidden="">/, 'the redundant collapsed-preview trigger is hidden for card choices');
assert.match(relic,/support-details-effects/); assert.match(relic,/3点格挡/); assert.match(relic,/遗物故事/);
assert.match(item,/support-details-effects/); assert.match(item,/4点生命/); assert.match(item,/道具故事/);
for(const html of [card,relic,item]){
  assert.doesNotMatch(html,/规则：|叙述：/);
  const root=parseFragment(html), all=[];
  const walk=node=>{all.push(node);node.childNodes?.forEach(walk);};walk(root);
  assert.equal(all.filter(node=>node.nodeName==='input').length,1);
  assert.equal(all.filter(node=>node.nodeName==='label').length,1);
}
assert.equal(JSON.stringify([cards,relics,items]),before,'presentation does not mutate rewards');
for (const file of ['src/fish/ui/battleUI.ts','src/common/index.ts']) assert.match(readFileSync(file,'utf8'),/renderCardFace/);
for (const file of ['src/fish/ui/battleUI.ts','src/fish/ui/battleShellPresenter.ts','src/common/index.ts']) assert.match(readFileSync(file,'utf8'),/renderSupportDetails/);
console.log('Actual reward renderer preserves complete rules, shared faces/details, escaped flavor, selection inputs and immutable content.');

if(process.env.MWG_PRESENTATION_HTML){const fs=require('node:fs');fs.writeFileSync(process.env.MWG_PRESENTATION_HTML,'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="ui-v466/common.css"><div id="choice-card"><div class="pane"><div class="options mwg-card-choice-list">'+card.repeat(3)+'</div></div></div>');}
