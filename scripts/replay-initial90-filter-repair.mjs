import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets:plan,parseTowerInitialSlotRepairResponse:parse}=require('../src/sillytavern-extension/controller.ts');
const {parseStructuredRecord}=require('../src/sillytavern-extension/structuredRecord.ts');
const path='tmp/initial90-final-browser-v173.json',bytes=readFileSync(path),capture=JSON.parse(bytes);
const evidence=capture.evidence.find(e=>e.stage==='compiled-result');assert.ok(evidence&&!evidence.truncated);
const original=parseStructuredRecord(evidence.text),status=original.player.statuses.find(s=>s.id==='wind_reading');
assert.equal(status.triggers.attack_played.scope,'turn');assert.equal(status.triggers.attack_played.ordinal,'first');
const error=capture.monitor.timeline.find(e=>e.detail?.includes('triggers.attack_played.ordinal')).detail;
assert.deepEqual(plan(original,error),[],'new planner refuses the unsafe effect-only rewrite before an additional request');
const response=parseStructuredRecord(capture.monitor.rawOutput);
const persisted=capture.root.stat_data.battle.statuses.find(s=>s.id==='wind_reading');
assert.deepEqual(persisted.triggers.attack_played,response.roots.r0.slots.s1.value,'the recorded AI repair itself removed the filter');
const stale=[{token:'r0',kind:'player_status',path:'player.statuses[1]',slots:[
 {token:'s0',kind:'description',action:'replace_value',path:'player.statuses[1].description',relativePath:'description',original:status.description},
 {token:'s1',kind:'status_trigger_effect_sequence',action:'replace_effect_sequence',path:'player.statuses[1].triggers.attack_played',relativePath:'triggers.attack_played',original:status.triggers.attack_played},
]}];
assert.throws(()=>parse(response,stale),/事件筛选语义/,'captured historical bad repair is now rejected even with its old slot plan');
assert.deepEqual(readFileSync(path),bytes);
console.log(JSON.stringify({result:'PASS',sha256:createHash('sha256').update(bytes).digest('hex'),
 scope:'Offline replay: unsafe planning prevented and captured bad repair rejected; original evidence unchanged. No new model calls or improved generation-rate claim.'}));
