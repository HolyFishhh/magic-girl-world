import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const {describeCompactEffectList}=require('../src/game-core/contentDescription.ts');
const {effectProgramToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const {collectStanceDefinitions,collectStanceNames}=require('../src/game-core/stanceIdentityDisplay.ts');
const {renderStatusReferences}=require('../src/shared/statusReference.ts');
const {renderStancePanel}=require('../src/shared/stancePresentation.ts');

const stance={id:'demon_form',name:'恶魔形态',emoji:'😈',description:'罪念具现为恶魔之力。',
 enter:{add_card:'hellfire',to:'hand'},passive:[{modify:'damage',multiply:1.5},{modify:'damage_taken',multiply:0.8}],exit:{apply_status:'corruption',stacks:2,to:'self'},
 events:[{on:'turn_start',effects:{damage:3,to:'self',damage_type:'hp_loss'}}]};
const owner={id:'demon_awakening',name:'恶魔觉醒',type:'Skill',rarity:'Rare',cost:1,
 creates:[{id:'hellfire',name:'地狱火',type:'Attack',rarity:'Rare',cost:1,effects:{damage:8}}],effects:{stance}};
const conditionCard={id:'guilt_hammer',name:'罪念凿击',type:'Attack',rarity:'Common',cost:1,
 effects:{damage:"self.stance == 'demon_form' ? 8 : 5",to:'opponent'}};
const status={id:'corruption',name:'堕转',emoji:'🌀',type:'buff',triggers:{hold:{modify:'damage',add:'stacks'}}};
const scope={battle:{cards:[owner,conditionCard],statuses:[status]}};
const stanceNames=collectStanceNames(scope,conditionCard);
const stanceDefinitions=collectStanceDefinitions(scope,conditionCard);
const references=[];
const compactContext={stanceNames,stanceDefinitions,statusNames:{corruption:'堕转'},statusDefinitions:{corruption:status},cardNames:{hellfire:'地狱火'},onStanceReference:reference=>references.push(reference)};

const ownerText=describeCompactEffectList(owner.effects,owner.creates,compactContext);
assert.match(ownerText,/进入姿态“恶魔形态”/);
assert.doesNotMatch(ownerText,/进入时：|持续：|退出时：|仅此姿态/,'card face keeps stance lifecycle out of the inline capsule');
assert.equal(references.length,1);
assert.equal(references[0].stance.id,'demon_form');

const conditionReferences=[];
const conditionText=describeCompactEffectList(conditionCard.effects,undefined,{...compactContext,onStanceReference:reference=>conditionReferences.push(reference)});
assert.match(conditionText,/对敌方造成5点伤害/);
assert.match(conditionText,/如果自身处于恶魔形态，则造成8点伤害/);
assert.doesNotMatch(conditionText,/self\.stance|demon_form/);
assert.equal(conditionReferences[0].stance.id,'demon_form','a stance defined by another owned card remains referenceable');

const compiledOwner=compileCompactEffectList(owner.effects,{creates:owner.creates});assert.equal(compiledOwner.ok,true,JSON.stringify(compiledOwner));
const typedOwnerTags=effectProgramToDisplayTags(compiledOwner.value,{...compactContext});
assert.match(typedOwnerTags.map(tag=>tag.text).join('；'),/进入姿态「恶魔形态」/);
assert.doesNotMatch(typedOwnerTags.map(tag=>tag.text).join('；'),/进入时：|持续：|退出时：/);
assert.equal(typedOwnerTags[0].reference.stance.id,'demon_form');

const compiledCondition=compileCompactEffectList(conditionCard.effects);assert.equal(compiledCondition.ok,true,JSON.stringify(compiledCondition));
const typedConditionTags=effectProgramToDisplayTags(compiledCondition.value,{...compactContext});
const typedConditionText=typedConditionTags.map(tag=>tag.text).join('；');
assert.match(typedConditionText,/如果自身处于恶魔形态，则造成8点伤害/);
assert.doesNotMatch(typedConditionText,/self\.stance|demon_form/);
assert.equal(typedConditionTags[0].references[0].stance.id,'demon_form');

const restored=JSON.parse(JSON.stringify(typedOwnerTags[0].reference));
assert.deepEqual(restored.stance,JSON.parse(JSON.stringify(typedOwnerTags[0].reference.stance)),'save/restore preserves executable stance reference details');
const linked=renderStatusReferences('自身进入姿态「恶魔形态」',[restored]);
assert.match(linked,/mwg-status-reference/);
assert.match(linked,/aria-label="查看姿态：恶魔形态"/);
assert.match(linked,/data-stance-definition=/);
const detail=renderStancePanel(restored.stance,restored.stanceContext);
for(const fragment of ['恶魔形态','进入时','地狱火','持续生效','×1.5','×0.8','退出时','堕转','仅此姿态生效期间','回合开始时','失去3点生命','重复进入']) assert.match(detail,new RegExp(fragment));
assert.match(detail,/<span class="mwg-status-reference[^>]+>堕转<\/span>/, '姿态内嵌状态使用同一蓝色引用详情');
assert.match(detail,/罪念具现为恶魔之力/);

console.log('PASS stance links: compact/typed descriptions, merged-scope conditions, JSON restore and grouped executable detail.');
