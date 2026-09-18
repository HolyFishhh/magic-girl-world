import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {auditInitialSemanticStructure:audit}=require('../src/game-core/initialSemanticAudit.ts');
const fixture=()=>({spec:'mwg.initial-draft/v1',narrative:'not a rule',player:{core:{},cards:[{id:'gain',effects:{resource:{id:'charge',amount:1}}}]},opening:{choices:[]},registry:{statuses:[],templates:[],resources:[{id:'charge',name:'充能',emoji:'⚡',start:0,max:5,refresh:'retain'}]}});
const missing=d=>audit(d).observations.filter(o=>o.code==='NO_OWNED_RESOURCE_USE');
let d=fixture(),before=structuredClone(d);assert.equal(missing(d).length,1);assert.deepEqual(d,before);
for(const effects of [{damage:'self.resource.charge.current'},{block:3,when:'self.resource.charge.current > 1'},{guard:'self.resource.charge.current > 0',effects:[{draw:1}]},{resource:{id:'charge',amount:-1}}]){
 d=fixture();d.player.cards.push({id:'use',effects});assert.equal(missing(d).length,0,'read/condition/guard/negative delta are potential uses without forcing payment');
}
for(const cost of [{energy:1,charge:2},{charge:'all'}]){d=fixture();d.player.cards.push({id:'use',cost,effects:{damage:3}});assert.equal(missing(d).length,0);}
d=fixture();d.player.cards[0].cost={charge:0};assert.equal(missing(d).length,1,'zero cost does not use accumulated stock');
d=fixture();d.player.cards[0].description='self.resource.charge.current';assert.equal(missing(d).length,1,'display text is not executable');
d=fixture();d.player.cards.push({id:'quoted',effects:{block:"'self.resource.charge.current' == 'x' ? 2 : 3"}});assert.equal(missing(d).length,1,'literal text is not a resource read');
d=fixture();d.player.cards.push({id:'other',effects:{damage:'opponent.resource.charge.current'}});assert.equal(missing(d).length,1,'opponent stock is not player stock');
d=fixture();d.player.cards.push({id:'max',effects:{damage:'self.resource.charge.max'}});assert.equal(missing(d).length,1,'fixed capacity does not use accumulated stock');
d=fixture();d.opening.choices=[{outcome:{reward:{cards:[{id:'later',cost:{charge:1},effects:{damage:5}}]}}}];assert.equal(missing(d).length,1,'unclaimed reward is not current ownership');
d=fixture();d.registry.templates=[{id:'use',cost:{charge:1},effects:{damage:3}}];assert.equal(missing(d).length,1);d.player.cards.push({id:'generate',effects:{add_card:'use'}});assert.equal(missing(d).length,0,'follow actual owned template references');
d=fixture();d.player.cards.push({id:'spawn',effects:{spawn_summon:{id:'pet',actions:[{effects:{damage:3}}]}}});assert.equal(missing(d).length,1,'expanded summon without a player-resource use cannot mask the observation');assert.equal(audit(d).unexpandedPaths.length,0);
d=fixture();d.player.cards=[];d.registry.resources[0].start=2;assert.equal(missing(d).length,1,'initial stock can also lack a use');d.registry.resources[0].start=0;assert.equal(missing(d).length,0,'unused empty registration does not establish a supplied resource');
d=fixture();d.player.cards.push({id:'bounded',effects:{block:'self.resource.charge.current'+' '.repeat(100001)}});assert.equal(audit(d).truncated,true);assert.equal(missing(d).length,0,'bounded-out input cannot prove absence');
console.log('PASS resource use observation: owned paths, AST reads, payment/signs, reward and actor boundaries; no rejection, mutation, inferred benefit or model calls.');
