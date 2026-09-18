import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {auditInitialSemanticStructure:audit}=require('../src/game-core/initialSemanticAudit.ts');
const fixture=()=>({spec:'mwg.initial-draft/v1',narrative:'story',player:{core:{},cards:[{id:'read',effects:{block:"self.stance == 'tuning' ? 10 : 5"}}]},opening:{choices:[]},registry:{statuses:[],resources:[],templates:[]}});
const guarded=fixture();
guarded.player.cards[0].effects={guard:"self.stance == 'tuning'",effects:[{resource:{id:'charge',amount:-2},to:'self'},{draw:1}]};
guarded.registry.resources=[{id:'charge',name:'充能',emoji:'⚡',start:2,max:3,refresh:'retain'}];
const guardedBefore=structuredClone(guarded),guardedAudit=audit(guarded);
assert.ok(guardedAudit.facts.some(f=>f.kind==='stance_read'&&f.path.at(-1)==='guard'&&f.actor==='player'));
assert.ok(guardedAudit.facts.some(f=>f.kind==='resource_delta'&&f.id==='charge'&&f.value===-2&&f.actor==='player'));
assert.deepEqual(guarded,guardedBefore);
let d=fixture(),snapshot=structuredClone(d),r=audit(d);
assert.deepEqual(d,snapshot,'audit must never mutate authored mechanics');
assert.deepEqual(r.observations,[{code:'NO_LOCAL_STANCE_ENTRY',path:['player','cards',0,'effects','block'],actor:'player',id:'tuning'}]);
assert.equal(r.references.length,0);
d=fixture();d.player.core.stance={id:'tuning'};assert.equal(audit(d).observations.length,0);
d=fixture();d.player.cards.push({id:'enter',effects:{stance:{id:'tuning'}}});assert.equal(audit(d).observations.length,0);
d=fixture();d.player.cards[0].effects.block="self.stance != 'tuning' ? 10 : 5";assert.equal(audit(d).observations.length,0,'negative comparison not mislabeled as requiring an entry');
d=fixture();d.player.cards[0].effects.block="opponent.stance == 'tuning' ? 10 : 5";assert.equal(audit(d).observations.length,0,'enemy behavior outside initial player graph');
d=fixture();d.opening.choices=[{id:'gift',outcome:{reward:{cards:[{id:'enter',effects:{stance:{id:'tuning'}}}]}}}];assert.equal(audit(d).observations.length,1,'unclaimed reward is not an initial entry');
d=fixture();d.registry.statuses=[{id:'unused',triggers:{turn_start:{stance:{id:'tuning'}}}}];assert.equal(audit(d).observations.length,1,'unreferenced definition is not active');
d.player.cards.push({id:'apply',effects:{apply_status:'unused',to:'self'}});r=audit(d);assert.equal(r.observations.length,0);assert.ok(r.edges.some(e=>e.to.join('.')==='registry.statuses.0'));
d=fixture();d.registry.templates=[{id:'entry',effects:{stance:{id:'tuning'}}}];d.player.cards.push({id:'generate',effects:{add_card:'entry'}});assert.equal(audit(d).observations.length,0);

