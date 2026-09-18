import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {inspectInitialRequirementCandidates:inspect}=require('../src/game-core/initialRequirementCoverage.ts');
const probes=[{id:'gain',kind:'resource_accumulate',actor:'player'},{id:'spend',kind:'resource_consume',actor:'player'},{id:'stance',kind:'stance_entry',actor:'player'}];
const snapshot=structuredClone(probes);
for(const [n,version,expected] of [[100,183,['candidate_present_unverified','candidate_present_unverified','candidate_present_unverified']],[105,192,['candidate_present_unverified','missing_candidate','missing_candidate']]]){
 const path=`tmp/initial${n}-final-browser-v${version}.json`,bytes=readFileSync(path),capture=JSON.parse(bytes);
 const draft=JSON.parse(capture.evidence.find(e=>e.stage==='normalized-draft').text),before=structuredClone(draft);
 const result=inspect(draft,probes);
 assert.deepEqual(result.results.map(r=>r.status),expected);
 assert.equal(result.overallVerified,false);
 assert.deepEqual(draft,before);assert.deepEqual(readFileSync(path),bytes);
 console.log(JSON.stringify({sample:n,results:result.results,overallVerified:false}));
}
const fixture=()=>({spec:'mwg.initial-draft/v1',narrative:'story',player:{core:{},cards:[]},opening:{choices:[]},registry:{statuses:[],templates:[],resources:[{id:'r',name:'资源',emoji:'R',start:0,max:10,refresh:'retain'}]}});
for(const [n,continuation] of [[103,'candidate_present_unverified'],[107,'missing_candidate']]){
 const path=`tmp/initial${n}-final-browser-v192.json`,bytes=readFileSync(path),capture=JSON.parse(bytes);
 const draft=JSON.parse(capture.evidence.find(e=>e.stage==='normalized-draft').text);
 const result=inspect(draft,[{id:'generate',kind:'card_generation',actor:'player'},{id:'continue',kind:'discard_or_recover',actor:'player'}]);
 assert.deepEqual(result.results.map(r=>r.status),['candidate_present_unverified',continuation]);
 assert.equal(result.overallVerified,false,'two sites are not proof they compose into a loop');
 if(n===103){
  // Frozen103 requires discard AND recovery;107 explicitly allows either.
  // Do not replace the original103 requirement with the weaker union probe.
  const separate=inspect(draft,[{id:'discard',kind:'discard',actor:'player'},{id:'recover',kind:'recover',actor:'player'}]);
  assert.equal(separate.results[0].status,'candidate_present_unverified');
  assert.deepEqual(separate.results[1].candidates,[]);
  assert.equal(separate.results[1].status,separate.unexpandedPaths.length?'unverified':'missing_candidate');
  assert.equal(separate.overallVerified,false);
  console.log(JSON.stringify({sample:n,requestLogic:'discard AND recover',separate:separate.results,unexpanded:separate.unexpandedPaths}));
 }
 assert.deepEqual(readFileSync(path),bytes);
 console.log(JSON.stringify({sample:n,results:result.results,overallVerified:false}));
}
assert.ok(inspect({},probes).results.every(r=>r.status==='unverified'),'bad envelope is not missing-mechanic evidence');
let d=fixture();d.player.cards=[{id:'read',effects:{damage:'self.resource.r.current'},description:'消耗资源并进入姿态'}];
assert.ok(inspect(d,probes).results.every(r=>r.status==='missing_candidate'),'prose and reads do not satisfy sites');
d.player.cards[0].effects={resource:{id:'r',amount:'1 - self.resource.r.current'}};
assert.equal(inspect(d,probes).results[1].status,'candidate_present_unverified','unknown formula sign is never rejected as definitely nonconsuming');
d.player.cards[0].effects={set_resource:{id:'r',value:5}};
assert.equal(inspect(d,probes).results[1].status,'candidate_present_unverified','assignment is not proof of payment');
d=fixture();d.opening.choices=[{outcome:{reward:{cards:[{id:'gift',effects:{stance:{id:'s'}}}]}}}];
assert.equal(inspect(d,probes).results[2].status,'missing_candidate','unclaimed reward does not satisfy held-root obligation');
d.player.cards=[{id:'external',effects:{resource:{id:'r',amount:-2},to:'opponent'}}];
assert.equal(inspect(d,probes).results[1].status,'missing_candidate','opponent consumption cannot supply player obligation');
assert.deepEqual(probes,snapshot);
// A request for BOTH discard and recovery needs two independent probes.
// The old union remains useful only for a genuinely disjunctive requirement.
const both=[{id:'discard',kind:'discard',actor:'player'},{id:'recover',kind:'recover',actor:'player'}];
d=fixture();d.player.cards=[{id:'discard_only',effects:{discard:1,from:'hand',pick:'choose'}}];
assert.deepEqual(inspect(d,both).results.map(r=>r.status),['candidate_present_unverified','missing_candidate']);
d.player.cards=[{id:'recover_only',effects:{recover:1,from:'discard',pick:'choose'}}];
assert.deepEqual(inspect(d,both).results.map(r=>r.status),['missing_candidate','candidate_present_unverified']);
d.player.cards[0].effects=[{discard:1,from:'hand',pick:'choose'},{recover:1,from:'discard',pick:'choose'}];
assert.ok(inspect(d,both).results.every(r=>r.status==='candidate_present_unverified'));
assert.equal(inspect(d,both).overallVerified,false,'presence of both operations does not prove a working loop');
d=fixture();
d.registry.statuses=[{id:'indirect',triggers:{apply:{summoner_effects:{resource:{id:'r',amount:-2}}}}}];
d.player.cards=[{id:'give_summon_state',effects:{apply_summon_status:{selector:{owner:'self',pick:'all'},id:'indirect',stacks:1}}}];
assert.equal(inspect(d,probes).results[1].status,'unverified','unexpanded summon selector edge cannot prove absence of owner resource consumption');
d.player.cards=[{id:'spawn',effects:{spawn_summon:{id:'unit',name:'单位',emoji:'U',max_hp:8,actions:[{name:'打击',effects:{damage:2}}],status_effects:[{id:'indirect',stacks:1}]}}}];
assert.equal(inspect(d,probes).results[1].status,'unverified','initial summon statuses are not fully expanded by this audit');
d=fixture();d.registry.statuses=[{id:'release',triggers:{remove:{resource:{id:'r',amount:-2}}}}];
d.player.cards=[{id:'remove',effects:{remove_status:'release',to:'self'}}];
const removal=inspect(d,probes);
assert.equal(removal.results[1].status,'candidate_present_unverified','explicit status removal follows only its removal callback');
assert.deepEqual(removal.unexpandedPaths,[]);
assert.deepEqual(removal.results[1].candidates[0].path,['registry','statuses',0,'triggers','remove','resource']);
d.player.cards.push({id:'pay',cost:{r:2},effects:{block:3}});
assert.equal(inspect(d,probes).results[1].status,'candidate_present_unverified','unexpanded relation does not erase a known candidate or prove coverage');
d.player.cards=[];
assert.equal(inspect(d,probes).results[1].status,'missing_candidate','unreferenced registry removal callback is not an active root');
d=fixture();d.registry.statuses=[{id:'release',triggers:{apply:{recover:1,from:'discard'},remove:{block:1}}}];
d.player.cards=[{id:'remove',effects:{remove_status:'release',to:'self'}}];
assert.equal(inspect(d,[both[1]]).results[0].status,'missing_candidate','removal must not activate apply or other lifecycle effects');
d.registry.statuses[0].triggers.remove=[{recover:1,from:'discard'},{remove_status:'release',to:'self'}];
const cycle=inspect(d,[both[1]]);
assert.equal(cycle.results[0].status,'candidate_present_unverified');
assert.equal(cycle.structurallyTruncated,false,'remove callback cycle must terminate');
d.player.cards[0].effects={remove_status:'all',to:'self'};
assert.equal(inspect(d,[both[1]]).results[0].status,'unverified','wildcard removal still needs holder-state expansion');
d=fixture();d.player.cards=[{id:'enemy',effects:{spawn_enemy:{id:'enemy',name:'敌人',actions:[{effects:{resource:{id:'r',amount:-2},to:'opponent'}}]}}}];
assert.equal(inspect(d,probes).results[1].status,'unverified','spawned actor target mapping is not complete enough to prove missing player effects');
console.log('PASS independent request probes detect missing structural candidates; present candidates remain unverified, no runtime gate or AI-authored obligation trust.');
