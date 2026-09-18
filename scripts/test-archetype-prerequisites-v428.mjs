import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const {scoreContentArchetypes,profileDeckArchetypes}=require('../src/game-core/archetypeGraph.ts');
const {createContentPack}=require('../src/game-core/contentPack.ts');
const card=(id,effects)=>({id,name:id,type:'Skill',rarity:'Common',cost:1,quantity:1,effects});
for(const effects of [{damage:6},{block:6},{draw:2},{heal:3}]) {
  const result=scoreContentArchetypes(card('ordinary',effects));
  assert.ok(!result.some(a=>a.id.startsWith('desire-')||a.id==='mixed-pressure'),'ordinary payoffs cannot establish a desire mechanic');
}
const mixed=scoreContentArchetypes(card('mixed',[{lust:5},{damage:8}]));
assert.ok(mixed.some(a=>a.id==='desire-conversion'));
const pack=createContentPack({cards:[card('knife',{damage:5}),card('dodge',{block:5}),card('flow',{draw:2})]});
assert.ok(!profileDeckArchetypes(pack).affinities.some(a=>a.id.startsWith('desire-')));
const named={...card('renamed',{damage:5}),name:'欲望之刃',description:'只是题材，不携带欲望机制'};
assert.deepEqual(scoreContentArchetypes(named),scoreContentArchetypes(card('renamed',{damage:5})),'flavor names do not select a mechanical archetype');
console.log('PASS archetype classification requires its mechanics; generic damage, block, draw and names cannot create a desire build.');
