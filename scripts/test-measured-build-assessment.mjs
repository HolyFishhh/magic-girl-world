import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const {assessMeasuredBuild}=require('../src/game-core/buildAssessment.ts');const {BUILD_REFERENCE_CASES}=require('../src/game-core/buildCalibration.ts');
const trial=(seed,policy,extra={})=>({seed,policy,outcome:'horizon',turns:5,hpRemaining:70,damageDealt:40,cardsPlayed:10,deadTurns:1,lustDealt:0,horizons:[{turn:1,damage:8}],...extra});
const measurement=()=>({maxHp:70,evidence:BUILD_REFERENCE_CASES.map(()=>({seeds:[1,2],trials:['tempo','survival','engine'].flatMap(policy=>[trial(1,policy),trial(2,policy)])}))});
assert.equal(assessMeasuredBuild(null),null);let m=measurement();let r=assessMeasuredBuild(m);assert.equal(r.completed,8);assert.ok(Number.isFinite(r.score));assert.equal(r.dimensions.burst,'首回合伤害 8');
const original=JSON.stringify(m);assessMeasuredBuild(m);assert.equal(JSON.stringify(m),original);
m.evidence[0].trials=[];r=assessMeasuredBuild(m);assert.equal(r.score,null);assert.equal(r.completed,7);
for(const invalid of [NaN,Infinity]) {m=measurement();m.evidence[0].trials.forEach(row=>row.deadTurns=invalid);assert.equal(assessMeasuredBuild(m).score,null);}
m=measurement();m.evidence[0].trials.forEach(row=>row.seed=1);assert.equal(assessMeasuredBuild(m).score,null,'duplicate seeds must not masquerade as coverage');
m=measurement();m.evidence[0].trials.forEach(row=>row.seed+=10);assert.equal(assessMeasuredBuild(m).score,null,'wrong seed sets must not count');
m=measurement();m.maxHp=0;assert.equal(assessMeasuredBuild(m).score,null);
m=measurement();m.evidence.forEach(e=>e.trials.forEach(row=>row.outcome='victory'));r=assessMeasuredBuild(m);assert.equal(r.score,100);assert.ok(!r.recommendations.join('').includes('尚未稳定取胜'));
m=measurement();m.evidence[0].trials=[trial(1,'tempo',{outcome:'victory'}),trial(2,'tempo',{outcome:'defeat'}),trial(1,'survival',{damageDealt:200}),trial(2,'survival',{damageDealt:200})];r=assessMeasuredBuild(m);assert.equal(r.cases[0].best.policy,'survival');assert.deepEqual(r.cases[0].best.rows.map(row=>row.policy),['survival','survival']);
m=measurement();m.evidence.forEach(e=>e.trials.forEach(row=>{row.damageDealt=9999;row.outcome='defeat';}));assert.equal(assessMeasuredBuild(m).score,25);
console.log('PASS measured assessment full/partial/nonfinite/seed identity/consistent policy/victory/defeat/input immutability');

m=measurement();r=assessMeasuredBuild(m);assert.ok(r.recommendations.some(x=>x.includes('不是胜率')));assert.ok(!r.recommendations.join('').includes('指数公式'));assert.ok(r.methodology.length>0);

const measured = assessMeasuredBuild({ maxHp: 100, evidence: [
  { seeds: [1], trials: [{ policy: 'tempo', seed: 1, outcome: 'horizon', damageDealt: 50, hpRemaining: 60, cardsPlayed: 5, turns: 5, deadTurns: 0, lustDealt: 0, horizons: [{ turn: 1, damage: 4 }] }] },
  { seeds: [1], trials: [{ policy: 'tempo', seed: 1, outcome: 'victory', damageDealt: 100, hpRemaining: 80, cardsPlayed: 5, turns: 5, deadTurns: 0, lustDealt: 0, horizons: [{ turn: 1, damage: 4 }] }] },
  { seeds: [1], trials: [{ policy: 'tempo', seed: 1, outcome: 'victory', damageDealt: 100, hpRemaining: 80, cardsPlayed: 5, turns: 5, deadTurns: 0, lustDealt: 0, horizons: [{ turn: 1, damage: 4 }] }] },
], });
assert.ok(measured.cases[0].detail.includes('表现达成度'), 'measured score is explained as test attainment');
assert.ok(measured.cases[0].detail.includes('中位输出') && measured.cases[0].detail.includes('中位剩余生命'));
assert.ok(measured.cases[0].detail.includes('不把分量中位数相加'));
assert.ok(measured.methodology.some(value => value.includes('按达成度从高到低') && value.includes('总分')));
assert.ok(measured.methodology.some(value => value.includes('中位输出') && value.includes('中位剩余生命')));
assert.ok(measured.recommendations.some(value => value.includes('不是胜率')), 'assessment explicitly distinguishes attainment from win rate');

// A player can reconcile the headline without knowing the statistical term median.
m=measurement();m.evidence.forEach((entry,index)=>entry.trials.forEach(row=>{
 const ratio=(index+1)/10;row.damageDealt=BUILD_REFERENCE_CASES[index].hp*ratio;row.hpRemaining=m.maxHp*ratio;
}));r=assessMeasuredBuild(m);assert.equal(r.score,45);
assert.ok(r.recommendations[0].includes('40%和50%的平均值'));
assert.ok(r.recommendations[0].includes('本次总表现45%'));
