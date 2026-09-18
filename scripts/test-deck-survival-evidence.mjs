import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});require('ts-node/register/transpile-only');
const {evaluateIsolatedEncounter}=require('../src/runtime/isolatedEncounterEvaluator.ts');
globalThis.getVariables=()=>{throw Error('must not read player storage')};globalThis.replaceVariables=()=>{throw Error('must not mutate player storage')};
const battle=hp=>({core:{hp:60,max_hp:60,lust:0,max_lust:100},cards:[{id:'wall',name:'援护',type:'Skill',rarity:'Common',cost:0,quantity:1,exhaust:true,effects:{spawn_summon:{id:'wall',name:'护卫',emoji:'🛡',max_hp:hp,actions:[{id:'wait',name:'等待',effects:{wait:true}}]}}}],statuses:[],artifacts:[],items:[],enemies:[{id:'dummy',name:'压力',emoji:'◇',hp:10000,max_hp:10000,lust:0,max_lust:100,actions:[{id:'attack',name:'攻击',effects:{damage:12}}]}]});
const run=async b=>{const original=JSON.stringify(b);const result=await evaluateIsolatedEncounter({battle:b,seeds:1,policies:['survival'],maxTurns:5,search:'rollout'});assert.equal(JSON.stringify(b),original);assert.equal(result.status,'measured',JSON.stringify(result));return result.trials[0]};
const low=await run(battle(1)),high=await run(battle(100));
assert.ok(high.hpRemaining>low.hpRemaining,JSON.stringify({low,high}));
assert.ok(high.summonHpLost>low.summonHpLost);
assert.equal(high.hpLost,0);assert.equal(high.summonHpLost,60);assert.equal(high.summonHpRemaining,40);
assert.equal(high.blocked,0,'summon interception is not mislabeled player block');
assert.equal(high.horizons.at(-1).summonHpLost,60);
const noInterception=battle(100);noInterception.cards[0].effects.spawn_summon.capabilities={intercepts:false};
const bypass=await run(noInterception);assert.equal(bypass.summonHpLost,0);assert.ok(bypass.hpLost>high.hpLost,'HP without interception is not phantom player defense');
assert.deepEqual(await run(JSON.parse(JSON.stringify(battle(100)))),high,'JSON round trip keeps actual defense');
fs.writeFileSync('tmp/v459-summon-defense.json',JSON.stringify({low,high,bypass},null,2));console.log('Production survival evidence accounts for summon HP and disabled interception, with immutable input and JSON round trip.');


const {DesignAssistantEngine}=require('../src/sillytavern-extension/designEngine.ts');
const snapshot=new DesignAssistantEngine().createSnapshot({stat_data:{battle:battle(100)}},{},{});
assert.ok(snapshot);
assert.equal(snapshot.deckProfile.assessmentKind,'partial-shadow-estimate');
assert.match(snapshot.prompt,/卡组评分未提供/);
assert.ok(!/卡组评分=\d|能力维度：爆发\d/.test(snapshot.prompt),'unsupported numeric authority must not leak to model prompts');
