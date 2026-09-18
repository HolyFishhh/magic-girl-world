import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {createTowerInitialContentJsonSchema}=require('../src/game-core/towerRequest.ts');
const {normalizeMvuPlayerAuthoredContent}=require('../src/runtime/mvuBattleContentNormalizer.ts');
const {validateRewardCandidateAgainstLibrary}=require('../src/game-core/rewardCandidateValidation.ts');
const {planInitialDraftRegistryRepair}=require('../src/game-core/initialDraftRepair.ts');
const {expandInitialOpeningCardReferences}=require('../src/game-core/initialCardReference.ts');
const card={id:'call_wisp',name:'召灯',emoji:'✨',type:'Skill',rarity:'Common',cost:1,quantity:2,effects:[
  {spawn_summon:{id:'wisp',name:'灯灵',emoji:'✨',max_hp:10,actions:[{id:'hit',name:'撞击',effects:{damage:4}}],
    abilities:[{id:'light',name:'灯光',trigger:{on:'turn_start',effects:{damage:2,to:'opponent'}}}]}},
  {apply_status:'glow',stacks:1},{add_card:'spark'},
]};
const fixture=()=>({spec:'mwg.initial-draft/v1',narrative:'塔门前挑选馈赠。',
  player:{status:{time:'黄昏',location:'塔门',profession:{name:'契约师',ability:'召灯'}},core:{emoji:'✨',hp:60,max_hp:60,lust:0,max_lust:100},cards:[structuredClone(card)]},
  opening:{title:'馈赠',narrative:'选择馈赠。',choices:[
    {id:'copy',label:'再得一张',outcome:{reward:{cards:[{card_ref:'call_wisp',quantity:1}]}}},
    {id:'gold',label:'金币',outcome:{gold:10}},{id:'health',label:'体力',outcome:{max_hp:3}},
  ]},registry:{resources:[],statuses:[{id:'glow',name:'光',emoji:'✨',type:'buff',stacks_change:'keep',triggers:{turn_start:{block:1}}}],
    templates:[{id:'spark',name:'火花',type:'Attack',rarity:'Common',cost:0,effects:{damage:3}}]},
});
const input=fixture(),before=structuredClone(input);
const normalized=normalizeMvuPlayerAuthoredContent(input);
const result=compileInitialDraftToMvu(normalized);
assert.equal(result.ok,true,JSON.stringify(result));
const reward=result.value.opening.choices[0].outcome.reward.cards[0];
assert.equal(reward.id,'call_wisp','explicit reward reference expands to the one authored card definition');
assert.deepEqual(reward,{...result.value.player.cards[0],quantity:1});
assert.deepEqual(reward.effects[0].spawn_summon.abilities,card.effects[0].spawn_summon.abilities);
assert.equal(reward.creates[0].id,'spark');
assert.equal(reward.statuses,undefined,'already-owned status closure is not acquired again');
assert.deepEqual(validateRewardCandidateAgainstLibrary('cards',reward,{existing:result.value.player.cards,statusDefinitions:result.value.player.statuses}),{ok:true});
assert.equal(result.value.player.cards[0].quantity,2,'reward is not granted before selection');
assert.notEqual(reward.effects,result.value.player.cards[0].effects,'no mutable aliases');
assert.deepEqual(input,before);
assert.deepEqual(compileInitialDraftToMvu(normalized),result,'deterministic expansion');
const ajv=new Ajv2020({strict:false,allErrors:true});
const validate=ajv.compile(createInitialDraftJsonSchema().value);
assert.equal(validate(input),true,JSON.stringify(validate.errors));
const canonical=ajv.compile(createTowerInitialContentJsonSchema().value);
const old={...input};delete old.spec;delete old.registry;
assert.equal(canonical(old),false,'draft-only references never reach the canonical contract');
const authored = structuredClone(result.value);
authored.opening.choices[0].outcome.reward.cards = [{card_ref:'call_wisp',quantity:3}];
const authoredBefore = structuredClone(authored);
const authorSchema = ajv.compile(createTowerInitialContentJsonSchema({allowCardReferences:true}).value);
assert.equal(authorSchema(authored),true,JSON.stringify(authorSchema.errors));
const expanded = expandInitialOpeningCardReferences(authored.opening, authored.player);
const expandedCard = expanded.choices[0].outcome.reward.cards[0];
assert.deepEqual(expandedCard,{...result.value.player.cards[0],quantity:3},'default route copies all summon, status references and local templates');
assert.deepEqual(validateRewardCandidateAgainstLibrary('cards',expandedCard,{existing:authored.player.cards,statusDefinitions:authored.player.statuses}),{ok:true});
assert.equal(canonical({...authored,opening:expanded}),true,JSON.stringify(canonical.errors));
assert.deepEqual(authored,authoredBefore);
assert.notEqual(expandedCard.effects,authored.player.cards[0].effects);
const negative=[
  ['missing reference',d=>d.opening.choices[0].outcome.reward.cards[0].card_ref='missing'],
  ['ambiguous duplicate',d=>d.player.cards.push(structuredClone(card))],
  ['chained reference',d=>d.player.cards[0].card_ref='call_wisp'],
  ['overridden mechanics',d=>d.opening.choices[0].outcome.reward.cards[0].effects={damage:99}],
  ['overridden presentation',d=>d.opening.choices[0].outcome.reward.cards[0].description='not a copy'],
  ['missing quantity',d=>delete d.opening.choices[0].outcome.reward.cards[0].quantity],
  ...[0,101,1.5,'1',null].map(q=>[`invalid quantity ${q}`,d=>d.opening.choices[0].outcome.reward.cards[0].quantity=q]),
];
for(const [label,change] of negative){
  const draft=fixture();change(draft);const copy=structuredClone(draft);
  const failed=compileInitialDraftToMvu(draft);
  assert.equal(failed.ok,false,label);assert.equal('value' in failed,false,label);
  assert.ok(failed.diagnostics.some(d=>d.code==='INVALID_REFERENCE'),label);
  assert.equal(planInitialDraftRegistryRepair(draft).kind,'unsupported','must not invent a missing owned card');
  assert.deepEqual(draft,copy,label);
  if(!['missing reference','ambiguous duplicate'].includes(label))assert.equal(validate(draft),false,label);
}
const inline=fixture();inline.opening.choices[0].outcome.reward.cards[0]={...structuredClone(card),quantity:1};
const redundant=fixture();redundant.opening.choices[0].outcome.reward.cards[0].id='call_wisp';
const redundantBefore=structuredClone(redundant);
assert.deepEqual(normalizeMvuPlayerAuthoredContent(redundant).opening.choices[0].outcome.reward.cards[0],{card_ref:'call_wisp',quantity:1});
assert.deepEqual(redundant,redundantBefore,'normalization cannot mutate the raw response');
for(const mutate of [
 d=>d.opening.choices[0].outcome.reward.cards[0].id='other',
 d=>d.opening.choices[0].outcome.reward.cards[0].effects={damage:99},
 d=>d.player.cards.push(structuredClone(card)),
 d=>d.player.cards=[],
 d=>d.opening.choices[0].outcome.reward.cards[0].quantity=0,
]){
 const d=structuredClone(redundant);mutate(d);
 assert.equal(compileInitialDraftToMvu(normalizeMvuPlayerAuthoredContent(d)).ok,false,'ambiguous/overriding references remain rejected');
}
assert.equal(validate(inline),true,JSON.stringify(validate.errors));
assert.equal(compileInitialDraftToMvu(inline).ok,true,'existing inline authoring remains supported');
console.log('PASS initial card references: exact copy, closures, no early reward, no aliases, strict rejection, schema and canonical isolation');
