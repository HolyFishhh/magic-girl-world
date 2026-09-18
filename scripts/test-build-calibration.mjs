import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url);process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const {measureTowerBuild}=require('../src/runtime/towerRuntimeBalance.ts');
const {calibrateBuildCase,BUILD_REFERENCE_CASES}=require('../src/game-core/buildCalibration.ts');
globalThis.getVariables=()=>{throw Error('must not read live save')};globalThis.replaceVariables=()=>{throw Error('must not write live save')};
const battle=hp=>({core:{hp:60,max_hp:60,lust:0,max_lust:100},cards:[{id:'wall',name:'援护',type:'Skill',rarity:'Common',cost:0,quantity:1,exhaust:true,effects:{spawn_summon:{id:'wall',name:'护卫',emoji:'🛡',max_hp:hp,actions:[{id:'wait',name:'等待',effects:{wait:true}}]}}}],statuses:[],artifacts:[],items:[]});
const results={};for(const [name,hp] of [['low',1],['high',100],['bypass',100]]) {const b=battle(hp);if(name==='bypass')b.cards[0].effects.spawn_summon.capabilities={intercepts:false};const before=JSON.stringify(b);const m=await measureTowerBuild(b,1);assert.equal(JSON.stringify(b),before);assert.equal(m.status,'measured',JSON.stringify(m));assert.equal(m.evidence.length,BUILD_REFERENCE_CASES.length);assert.equal(m.calibration.cases.length,BUILD_REFERENCE_CASES.length);results[name]=m;}
const score=(m,i=0)=>m.calibration.cases[i].policies.find(p=>p.policy==='survival').survival;
assert.ok(score(results.high)>score(results.low));assert.ok(score(results.high)>score(results.bypass));assert.ok(results.high.defensePerTurn>results.bypass.defensePerTurn);
assert.equal(results.high.calibration.cases[3].turns,6);assert.equal(results.high.evidence[3].trials[0].summonHpLost,72,'burst must attack on turns1/4 only');
assert.ok(score(results.high,4)<score(results.high,0),'finite summon HP must run out under endurance pressure');
const roundtrip=await measureTowerBuild(JSON.parse(JSON.stringify(battle(100))),1);assert.deepEqual(roundtrip,results.high);
const invalid=structuredClone(results.high.evidence[0]);invalid.trials[0].outcome='inconclusive';assert.equal(calibrateBuildCase(BUILD_REFERENCE_CASES[0],invalid,60).policies[0].survival,null);
fs.writeFileSync('tmp/v460-calibration.json',JSON.stringify(results,null,2));console.log('5 fixed scenarios, actual summon HP/expiry/bypass, defense net loss, burst sequence, input immutability, JSON round trip and missing evidence passed.');

const {evaluateIsolatedEncounter}=require('../src/runtime/isolatedEncounterEvaluator.ts');
const runReference=async(maxHp,effect)=>{const b=battle(1);b.core.hp=maxHp;b.core.max_hp=maxHp;b.cards=[{id:'utility',name:'基准技能',type:'Skill',rarity:'Common',cost:0,quantity:1,effects:effect}];b.enemies=[{id:'pressure',name:'固定压力',hp:400,max_hp:400,lust:0,max_lust:100,actions:[{id:'attack',name:'攻击',effects:{damage:12}}]}];return evaluateIsolatedEncounter({battle:b,seeds:1,policies:['survival'],maxTurns:5,search:'one_turn',maxSearchDecisions:4,maxCandidateBranches:8});};
const naked=await runReference(120,{wait:true}),guard=await runReference(120,{block:12}),healer=await runReference(120,{heal:12,to:'self'});
assert.equal(naked.trials[0].hpLost,60,'more player maxHP must not increase reference attack');
assert.equal(guard.trials[0].hpLost,0);assert.ok(healer.trials[0].hpRemaining>naked.trials[0].hpRemaining);
assert.equal(calibrateBuildCase(BUILD_REFERENCE_CASES[0],naked,120).policies.find(p=>p.policy==='survival').survival,50);
console.log('Fixed absolute pressure, block and healing use actual runtime health, not hand-authored bonuses.');
