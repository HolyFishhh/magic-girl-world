import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const {projectStatusThroughNextTurn:project}=require('../src/game-core/statusDurationProjection.ts');
const {auditInitialSemanticStructure:audit}=require('../src/game-core/initialSemanticAudit.ts');
for(const [input,stacks]of [[{incomingStacks:1,stacksChange:-1},0],[{incomingStacks:2,stacksChange:-1},1],[{incomingStacks:2,maxStacks:1,stacksChange:-1},0],[{incomingStacks:1,currentStacks:1,stacksChange:-1},1],[{incomingStacks:3,stacksChange:'reset'},0],[{incomingStacks:1,stacksChange:'keep'},1],[{incomingStacks:1,stacksChange:'x0.5'},0],[{incomingStacks:0,stacksChange:2},0]]){
 const before=structuredClone(input),r=project(input);assert.equal(r.projected,true);assert.equal(r.afterTurnEnd,stacks);assert.equal(r.presentAtNextTurnStart,stacks>0);assert.equal(r.wholeCombatVerified,false);assert.deepEqual(input,before);
}
for(const input of [{incomingStacks:'stacks'},{incomingStacks:NaN},{incomingStacks:1,stacksChange:'unknown'},{incomingStacks:1,maxStacks:-1}])assert.equal(project(input).projected,false);
const bytes=readFileSync('tmp/initial143-final-browser-v249.json'),sample=JSON.parse(bytes),draft=JSON.parse(sample.evidence.find(e=>e.stage==='normalized-draft').text),before=structuredClone(draft);
const r=audit(draft).isolatedStatusTiming.find(x=>x.statusId==='starlight_blessing');assert.ok(r);assert.equal(r.projection.presentAtNextTurnStart,false);
assert.deepEqual(draft,before);
const card=draft.player.cards.find(c=>c.id==='starlight_pact');card.effects={schedule:1,phase:'turn_start',effects:card.effects};
assert.equal(audit(draft).isolatedStatusTiming.some(x=>x.statusId==='starlight_blessing'),false,'scheduled application must not inherit action-phase assumption');
console.log('PASS runtime-derived isolated status duration projection; cap/stack/reset/keep/multiplier/zero boundaries; real143 warning and scheduled-path exclusion, no mutation or reachability claim.');
