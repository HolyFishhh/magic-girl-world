import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets:plan,parseTowerInitialSlotRepairResponse:parse,mergeTowerInitialSlotRepair:merge}=require('../src/sillytavern-extension/controller.ts');
const file='tmp/initial94-final-browser-v176.json',bytes=readFileSync(file),capture=JSON.parse(bytes);
const original=JSON.parse(capture.evidence.find(e=>e.stage==='compiled-result').text);
const targets=plan(original,capture.monitor.detail);
assert.equal(targets.length,1,'root condition diagnostic must resolve to authored root field');
assert.equal(targets[0].slots.length,1);
const slot=targets[0].slots[0];assert.equal(slot.kind,'lust_condition');assert.equal(slot.path,'player.player_lust_effect.when');
assert.equal(plan(original,'battle.player_lust_effect.when：非法公式')[0].slots[0].kind,'lust_condition','direct diagnostics use the same non-deletable leaf');
for(const path of ['battle.player_lust_effect.when.left','battle.player_lust_effect.effects.when.left']){
 const roots=plan(original,`${path}：公式引用了不支持的变量`);
 assert.equal(roots.length,1);assert.equal(roots[0].slots.length,1);
 assert.equal(roots[0].slots[0].kind,'lust_condition');
 assert.equal(roots[0].slots[0].path,'player.player_lust_effect.when');
}
const reply=value=>({spec:'mwg.tower-initial-slot-repair/v1',roots:{[targets[0].token]:{slots:{[slot.token]:{action:slot.action,value}}}},support_statuses:[],support_resources:[]});
for(const value of [null,'',true,'欲望满溢时','true','self.hp'])assert.throws(()=>parse(reply(value),targets));
// Synthetic formula tests write scope only; not a model-authored semantic fix.
const formula='opponent.lust >= opponent.max_lust';
const fixed=merge(original,targets,parse(reply(formula),targets));
const expected=structuredClone(original);expected.player.player_lust_effect.when=formula;assert.deepEqual(fixed,expected);
const ambiguous=structuredClone(original);ambiguous.player.player_lust_effect.effects.when='bad_nested';
const ambiguousTargets=plan(ambiguous,capture.monitor.detail);
assert.ok(!ambiguousTargets.some(r=>r.slots.some(s=>s.kind==='lust_condition')),'do not remap a real nested field');
assert.ok(!plan(ambiguous,'battle.player_lust_effect.effects.when.left：公式引用了不支持的变量').some(r=>r.slots.some(s=>s.kind==='lust_condition')),'a missing AST subpath does not make a real nested when absent');
assert.deepEqual(readFileSync(file),bytes);
console.log('PASS historical94 root condition maps to one required formula leaf; deletion/prose rejected; all other authored data and evidence unchanged. Offline scope test, not gameplay or semantic acceptance.');
