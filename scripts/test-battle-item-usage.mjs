import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {parseFragment} from 'parse5';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {presentCompactContent,formatCompactContentPresentation}=require('../src/game-core/contentPresentation.ts');
// Exact authored sample25 item: wrong prose must remain visible, not become a rule.
const item={id:'graphite_grease',name:'坩埚石墨膏',emoji:'🧴',count:1,
  description:'战斗外用：涂抹风炉阀门，也可以应急灌注护壁效果。',effects:[{block:6}]};
const original=structuredClone(item);
const presentation=presentCompactContent(item,'item');
assert.match(presentation.usageText||'',/战斗外不可使用/);
assert.match(presentation.usageText,/玩家可行动/);
assert.match(presentation.usageText,/消耗1个/);
assert.match(presentation.usageText,/领取只入背包/);
assert.match(presentation.rulesText,/6点格挡/);
assert.doesNotMatch(presentation.rulesText,/战斗外用/);
assert.equal(presentation.flavorText,item.description);
const formatted=formatCompactContentPresentation(presentation);
assert.ok(formatted.indexOf('使用限制：')<formatted.indexOf('规则：'));
assert.ok(formatted.indexOf('规则：')<formatted.indexOf('叙述'));
assert.match(formatted,/叙述（不作为使用条件或效果依据）/);
assert.deepEqual(item,original);
for(const kind of ['card','status','content'])assert.equal(presentCompactContent(item,kind).usageText,undefined);
assert.equal(presentCompactContent(null,'item').usageText,undefined,'do not invent an item for missing data');
const {formatCompactEffectAuthoringContract,createTowerInitialContentJsonSchema}=require('../src/game-core/towerRequest.ts');
assert.match(formatCompactEffectAuthoringContract(),/战斗外不可使用/);
assert.match(formatCompactEffectAuthoringContract(),/不增加 usage、scope/);
const schema=createTowerInitialContentJsonSchema().value;
assert.match(schema.$defs.mwgItem.description,/战斗外不可使用/);
assert.deepEqual(schema.$defs.mwgItem.required,['id','name','count','effects']);
assert.equal(schema.$defs.mwgItem.properties.usage,undefined);
assert.equal(schema.$defs.mwgItem.properties.scope,undefined);
// Render the real battle item presenter; substitute only its jQuery DOM sink.
const {TavernBattleShellPresenter}=require('../src/fish/ui/battleShellPresenter.ts');
const {normalizeItemDefinition}=require('../src/fish/core/battleContentAdapter.ts');
const {EffectProgramDisplay}=require('../src/fish/ui/effectProgramDisplay.ts');
let html='';const previousDollar=globalThis.$;
globalThis.$=()=>({html(value){html=value;return this;},show(){return this;}});
try{TavernBattleShellPresenter.prototype.showItems.call(
  {effectDisplay:EffectProgramDisplay.getInstance()},[normalizeItemDefinition(item)]);
}finally{globalThis.$=previousDollar;}
const texts=className=>{
  const values=[];const text=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join('');
  const walk=n=>{if(n.attrs?.some(a=>a.name==='class'&&a.value.split(/\s+/).includes(className)))values.push(text(n));n.childNodes?.forEach(walk);};
  walk(parseFragment(html));return values.join('\n');
};
assert.equal(texts('item-usage'),'仅战斗中可用');
assert.match(texts('content-rules'),/6点格挡/);
assert.doesNotMatch(texts('content-rules'),/战斗外用/);
assert.doesNotMatch(texts('content-rules'),/战斗外用/);
assert.match(texts('content-flavor'),/战斗外用/);
const common=readFileSync('src/common/index.ts','utf8');
assert.match(common,/function renderCollectionSupport[\s\S]*kind === '道具' \? battleItemUsageHtml\(\)/,
  'the shared support renderer supplies the fixed usage rule for every common item surface');
assert.match(common,/rootId === 'tower-player-items'[\s\S]*renderCollectionSupport\(value, isItem \? '道具'/,
  'the tower inventory routes items through the shared item renderer');
assert.match(common,/filteredItems[\s\S]*renderCollectionSupport\(item, '道具'\)/,
  'the ordinary inventory routes items through the shared item renderer');
const towerPanel=readFileSync('src/common/towerNodePanel.ts','utf8');
assert.match(towerPanel,/presentation\.usageText \? `<p class="item-usage">\$\{BATTLE_ITEM_USAGE_LABEL\}<\/p>`/,
  'reward previews expose the same program-owned usage rule');
const fish=readFileSync('src/fish/index.ts','utf8');
assert.match(fish,/canRun: \(\) => this\.battleManager\.canPlayerAct\(\)/,'keep actual battle action gate');
assert.match(fish,/count: Math\.max\(0, current\.count - 1\)/,'keep successful-use consumption');
console.log('PASS item usage, actual-effect/prose separation, compact AI contract, real battle presenter and inventory wiring');
