import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseFragment } from 'parse5';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { presentCompactContent } = require('../src/game-core/contentPresentation.ts');
const { describeCompactEffectList } = require('../src/game-core/contentDescription.ts');
const { compileCompactEffectList } = require('../src/game-core/compactEffectDsl.ts');
const { effectProgramToDisplayTags, triggeredEffectProgramToDisplayTags, cardAttachmentsToDisplayTags } = require('../src/game-core/effectDisplay.ts');
const { renderRulePills } = require('../src/shared/rulePills.ts');
const { renderCardFace } = require('../src/shared/cardFace.ts');
const { EffectProgramDisplay } = require('../src/fish/ui/effectProgramDisplay.ts');
const compile = effects => { const result = compileCompactEffectList(effects); assert.equal(result.ok, true, JSON.stringify(result.issues)); return result.value; };
const allNodes = html => { const nodes=[]; const walk=node=>{nodes.push(node); node.childNodes?.forEach(walk);}; walk(parseFragment(html)); return nodes; };
const hasClass = (node, name) => node.attrs?.find(attr=>attr.name==='class')?.value.split(' ').includes(name);
const textOf = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textOf).join('');

const growth = { patch_card:'damage', from:'combat', pick:'all', name_contains:'小刀', add:2, scope:'permanent', match:'filter', future_copies:true };
const card = { id:'feed', name:'咒痕喂食', type:'Skill', rarity:'Uncommon', cost:2, unique:true, exhaust:true, effects:[growth] };
const before=structuredClone(card);
const presentation=presentCompactContent(card,'card');
assert.equal(presentation.rulesGroups.length,1);
const rule=presentation.rulesGroups[0];
for (const pattern of [/本场战斗全部牌区/, /名称包含「小刀」/, /伤害增加2/, /永久/, /之后生成的同类牌也生效/]) assert.match(rule,pattern);
assert.doesNotMatch(rule,/combat|name_contains|future_copies|唯一|消耗·本场/);
const face=renderCardFace(card,{costLabel:'2 能量',rarityLabel:'罕见',typeLabel:'技能',rulesHtml:renderRulePills(presentation.rulesGroups)});
const nodes=allNodes(face);
assert.equal(nodes.filter(node=>hasClass(node,'mwg-rule-pill')).length,1);
assert.equal(nodes.filter(node=>hasClass(node,'card-trait') && textOf(node)==='唯一').length,1);
assert.doesNotMatch(textOf(nodes.find(node=>hasClass(node,'card-rules'))),/唯一|消耗·本场/);
assert.deepEqual(card,before,'display must not rewrite generated mechanics');

const chained=[{discard:'all',from:'hand',pick:'all',name_contains:'小刀'},{damage:'discard_count'},{draw:'discard_count'}];
const chain=presentCompactContent({effects:chained},'card').rulesGroups;
assert.equal(chain.length,1);
assert.match(chain[0],/小刀.*伤害.*抽本次弃牌数量张牌/);
assert.doesNotMatch(chain[0],/discard_count/);
const chainTags=effectProgramToDisplayTags(compile(chained));
assert.equal(chainTags.length,1);
assert.match(chainTags[0].text,/小刀.*本次弃牌数量.*本次弃牌数量/);
assert.equal(presentCompactContent({effects:[{damage:4},{block:3}]},'card').rulesGroups.length,2,'independent operations get separate pills');
assert.equal(presentCompactContent({effects:{damage:4,block:3,when:'self.hp < 10'}},'card').rulesGroups.length,1,'numeric bundle and condition stay together');
const delayed=presentCompactContent({effects:{schedule:2,phase:'after_draw',effects:[{damage:4},{draw:1}]}},'card').rulesGroups;
assert.equal(delayed.length,1); assert.match(delayed[0],/2回合.*伤害.*抽1张/);
const trigger=presentCompactContent({effects:{block:2},trigger:{on:'turn_start',effects:[{damage:4},{draw:1}]}},'content').rulesGroups;
assert.equal(trigger.length,3); assert.doesNotMatch(trigger[0],/回合开始/); assert.match(trigger[1],/回合开始.*伤害/); assert.match(trigger[2],/回合开始.*抽1张/);
const overridden=presentCompactContent({trigger:'turn_start',effects:[{damage:4},{draw:1,on:'turn_end'}]},'content').rulesGroups;
assert.equal(overridden.length,2); assert.doesNotMatch(overridden[1],/回合开始/); assert.match(overridden[1],/回合结束.*抽1张/);
assert.match(presentCompactContent({type:'Curse',effects:{damage:2}},'card').rulesGroups[0],/^回合结束时/);
assert.match(presentCompactContent({effects:{block:1},discard_effects:{draw:1}},'card').rulesGroups[1],/^此牌被战斗效果弃掉后/);

for (const effects of [{recover:1,from:'discard',pick:'choose',name_contains:'小刀'},{...growth,id:'knife',name_contains:'小刀',card_type:'Attack'}]) {
  assert.match(describeCompactEffectList(effects,undefined,{cardNames:{knife:'仪式小刀'}}),/小刀/);
  const tags=effectProgramToDisplayTags(compile(effects),{cardNames:{knife:'仪式小刀'}});
  assert.match(tags.map(tag=>tag.text).join(' '),/小刀/);
  assert.doesNotMatch(tags.map(tag=>tag.text).join(' '),/combat|knife|Attack/);
}
const idAndFilter=describeCompactEffectList({...growth,id:'knife',card_type:'Attack'},undefined,{cardNames:{knife:'仪式小刀'}});
assert.match(idAndFilter,/仪式小刀.*名称包含.*攻击牌/);
assert.match(describeCompactEffectList({add_card:'knife'},undefined,{cardNames:{knife:'仪式小刀'}}),/仪式小刀/);
assert.equal(triggeredEffectProgramToDisplayTags('turn_start',compile([{damage:4},{draw:1}])).length,2);

const refs=[{id:'status_ink',name:'墨痕',rules:'回合结束时受到1点伤害'}];
const safe=renderRulePills(['施加墨痕；持续2回合','<img src=x onerror=alert(1)>'],refs);
const safeNodes=allNodes(safe);
assert.equal(safeNodes.filter(node=>node.nodeName==='img').length,0);
assert.equal(safeNodes.filter(node=>hasClass(node,'mwg-status-reference')).length,1);
assert.equal(safeNodes.filter(node=>hasClass(node,'mwg-rule-pill')).length,2);
const summonRefs=[{id:'guard',name:'护卫',rules:'守护',summon:{name:'护卫'}},{id:'pet',name:'使魔',rules:'行动',summon:{name:'使魔'}}];
const compiledHtml=EffectProgramDisplay.getInstance().createCompactEffectTagsHTML([{text:'护卫与使魔',icon:'◆',color:'#8fa5c4',category:'special',references:summonRefs}]);
assert.equal(allNodes(compiledHtml).filter(node=>hasClass(node,'mwg-status-reference')).length,2);
const attachments=cardAttachmentsToDisplayTags([{id:'a',kind:'enchantment',name:'磨刃',source:{kind:'card',id:'feed',name:'咒痕喂食'},scope:'combat',removeOn:'combat_end',
  changes:[{kind:'numeric',stat:'damage',operator:'add',value:2},{kind:'keyword',keyword:'retain',enabled:true}]}]);
assert.equal(attachments.length,1,'attachment name, lifetime and changes form one pill');
assert.match(attachments[0].text,/磨刃.*伤害增加2.*保留/);
console.log('PASS screenshot growth range, Chinese names, semantic pills, independent traits, condition/timing/discard groups, escaping and clickable references.');
