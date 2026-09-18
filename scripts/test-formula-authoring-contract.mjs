import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {formulaAuthoringContractClauses}=require('../src/game-core/formulaAuthoringContract.ts');
const {compactEffectProtocolSections}=require('../src/game-core/authoredEffectProtocol.ts');
const clauses=formulaAuthoringContractClauses();
assert.ok(clauses.some(clause=>clause.includes('discard_count')), 'operation-local count is documented');
assert.ok(clauses.every(c=>c.length<350),'scan-friendly clauses, no giant variable paragraph');
for(const mode of ['runtime','initial-draft']) {
  const section=compactEffectProtocolSections(mode).find(s=>s.id==='formulas');
  assert.deepEqual(section.clauses.slice(0,clauses.length),clauses);
}
const text=clauses.join('\n');
// The sole concrete damage example is taken from the rendered reference.
const rendered=JSON.parse(text.match(/\{damage:("[^"]+")\}/)[0].replace('{damage:','{"damage":'));
const good=[rendered,{damage:'floor(self.hp / 2)'},{damage:'min(1, 2, 3)'},
  {damage:'max(1, abs(-2))'},{damage:'ceil(self.hp / 2)'},
  {energy:1,when:'cards_played_this_turn % 3 == 0'},
  {block:1,when:'self.has_summon && !opponent.has_ally'},
  {damage:'opponent.status.corrosion.stacks'},
  {damage:'self.resource.charge.current'},{damage:'10 + (self.hp < self.max_hp ? 2 : 0)'}];
for(const value of good){const result=core.compileCompactEffectList(value);assert.equal(result.ok,true,JSON.stringify({value,result}));}
for(const value of [{damage:'Math.floor(self.hp / 2)'},{damage:'summon_count'},
  {damage:'self.opponent.hp'},{damage:'enemy_summon_count'},{damage:'slot_count'},
  {block:1,when:'self.has_summon()'},{block:1,when:'self.has_status("x")'},
  {block:1,when:'true'},{block:1,when:'1'}]){
  assert.equal(core.compileCompactEffectList(value).ok,false,JSON.stringify(value));
}
console.log('PASS shared concise formula reference and rendered example against the actual compact compiler; no model-quality claim.');
