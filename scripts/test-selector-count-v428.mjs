import {readFileSync} from 'node:fs';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {ReferenceBattleRuntimeHost}=require('../src/adapters/referenceBattleRuntimeHost.ts');
const {TavernEffectCommandHost}=require('../src/fish/core/effectCommandHost.ts');
const {cardMatchesSelectorFilter}=require('../src/game-core/cardSelectorRuntime.ts');
assert.equal(cardMatchesSelectorFilter({id:'s',name:'完美打击'},{nameContains:'打击'}),true);
assert.equal(cardMatchesSelectorFilter({id:'s',name:'完美打击'},{name:'打击'}),false);
const authored=core.compileCompactEffectList([{discard:'all',from:'hand',pick:'all',name_contains:'小刀'},{damage:'discard_count'},{draw:'discard_count'}]);
assert.equal(authored.ok,true,JSON.stringify(authored.issues));
for(const variant of ['normal','empty','cancel','nested']) {
 const state=core.createEmptyBattleState();
 state.player.hand=variant==='empty'?[]:[{id:'a',name:'小刀',type:'Attack'},{id:'b',name:'锋利小刀',type:'Attack'},{id:'c',name:'打击',type:'Attack'}].map(c=>({...c,cost:0,rarity:'Common',emoji:'x',description:''}));
 const backing=new ReferenceBattleRuntimeHost(state);let damage=0,drawn=0;
 const runtime=backing.createCardEffectRuntime({drawCards:async n=>{drawn+=n;},chooseCards:async()=>null,onCardExhausted:async()=>{},onCardDiscarded:async card=>{
  if(variant==='nested'&&card.id==='a') { const nested=core.compileCompactEffectList({discard:'all',from:'hand',pick:'all'});await host.executeProgram(nested.value,true); }
 }});
 const actor={hp:30,maxHp:30,lust:0,maxLust:100,energy:3,maxEnergy:3,block:0};
 const host=new TavernEffectCommandHost({readState:()=>({self:actor,opponent:actor}),isTerminal:()=>false,presentCommand:()=>{},executeCardCommand:async(c,ctx)=>runtime.execute(c,ctx),executeBattleCommand:async c=>{if(c.type==='damage')damage+=c.amount;else throw Error(c.type);}});
 const program=variant==='cancel'?core.compileCompactEffectList([{discard:2,from:'hand',pick:'choose',name_contains:'小刀'},{damage:'discard_count'},{draw:'discard_count'}]).value:authored.value;
 await host.executeProgram(program,true);
 const expected=['normal','nested'].includes(variant)?2:0;
 assert.equal(damage,expected,variant);assert.equal(drawn,expected,variant);
 await host.executeProgram(core.compileCompactEffectList({draw:'discard_count'}).value,true);assert.equal(drawn,expected,'result cannot leak to next card');
}
console.log('PASS substring/exact selectors and actual discard count through real card movement and Tavern host: empty, cancellation, nested triggers, invocation isolation.');


const validateSchema=new Ajv2020({strict:false}).compile(JSON.parse(readFileSync('schemas/mwg-card-effects-v1.schema.json','utf8')));
assert.equal(validateSchema({effects:[{discard:'all',from:'hand',pick:'all',name_contains:'小刀'},{damage:'discard_count'},{draw:'discard_count'}]}),true,JSON.stringify(validateSchema.errors));
const countProgram={version:1,steps:[]};
assert.equal(core.evaluateNumericExpression({op:'count_cards',selector:{zone:'hand',pick:'all',filter:{nameContains:'打击'}}},{cardZones:{hand:[{id:'a',name:'打击'},{id:'b',name:'完美打击'},{id:'c',name:'防御'}],draw:[],discard:[],exhaust:[]}},{spentEnergy:0}),2);
console.log('PASS public JSON schema and portable count selector agree with substring matching.');
