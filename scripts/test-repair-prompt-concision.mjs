import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const core=require('../src/game-core/towerRequest.ts');
const error='battle.enemies[0].actions[0].effects[0]: Unknown field: foo';
const guide=core.formatCompactEffectRepairContract(error),contract=core.formatCompactEffectAuthoringContract();
const job=kind=>({nodeId:`test_${kind}`,requestId:`request_${kind}`,basedOnRevision:0,kind,act:1,floor:2,contentSeed:1,rewardSeed:2,difficultyMultiplier:1});
const counts=(text,needle)=>text.split(needle).length-1;
const results=[];
for(const kind of ['battle','elite','boss','event','shop','treasure','rest']){
 const scope=job(kind),text=core.formatTowerNodeStructureRepairPrompt(scope,'ORIGINAL_RESPONSE_UNCHANGED',error);
 assert.equal(counts(text,guide),kind==='rest'?0:1,`${kind}: error guide appears once, not both before and after source`);
 assert.equal(counts(text,contract),kind==='rest'?0:1,`${kind}: full common contract retained once`);
 assert.equal(counts(text,'ORIGINAL_RESPONSE_UNCHANGED'),1);
 assert.ok(text.includes(scope.nodeId)&&text.includes(scope.requestId));
 results.push({kind,characters:text.length});
}
for(const jobs of [[job('battle'),job('event')],[job('shop'),job('treasure')],[job('rest')]]){
 const text=core.formatTowerNodeBatchStructureRepairPrompt('fixed_batch',jobs,'ORIGINAL_RESPONSE_UNCHANGED',error),hasMechanics=jobs.some(j=>j.kind!=='rest');
 assert.equal(counts(text,guide),hasMechanics?1:0);assert.equal(counts(text,contract),hasMechanics?1:0);
 assert.equal(counts(text,'ORIGINAL_RESPONSE_UNCHANGED'),1);for(const j of jobs)assert.ok(text.includes(j.nodeId)&&text.includes(j.requestId));
}
console.log(JSON.stringify({passed:true,results,errorGuideCharacters:guide.length,scope:'Full contract, exact rejected payload and request identity retained; duplicate delivery removed, not repair rules.'}));
