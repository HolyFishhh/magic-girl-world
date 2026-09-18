import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const {startCombatActionTiming}=require('../src/fish/ui/combatActionTiming.ts');
for(const crossing of [true,false]) for(const reducedMotion of [false,true]) {
 const timers=[];let frame,started=false,cleaned=false,hit=false,finished=false;
 const clock=startCombatActionTiming({crossing,reducedMotion,frame:cb=>{frame=cb},delay:(cb,ms)=>timers.push({cb,ms}),start:()=>{started=true},cleanup:()=>{cleaned=true}});
 clock.impact.then(()=>{hit=true});clock.finished.then(()=>{finished=true});
 assert.equal(started,false);assert.equal(timers.length,0);frame();assert.equal(started,true);
 timers.sort((a,b)=>a.ms-b.ms);assert.ok(timers[0].ms<timers[1].ms);
 assert.equal(timers[0].ms,reducedMotion?0:crossing?520*.72:720*.24);
 timers[0].cb();await Promise.resolve();assert.equal(hit,true);assert.equal(cleaned,false);assert.equal(finished,false);
 timers[1].cb();await clock.finished;assert.equal(cleaned,true);assert.equal(finished,true);
}
console.log('PASS contact releases gameplay before cleanup, shared CSS clock, aura/crossing/reduced motion');
