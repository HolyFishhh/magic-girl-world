import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {compileCompactEffectList,executeEffectProgram}=require('../src/game-core/index.ts');
const state=hp=>({self:{hp,maxHp:20,lust:0,maxLust:100,energy:3,maxEnergy:3,block:0},opponent:{hp:100,maxHp:100,lust:0,maxLust:100,energy:0,maxEnergy:0,block:0},currentTurn:1});
const cases=[
 ['6 + (self.hp < 10 ? 6 : 0)',12,6],
 ['2 * (self.hp < 10 ? 7 : 3) - 1',13,5],
 ['abs(-(self.hp < 10 ? 8 : 4))',8,4],
 ['floor((self.hp < 10 ? 9 : 5) / 2)',4,2],
 ['max(1, self.hp < 10 ? 7 : 3) + min(2, self.hp < 10 ? 4 : 1)',9,4],
 ['(self.hp < 10 ? 2 : 3) * (self.energy > 1 ? 4 : 5)',8,12],
 ['self.hp < 10 ? 2 + (self.energy > 1 ? 3 : 4) : 9',5,9],
 ['self.hp < 10 ? 5 : 1 / (self.hp < 10 ? 0 : 2)',5,0.5],
];
for(const [formula,low,high] of cases){
 const input={damage:formula},before=structuredClone(input),compiled=compileCompactEffectList(input);
 assert.equal(compiled.ok,true,JSON.stringify(compiled.issues));assert.deepEqual(input,before);
 for(const [hp,expected] of [[5,low],[20,high]]){
  const result=executeEffectProgram(compiled.value,state(hp),{spentEnergy:0});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(100-result.state.opponent.hp,expected,formula);
 }
}
// Each condition is resolved before exactly one resource mutation: no branch
// may re-test against the value changed by an earlier duplicated command.
const once=compileCompactEffectList({energy:'1 + (self.energy == 3 ? 1 : 0)'});
assert.equal(once.ok,true);assert.equal(executeEffectProgram(once.value,state(20),{spentEnergy:0}).state.self.energy,5);
for(const input of [{damage:'Math.floor(self.hp < 10 ? 8 : 4)'},{damage:'min()'},
 {damage:'6 + (unknown ? 2 : 0)'},{damage:'6 + (self.hp < 10 ? nope() : 0)'},
 {block:1,when:'self.hp < 10 ? true : false'}])assert.equal(compileCompactEffectList(input).ok,false,JSON.stringify(input));
const explosive=Array(7).fill('(self.hp < 10 ? 1 : 2)').join('+');
const bounded=compileCompactEffectList({damage:Array(4).fill('(self.hp < 10 ? 1 : 2)').join('+')});
assert.equal(bounded.ok,true,JSON.stringify(bounded.issues));
assert.equal(100-executeEffectProgram(bounded.value,state(5),{spentEnergy:0}).state.opponent.hp,4);
const totalBudget=compileCompactEffectList({damage:Array(6).fill('(self.hp < 10 ? 1 : 2)').join('+')});
assert.equal(totalBudget.ok,false);assert.ok(totalBudget.issues.some(i=>i.code==='TOO_MANY_NODES'),'existing whole-program budget still applies');
const rejected=compileCompactEffectList({damage:explosive});
assert.equal(rejected.ok,false);assert.ok(rejected.issues.some(i=>i.code==='CEL_TOO_COMPLEX'));
console.log('PASS nested numeric choices: arithmetic, functions, multiple choices, lazy branch, single mutation, invalid syntax, bounded expansion, no input changes.');
