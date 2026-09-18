import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {normalizeInitialDraftAbsentCurseCost:normalize,decodeInitialDraftContainers:decode}=require('../src/sillytavern-extension/initialDraftDecoding.ts');
const {INITIAL_DRAFT_SPEC:spec}=require('../src/game-core/initialDraft.ts');
const card={id:'curse',type:'Curse',cost:null,description:'AI authored',discard_effects:{draw:2},effects:{block:1}};
const input={spec,player:{core:{hp:12},cards:[card]},registry:{templates:[card]},opening:{choices:[{id:'a',outcome:{reward:{cards:[card]}}}]}};
const before=structuredClone(input),expected=structuredClone(input);
delete expected.player.cards[0].cost;
delete expected.registry.templates[0].cost;
delete expected.opening.choices[0].outcome.reward.cards[0].cost;
assert.deepEqual(normalize(input),expected,'exactly three absent costs; all authored fields unchanged');
assert.deepEqual(input,before,'never mutate provider evidence');
const once=normalize(input);
assert.equal(normalize(once),once,'idempotent without needless rewrite');
assert.deepEqual(normalize(decode({...input,registry:JSON.stringify(input.registry)})),expected);
for(const type of ['Attack','Skill','Power','Status','curse',null,undefined]) {
 const other={...input,player:{cards:[{...card,type}]},registry:{templates:[]},opening:{choices:[]}};
 assert.equal(normalize(other),other,'other card types retain their null cost');
}
for(const cost of [0,1,-1,'0','',{},[],undefined]) {
 const other={spec,registry:{templates:[{...card,cost}]}};
 assert.equal(normalize(other),other,'not a general illegal-cost repair');
}
for(const wrongSpec of [null,undefined,'mwg.initial-draft/v2']) {
 const other={...input,spec:wrongSpec};assert.equal(normalize(other),other);
}
const unknown={spec,player:{cards:[{card_ref:'a',type:'Curse',cost:null}],core:card},registry:{statuses:[card],templates:'not-an-array'},
 opening:{choices:[null,{outcome:{reward:{artifacts:[card]}}}]},extra:card};
assert.equal(normalize(unknown),unknown,'do not traverse unknown boundaries or weaken card_ref validation');
const nested={spec,player:{cards:[{...card,cost:1,effects:{nested:card},description:JSON.stringify(card)}]}};
assert.equal(normalize(nested),nested,'effects and prose are not card boundaries');
for(const bad of [null,[],7,'encoded']) assert.doesNotThrow(()=>normalize({spec,player:bad,registry:bad,opening:bad}));
console.log('PASS absent Curse cost: exact boundary-only immutable conversion; other costs/types/references/effects preserved; idempotent and encoded-container compatible.');
