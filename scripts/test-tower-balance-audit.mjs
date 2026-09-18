import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url); process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'}); require('ts-node/register/transpile-only');
const {compactTowerBalanceAudit}=require('../src/runtime/towerBalanceAudit.ts');
const measurement={damageByTurn:[10,20,30,40,50],defensePerTurn:2,status:'measured',decisionCoverage:'bounded'};
const evaluation={status:'measured',trials:[{outcome:'victory',hpLost:3,blocked:1,turns:2}],seeds:[1],engine:'production-battle-runtime',decisionCoverage:'bounded',policies:[]};
const base={evaluation,generatedBattle:{enemies:[{id:'a',max_hp:20,hp:20,actions:[{effects:{damage:4}}]}]},needsReview:false,hpScale:1,damageScale:1,changedPaths:[],feedback:[]};
const simple=compactTowerBalanceAudit(base,measurement,80,false); assert.ok(Number.isFinite(simple.playerDeckScore)); assert.ok(Number.isFinite(simple.finalEnemyScore));
const wounded=compactTowerBalanceAudit({...base,generatedBattle:{enemies:[{...base.generatedBattle.enemies[0],hp:2}]}},measurement,80,false);
assert.equal(simple.finalEnemyScore-wounded.finalEnemyScore,18,'actual starting HP, not maximum HP, determines encounter durability');
for(const [name,enemy] of Object.entries({heal:{id:'a',max_hp:20,actions:[{effects:{damage:4,heal:2}}]},lust:{id:'a',max_hp:20,lust:1,actions:[{effects:{damage:4}}]},reinforce:{id:'a',max_hp:20,actions:[{effects:{spawn_enemy:{id:'b'}}}]},control:{id:'a',max_hp:20,status_effects:[{id:'stun'}],actions:[{effects:{damage:4}}]},formula:{id:'a',max_hp:20,actions:[{effects:{damage:{op:'var',path:'self.hp'}}}]}})){const audit=compactTowerBalanceAudit({...base,generatedBattle:{enemies:[enemy]}},measurement,80,false);assert.equal(audit.finalEnemyScore,undefined,name);assert.equal(audit.playerDeckScore,undefined,name);assert.equal(audit.scoreAssessment,'complex-mechanics-not-comparable',name);assert.ok(audit.scoreLimitations.length,name)}
const limited=compactTowerBalanceAudit({...base,evaluation:{...evaluation,decisionCoverage:'limited'}},measurement,80,false);assert.equal(limited.finalEnemyScore,undefined);assert.equal(limited.scoreAssessment,'not-measured');
const uncovered=compactTowerBalanceAudit(base,{...measurement,decisionCoverage:'limited'},80,false);assert.equal(uncovered.finalEnemyScore,undefined);
console.log('Tower balance audit only scores literal HP/direct-damage rosters.');
