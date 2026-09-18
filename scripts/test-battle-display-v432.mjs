import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseFragment } from 'parse5';
import { writeFileSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { compileCompactEffectList } = require('../src/game-core/compactEffectDsl.ts');
const { appendCardPatch } = require('../src/game-core/cardPatch.ts');
const { evaluateNumericExpression, executeEffectProgram } = require('../src/game-core/effectDsl.ts');
const { simplifyNumericDisplay } = require('../src/game-core/numericDisplaySimplification.ts');
const { effectProgramToDisplayTags, triggeredEffectProgramToDisplayTags } = require('../src/game-core/effectDisplay.ts');
const { describeCompactEffectList } = require('../src/game-core/contentDescription.ts');
const { renderCardFace } = require('../src/shared/cardFace.ts');
const { renderSummonPanel } = require('../src/shared/summonPresentation.ts');
const { BattleUI } = require('../src/fish/ui/battleUI.ts');
const { DynamicStatusManager } = require('../src/fish/combat/dynamicStatusManager.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { EffectProgramDisplay } = require('../src/fish/ui/effectProgramDisplay.ts');
const compile = effects => { const result = compileCompactEffectList(effects); assert.equal(result.ok, true, JSON.stringify(result.issues)); return result.value; };
const status = { id:'focus', name:'刀锋专注', emoji:'🔪', type:'buff', stacks_change:'keep', triggers:{} };
assert.equal(DynamicStatusManager.getInstance().registry.replace([status,{id:'poison',name:'中毒',emoji:'🧪',type:'debuff',stacks_change:-1,triggers:{tick:{damage:'stacks',to:'self'}}}]).rejected.length, 0);
const context = { statusNames:{focus:'刀锋专注'}, resourceNames:{edge:'锋刃'}, resourceEmojis:{edge:'⚔️'} };
const state = { self:{ hp:60,maxHp:60,lust:0,maxLust:100,energy:0,maxEnergy:3,block:0,statusStacks:{focus:2} },
  opponent:{ hp:60,maxHp:60,lust:0,maxLust:100,energy:0,maxEnergy:3,block:0 }, currentTurn:1, cardsPlayedThisTurn:0, attacksPlayedThisTurn:0, skillsPlayedThisTurn:0 };
let card = { id:'knife',name:'毒小刀',type:'Attack',rarity:'Uncommon',cost:1,emoji:'🔪',unique:true,
  effectProgram:compile([{damage:'4 + self.status.focus.stacks'},{apply_status:'focus',stacks:1,to:'self'}]) };
for (const [index,value] of [2,1].entries()) card = appendCardPatch(card, {
  id:`sharp-${index}`,source:{kind:'card',id:'sharpen'},scope:'combat',createdTurn:1,priority:index,removeOn:'combat_end',kind:'numeric',stat:'damage',operator:'add',value,
});
const serialized = JSON.stringify(card);
const amount = card.effectProgram.steps[0].amount;
const simple = simplifyNumericDisplay(amount);
assert.deepEqual(simple,{op:'add',left:7,right:{op:'var',path:'self.status.focus.stacks'}});
const tags = effectProgramToDisplayTags(card.effectProgram,context);
assert.equal(tags[0].text,'对敌方造成(7 + 自身刀锋专注层数)点伤害');
assert.equal(tags[1].text,'为自身赋予1层刀锋专注');
assert.doesNotMatch(tags[0].text,/不低于|clamp|focus/);
assert.equal(JSON.stringify(card),serialized,'presentation must not change the saved/executed card');
assert.deepEqual(effectProgramToDisplayTags(JSON.parse(serialized).effectProgram,context),tags);
for (const layers of [0,1,2,99]) {
  const current = {...state,self:{...state.self,statusStacks:{focus:layers}}};
  assert.equal(evaluateNumericExpression(amount,current,{}),7+layers);
  assert.equal(evaluateNumericExpression(simple,current,{}),7+layers);
  const executed=executeEffectProgram(card.effectProgram,current,{});
  assert.equal(executed.ok,true);
  assert.equal(executed.state.opponent.hp,Math.max(0,60-(7+layers)));
  assert.deepEqual(executed, executeEffectProgram(JSON.parse(serialized).effectProgram,current,{}));
}
// Subtraction can cross zero: an inner clamp cannot be erased or moved over the later addition.
const clamp = value=>({op:'clamp_min',minimum:0,value});
const expression = clamp({op:'add',left:clamp({op:'subtract',left:{op:'var',path:'self.status.focus.stacks'},right:5}),right:2});
for(const layers of [0,3,5,9]) {
  const current={...state,self:{...state.self,statusStacks:{focus:layers}}};
  assert.equal(evaluateNumericExpression(simplifyNumericDisplay(expression),current,{}),Math.max(0,layers-5)+2);
}
for(const operator of ['multiply','divide']) for(const factor of [-2,0.5,2]) {
  const expression=clamp({op:operator,left:clamp({op:'subtract',left:amount,right:12}),right:factor});
  for(const layers of [0,2,10]) {
    const current={...state,self:{...state.self,statusStacks:{focus:layers}}};
    assert.equal(evaluateNumericExpression(expression,current,{}),evaluateNumericExpression(simplifyNumericDisplay(expression),current,{}));
  }
}
const signed=clamp({op:'var',path:'context.x_value'});
assert.deepEqual(simplifyNumericDisplay(signed),signed,'unproven signs keep safeguards');
assert.match(effectProgramToDisplayTags({spec:'mwg.effect/v1',steps:[{op:'damage',target:'opponent',amount:expression}]},context)[0].text,/最大值\(0/);
const gain=compile([{resource:{id:'edge',amount:2}},{energy:1},{apply_status:'focus',stacks:1,to:'self'}]);
const gains=effectProgramToDisplayTags(gain,context);
assert.deepEqual(gains.map(tag=>tag.icon),['⚔️','⚡','✨']);
assert.match(gains[0].text,/获得2点锋刃/);
assert.match(gains[2].text,/赋予1层刀锋专注/);
assert.equal(triggeredEffectProgramToDisplayTags('turn_start',gain,context)[0].icon,'⚔️','trigger timing must not hide the resource icon');
assert.match(describeCompactEffectList([{resource:{id:'edge',amount:2}},{apply_status:'focus',stacks:1,to:'self'}],undefined,context),/⚔️ 获得2点锋刃.*为自身赋予1层刀锋专注/);
const opponent=effectProgramToDisplayTags(compile({resource:{id:'edge',amount:1},to:'opponent'}),{...context,opponentResourceNames:{edge:'毒液'},opponentResourceEmojis:{edge:'🧪'}});
assert.equal(opponent[0].icon,'🧪');assert.match(opponent[0].text,/毒液/);
const summonHtml=renderSummonPanel({name:'机关',resources:[{id:'edge',name:'弹药',emoji:'🔩',max:5,current:0}],displayResourceNames:context.resourceNames,displayResourceEmojis:context.resourceEmojis,
  actions:[{name:'充填',effects:[{resource:{id:'edge',amount:1}},{summoner_effects:{resource:{id:'edge',amount:1}}}]}]});
assert.match(summonHtml,/🔩 自身获得1点弹药/);assert.match(summonHtml,/⚔️ 作用于召唤者：召唤者获得1点锋刃/);
const game=GameStateManager.getInstance().getGameState();
game.player.resources={edge:{id:'edge',name:'锋刃',emoji:'⚔️',current:2,max:5}};
assert.equal(EffectProgramDisplay.getInstance().programToTags(gain)[0].icon,'⚔️','actual battle adapter resolves the resource emoji');

const nodes = html => {const all=[];const visit=n=>{all.push(n);n.childNodes?.forEach(visit);};visit(parseFragment(html));return all;};
const attr=(n,key)=>n.attrs?.find(a=>a.name===key)?.value;
const has=(n,cls)=>attr(n,'class')?.split(' ').includes(cls);
const text=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join('');
const htmlById={},handlers={};
const shell = (key, data={}) => {
  const chain={length:1,html(value){htmlById[key]=value;return chain;},empty(){htmlById[key]='';return chain;},
    find(){return chain;},off(){return chain;},on(event,fn){handlers[key]=fn;return chain;},data(name){return data[name];}};return chain;
};
const previousDollar=globalThis.$, previousShowStatus=BattleUI.showStatusDetail;
globalThis.$=key=>typeof key==='object'?key:shell(key);
let clicked;
try {
  BattleUI.updateStatusEffects('player',[{id:'focus',stacks:1},{id:'poison',stacks:12,duration:3}]);
  const statusNodes=nodes(htmlById['#player-status-effects']);
  assert.deepEqual(statusNodes.filter(n=>has(n,'status-stack-badge')).map(text),['1','12']);
  assert.equal(statusNodes.filter(n=>has(n,'status-kind-buff')).length,1);
  assert.equal(statusNodes.filter(n=>has(n,'status-kind-debuff')).length,1);
  BattleUI.showStatusDetail=(...args)=>{clicked=args;};
  handlers['#player-status-effects'].call(shell('button',{'status-id':'focus',target:'player'}));
  assert.deepEqual(clicked,['focus','player'],'click still opens the correct status detail');
  BattleUI.updateRelicsDisplay([{id:'stone',name:'磨刀石',emoji:'🪨'},{id:'pack',name:'旅行工具包',emoji:'🎒'}]);
} finally { globalThis.$=previousDollar;BattleUI.showStatusDetail=previousShowStatus; }
const ability=BattleUI.createAbilityHTML({id:'steady',name:'稳手',emoji:'🎯',trigger:'turn_start',effectProgram:gain});
assert.ok(nodes(ability).some(n=>n.nodeName==='button'&&has(n,'ability-item')&&has(n,'support-icon-button')));
const source=readFileSync('src/fish/index.html','utf8');
for(const owner of ['player','enemy']){
  const section=nodes(source).find(n=>attr(n,'id')===`${owner}-status-section`);
  assert.ok(nodes((await import('parse5')).serialize(section)).some(n=>attr(n,'id')===`${owner}-abilities`),'abilities share the status section');
}
if(process.argv.includes('--fixture')) {
  const rulesHtml=EffectProgramDisplay.getInstance().createCompactEffectTagsHTML(tags);
  const cards=[renderCardFace(card,{costLabel:'1 ⚡',rarityLabel:'罕见',typeLabel:'攻击',rulesHtml}),
    renderCardFace({id:'charge',name:'蓄势',type:'Skill',rarity:'Common',emoji:'⚡',description:'获得资源并集中精神。'},{costLabel:'0 ⚡',rarityLabel:'普通',typeLabel:'技能',rulesHtml:EffectProgramDisplay.getInstance().createCompactEffectTagsHTML(gains)}),
    renderCardFace({id:'seek',name:'刀光迅影',type:'Skill',rarity:'Rare',emoji:'🌙'},{costLabel:'0 ⚡',rarityLabel:'稀有',typeLabel:'技能',rulesHtml:EffectProgramDisplay.getInstance().createCompactEffectTagsHTML(effectProgramToDisplayTags(compile([{move_card:1,from:'draw',destination:'hand',pick:'choose',name_contains:'小刀'},{draw:1}])))}),
    renderCardFace({id:'guard',name:'格挡',type:'Skill',rarity:'Common',emoji:'🛡️'},{costLabel:'1 ⚡',rarityLabel:'普通',typeLabel:'技能',rulesHtml:EffectProgramDisplay.getInstance().createCompactEffectTagsHTML(effectProgramToDisplayTags(compile({block:5})))})];
  writeFileSync('tmp/battle-display-v432-fixture.json',JSON.stringify({statuses:htmlById['#player-status-effects'],abilities:ability,relics:htmlById['.relic-grid'],cards},null,2));
}
console.log('PASS repeated real patches, execution/save equality, safe clamp display, resource icons and ownership, status stacks and detail click, shared ability strip.');