d=fixture();d.registry.statuses=[{id:'outer',triggers:{apply:{apply_status:'inner'}}},{id:'inner',triggers:{turn_start:{stance:{id:'tuning'}}}}];
d.player.cards.push({id:'apply',effects:{apply_status:'outer'}});
r=audit(d);
assert.equal(r.observations.length,1,'ordinary omitted apply_status targets opponent, not player');
assert.ok(r.edges.every(e=>e.actor==='opponent'),'nested status omitted targets stay on the precise holder');
d.player.cards[1].effects.to='self';r=audit(d);
assert.equal(r.observations.length,0);
assert.ok(r.edges.every(e=>e.actor==='player'));
d.registry.statuses[0].triggers.apply.to='opponent';r=audit(d);
assert.equal(r.observations.length,1,'explicit opponent in a player-held status changes holder');
d.registry.statuses[0].triggers.apply={add_card:'generated'};
d.registry.templates=[{id:'generated',effects:{apply_status:'inner'}}];
r=audit(d);
assert.equal(r.observations.length,1,'generated ordinary card does not inherit status-holder targeting');
assert.ok(r.edges.some(e=>e.from.join('.')==='registry.templates.0.effects.apply_status'&&e.actor==='opponent'));
d=fixture();d.player.cards.push({id:'summon',effects:{spawn_summon:{id:'pet',actions:[{effects:{stance:{id:'tuning'}}}]}}});r=audit(d);
assert.ok(!r.facts.some(f=>f.kind==='stance_entry'&&f.actor==='player'),'summon stance is not player stance');
assert.equal(r.observations.length,1,'a summon entering its own stance does not supply a player entry');
assert.equal(r.unexpandedPaths.length,0,'inline summon graph is expanded with distinct ownership');
d=fixture();d.player.cards.push({id:'apply',effects:{apply_status:'missing'}});assert.ok(audit(d).references.some(e=>e.code==='UNKNOWN_STATUS_REF'));
d=fixture();d.registry.statuses=[{id:'loop',triggers:{turn_start:{apply_status:'loop',to:'opponent'}}}];d.player.cards.push({id:'apply',effects:{apply_status:'loop'}});r=audit(d);assert.equal(r.truncated,false);assert.ok(r.edges.length<10,'opposing cyclic status contexts remain finite');
d=fixture();d.player.cards[0].description="self.stance == 'tuning'";d.player.cards[0].effects={block:4};assert.equal(audit(d).facts.length,0,'never parse description as executable');
assert.equal(audit({}).facts.length,0);
d=fixture();d.player.cards=[];
d.registry.statuses=[{id:'woven',triggers:{turn_end:{add_card:'scrap'}}}];
d.registry.templates=[{id:'scrap',effects:{discard:1,from:'hand',pick:'choose'}}];
assert.equal(audit(d).facts.length,0,'unused status/template cannot supply coverage evidence');
d.player.cards=[{id:'apply',effects:{apply_status:'woven'}}];
r=audit(d);
assert.ok(r.facts.some(f=>f.kind==='status_listener'&&f.id==='turn_end'));
assert.ok(r.facts.some(f=>f.kind==='card_generation'&&f.path.join('.')==='registry.statuses.0.triggers.turn_end.add_card'));
assert.ok(r.facts.some(f=>f.kind==='discard'&&f.path[1]==='templates'));
d.player.cards=[{id:'direct',effects:{add_card:'scrap'}}];
assert.ok(!audit(d).facts.some(f=>f.kind==='status_listener'),'direct generation does not activate unreferenced status listener');
d=fixture();d.player.cards=[{id:'read_only',effects:{damage:'7 + self.resource.pressure.current'}}];
d.registry.resources=[{id:'pressure',start:0,max:10,refresh:'retain'}];
const mutationSite=f=>['resource_payment','resource_delta','resource_set'].includes(f.kind);
assert.equal(audit(d).facts.filter(mutationSite).length,0,'reading a resource is not payment or mutation');
assert.deepEqual(audit(d).facts.filter(f=>f.kind==='resource_read'),[
 {kind:'resource_read',path:['player','cards',0,'effects','damage'],actor:'player',id:'pressure',resourceField:'current'},
]);
d.player.cards.push({id:'pay',cost:{energy:1,pressure:4},effects:[{resource:{id:'pressure',amount:2}},{resource:{id:'pressure',amount:'-self.resource.pressure.current'}},{set_resource:{id:'pressure',value:0},to:'opponent'}]});
snapshot=structuredClone(d);r=audit(d);
assert.deepEqual(r.facts.filter(mutationSite), [
 {kind:'resource_payment',path:['player','cards',1,'cost','pressure'],actor:'player',id:'pressure',value:4},
 {kind:'resource_delta',path:['player','cards',1,'effects',0,'resource'],actor:'player',id:'pressure',value:2},
 {kind:'resource_delta',path:['player','cards',1,'effects',1,'resource'],actor:'player',id:'pressure',value:'-self.resource.pressure.current'},
 {kind:'resource_set',path:['player','cards',1,'effects',2,'set_resource'],actor:'opponent',id:'pressure',value:0},
]);
assert.deepEqual(d,snapshot);
d=fixture();d.player.cards=[];
d.registry.templates=[{id:'pay_later',cost:{pressure:3},effects:{block:2}}];
d.registry.statuses=[{id:'unused',triggers:{turn_end:{resource:{id:'pressure',amount:-2}}}}];
d.opening.choices=[{id:'gift',outcome:{reward:{cards:[{id:'pay',cost:{pressure:5},effects:{block:5}}]}}}];
assert.equal(audit(d).facts.filter(f=>f.kind.startsWith('resource_')).length,0,'unselected rewards and unreachable definitions do not supply local resource sites');
d.player.cards=[{id:'generator',effects:{add_card:'pay_later'}}];
assert.ok(audit(d).facts.some(f=>f.kind==='resource_payment'&&f.path.join('.')==='registry.templates.0.cost.pressure'));
d=fixture();d.player.cards=[{id:'summon_writer',effects:{spawn_summon:{id:'writer',name:'抄写灵',max_hp:3,
  actions:[{id:'write',effects:{add_card:'clear_shard'}}]}}}];
d.registry.resources=[{id:'mind',name:'心智',emoji:'🧠',start:1,max:3,refresh:'retain'}];
d.registry.templates=[{id:'clear_shard',cost:{mind:1},effects:{add_card:'echo_shard'}},{id:'echo_shard',effects:{damage:'self.resource.mind.current'}}];
r=audit(d);
assert.ok(r.facts.some(f=>f.kind==='resource_payment'&&f.path.join('.')==='registry.templates.0.cost.mind'&&f.actor==='player'),
  'a summon-produced generated card pays from the player pool');
assert.ok(r.facts.some(f=>f.kind==='resource_read'&&f.path.join('.')==='registry.templates.1.effects.damage'&&f.actor==='player'),
  'nested generated cards also execute later as player cards');
console.log('PASS initial semantic evidence: held roots, status/template edges, reward isolation, resource sites without inferred consumption, polarity, actor separation, finite cycles, no mutation. Diagnostic only, not a readiness gate.');
