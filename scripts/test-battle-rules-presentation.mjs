import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseFragment } from 'parse5';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const core=require('../src/game-core/index.ts');
const adapter=require('../src/fish/core/battleContentAdapter.ts');
const { BattleUI }=require('../src/fish/ui/battleUI.ts');
const { PileViewer }=require('../src/fish/ui/pileViewer.ts');
const { TavernCardInteractionPresenter }=require('../src/fish/ui/cardInteractionPresenter.ts');

const byClass=(html,className)=>{
  const texts=[];
  const text=node=>node.nodeName==='#text'?node.value:(node.childNodes||[]).map(text).join('');
  const walk=node=>{
    if(node.attrs?.some(a=>a.name==='class'&&a.value.split(/\s+/).includes(className)))texts.push(text(node));
    node.childNodes?.forEach(walk);
  };
  walk(parseFragment(html)); return texts.join('\n');
};
// Capture the actual view's HTML with a minimal, non-browser jQuery shell.
// Rule formatting and card patching remain the real production implementations.
let tooltipHtml='';
const shell=html=>{
  const chain={length:0,get:()=>undefined,append(value){if(value?.html)tooltipHtml=value.html;return chain;},html};
  for(const key of ['stop','remove','fadeIn','not','on','prepend'])chain[key]=()=>chain;
  return chain;
};
const previousDollar=globalThis.$;
const previousFrame=globalThis.requestAnimationFrame;
globalThis.$=value=>shell(typeof value==='string'&&value.includes('<')?value:'');
globalThis.requestAnimationFrame=callback=>{callback();return 0;};
try {
  require('../src/fish/core/gameStateManager.ts').GameStateManager.getInstance().setPhase('player_turn');
  const card=adapter.normalizeCardDefinition({id:'truth',name:'规则测试',type:'Attack',cost:1,
    description:'造成999点伤害。',effects:{damage:6},discard_effects:{draw:1}});
  const before=structuredClone(card);
  const render=card=>{BattleUI.showCardTooltip(shell(''),card);return tooltipHtml;};
  const first=render(card);
  assert.match(byClass(first,'tooltip-effects'),/6点伤害/s);
  assert.doesNotMatch(byClass(first,'tooltip-effects'),/999/);
  assert.match(byClass(first,'tooltip-effects'),/被战斗效果弃掉后.*抽1张牌/s);
  assert.equal(byClass(first,'tooltip-description'),'造成999点伤害。');
  const {patch}=core.createCardPatch(core.createCardPatchLedger(),{
    kind:'numeric',stat:'damage',operator:'add',value:4,scope:'combat',createdTurn:1,
    source:{kind:'system',id:'test-upgrade'},
  });
  const upgraded=core.appendCardPatch(card,patch);
  const next=render(upgraded);
  assert.match(byClass(next,'tooltip-effects'),/10点伤害/);
  assert.doesNotMatch(byClass(next,'tooltip-effects'),/6点伤害|999/);
  assert.equal(byClass(next,'tooltip-description'),'造成999点伤害。');
  assert.deepEqual(card,before,'render and upgrade must preserve the source card');
  const pile=PileViewer.getInstance().createCardHTML(upgraded);
  assert.match(byClass(pile,'card-rules'),/10点伤害/s);
  assert.doesNotMatch(byClass(pile,'card-rules'),/999/);
  assert.equal(byClass(pile,'card-description'),'造成999点伤害。');
  TavernCardInteractionPresenter.getInstance().selectCards([upgraded], {
    title:'选择弃牌',minimum:1,maximum:1,allowCancel:false,
  });
  const selection=tooltipHtml;
  assert.match(byClass(selection,'card-rules'),/10点伤害/);
  assert.match(byClass(selection,'card-discard-rules'),/被战斗效果弃掉后.*抽1张牌/s,
    'selection must show actual discard-trigger program, not only prose/play effects');
  assert.doesNotMatch(byClass(selection,'card-discard-rules'),/999/);
  assert.equal(byClass(selection,'card-description'),'造成999点伤害。');
  TavernCardInteractionPresenter.getInstance().selectCards([{...upgraded,discardEffectProgram:undefined}], {
    title:'选择回收',minimum:0,maximum:1,allowCancel:true,
  });
  assert.equal(byClass(tooltipHtml,'card-discard-rules'),'','do not invent a discard trigger');
  const hostile=render({...card,description:'<img src=x onerror="oops()">'});
  assert.ok(!parseFragment(hostile).childNodes.some(n=>n.nodeName==='img'));
  assert.match(hostile,/&lt;img/);
} finally {
  globalThis.$=previousDollar;globalThis.requestAnimationFrame=previousFrame;
}
console.log('Actual tooltip and pile HTML use live effect programs, preserve prose separately, and reflect real card patches.');
