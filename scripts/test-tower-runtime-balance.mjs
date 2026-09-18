import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { evaluateIsolatedEncounter } = require('../src/runtime/isolatedEncounterEvaluator.ts');
const { balanceTowerWithRuntime, measureTowerBuild } = require('../src/runtime/towerRuntimeBalance.ts');
const { compactTowerBalanceAudit } = require('../src/runtime/towerBalanceAudit.ts');
const { towerEncounterPlayerReference } = require('../src/runtime/towerEncounterPlayer.ts');
const { towerBudgetFromMeasurement, createTowerEncounterBaseline, validTowerEncounterBaseline } = require('../src/game-core/towerEncounterBudget.ts');
const { runTriggerTransaction } = require('../src/game-core/triggerTransaction.ts');
const { BattleManager } = require('../src/fish/combat/battleManager.ts');
const { BattleSessionHost } = require('../src/fish/core/battleSessionHost.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const measurement = { spec: 'mwg.tower-build-measurement/v1', damageByTurn: [21,42,63,84,105],
  defensePerTurn: 0, maxHp: 60, status: 'measured', decisionCoverage: 'bounded', evidence: [] };
const budgetFor = (m, act = 1, baseline = createTowerEncounterBaseline(measurement, 1)) =>
  towerBudgetFromMeasurement({ measurement: m, baseline, kind: 'battle', act, floor: 1, difficulty: 80 });
const budget = budgetFor(measurement);
const player = { core: { hp: 60, max_hp: 60, lust: 0, max_lust: 100 }, statuses: [], artifacts: [], items: [],
  cards: [{ id: 'hit', name: '攻击', type: 'Attack', cost: 1, quantity: 5, effects: { damage: 7 } }] };
const enemy = { id: 'foe', name: '敌人', hp: 7, max_hp: 7, lust: 0, max_lust: 100,
  actions: [{ id: 'hit', name: '攻击', effects: { damage: 1 } }] };
const generated = { enemies: Array.from({length:3},(_,i)=>({...structuredClone(enemy),id:`foe${i}`})) };
const authored = JSON.stringify({ player, generated });
const result = await balanceTowerWithRuntime({ persistentBattle: player, generatedBattle: generated, budget, seed: 17, seeds: 1 });
assert.equal(result.original.status, 'measured');
assert.equal(result.original.decisionCoverage, 'limited', 'bounded full-encounter continuation does not claim omitted routes');
assert.equal(result.evaluation.decisionCoverage, 'limited');
assert.equal(result.hpScale, 1, 'limited search never adjusts legal authored enemy numbers');
assert.deepEqual(result.changedPaths, []);
assert.equal(result.needsReview, true, 'a limited evaluation is surfaced for review instead of silently calibrating');
assert.equal(JSON.stringify({ player, generated }), authored, 'calibration never mutates player or authored input');
assert.ok(result.changedPaths.every(path => /\.max_hp$|\.hp$/.test(path)), 'only approved enemy numeric slots changed');
const audit = compactTowerBalanceAudit(result, measurement, 80, false);
assert.equal(audit.resourceAssessment, 'full-health-reference');
assert.equal(audit.winnableAtCurrentResources, undefined);
assert.equal(audit.evaluation, undefined); assert.equal(audit.originalEvaluation, undefined);
assert.ok(JSON.stringify(audit).length < 12000);
assert.notEqual(audit.finalEnemyScore, budget.targetScore, 'actual final roster score must not copy the requested budget');
const uncertain = compactTowerBalanceAudit({ ...result, evaluation: { ...result.evaluation, status: 'inconclusive' } }, measurement, 80, false);
assert.equal(uncertain.finalEnemyScore, undefined, 'uncertainty never produces a precise settlement score');

const previous = { ...structuredClone(player), core: { ...player.core, hp: 1, lust: 75 },
  player_abilities: [{ id: 'old-battle-buff' }], player_status_effects: [{ id: 'old-poison' }], enemies: generated.enemies };
const clean = towerEncounterPlayerReference(previous);
assert.equal(clean.core.hp, 60); assert.equal(clean.core.lust, 0);
assert.deepEqual(clean.player_abilities, []); assert.deepEqual(clean.player_status_effects, []);
assert.equal(clean.enemies, undefined); assert.deepEqual(clean.cards, player.cards);
assert.equal(previous.core.hp, 1, 'next-node reference leaves real current HP untouched');
const grownDefense = budgetFor({ ...measurement, defensePerTurn: 12 });
assert.ok(grownDefense.pressureByTurn[0].hpDamage.max > budget.pressureByTurn[0].hpDamage.max, 'zero initial defense still responds to growth');
const zero = { ...measurement, damageByTurn: [0,0,0,0,0] };
assert.ok(budgetFor(measurement, 1, createTowerEncounterBaseline(zero, 1)).durability.hp.max > budgetFor(zero, 1, createTowerEncounterBaseline(zero, 1)).durability.hp.max);
const late = createTowerEncounterBaseline(measurement, 3);
assert.equal(late.act, 3); assert.equal(late.source, 'late-reference');
assert.deepEqual(budgetFor(measurement, 3, late).durability, budget.durability, 'late Act3 sample is not multiplied by Act growth again');
for (const status of ['inconclusive', 'measured']) {
  const missing = {...measurement,status,decisionCoverage:'limited',damageByTurn:[0,0,0,0,0],defensePerTurn:0};
  const neutral = budgetFor(missing);
  assert.deepEqual(neutral.durability,budget.durability,'missing capabilities cannot lower the known baseline');
  assert.equal(neutral.numericAuthority,'maintained-prior');
  assert.throws(()=>createTowerEncounterBaseline(missing,1),/未充分覆盖/);
  const prior=towerBudgetFromMeasurement({measurement:missing,kind:'battle',act:1,floor:1,difficulty:80});
  assert.ok(prior.durability.hp.min>40,'missing baseline uses explicit prior instead of zero damage');
}
const strong = {...structuredClone(player),cards:[{...player.cards[0],effects:{damage:1000}}]};
const onBudget={enemies:[{...structuredClone(enemy),hp:budget.durability.hp.max,max_hp:budget.durability.hp.max}]};
const burst=await balanceTowerWithRuntime({persistentBattle:strong,generatedBattle:onBudget,budget,seed:17,seeds:1});
assert.equal(burst.hpScale,1,'a fast kill of an on-budget enemy preserves the strong build payoff');
assert.deepEqual(burst.changedPaths,[]);
assert.equal(burst.needsReview,false,'fast on-budget victory must not request AI inflation either');
const limitedProbe=await measureTowerBuild({...strong,items:[{id:'potion',name:'药剂',emoji:'◇',count:1,effects:{heal:5}}]},1);
assert.equal(limitedProbe.decisionCoverage,'limited','unsearched consumable use propagates from real trials into the build measurement');
assert.equal(budgetFor(limitedProbe).numericAuthority,'maintained-prior');
const cappedProbe=await measureTowerBuild(player,1);
assert.equal(cappedProbe.decisionCoverage,'limited','build probes report their public candidate cap instead of treating omitted enemy branches as measured power');
assert.equal(budgetFor(cappedProbe).numericAuthority,'maintained-prior');
const failedProbe=await measureTowerBuild({...strong,cards:[{...strong.cards[0],effects:{not_an_operation:5}}]},1);
assert.equal(failedProbe.status,'inconclusive');
assert.equal(budgetFor(failedProbe).numericAuthority,'maintained-prior','all failing probe paths cannot establish a zero-power budget');
assert.equal(validTowerEncounterBaseline({ ...late, source: 'invented' }), false);

const combo = { ...structuredClone(player), core: { ...player.core, resources: [{id:'charge',name:'蓄能',emoji:'◇',max:5,start:0,refresh:'retain'}] },
  cards: [{id:'charge',name:'蓄能',type:'Skill',cost:1,quantity:1,effects:{resource:{id:'charge',amount:3}}},
    {id:'payoff',name:'兑现',type:'Attack',cost:{energy:1,charge:3},quantity:1,effects:{damage:50}}],
  enemies:[{...enemy,hp:40,max_hp:40,actions:[{id:'hit',name:'攻击',effects:{damage:20}}]}] };
const comboResult = await evaluateIsolatedEncounter({ battle: combo, policies: ['engine'], seeds: 1, maxTurns: 3,
  maxForecastBranches: 4, maxForecastCandidates: 2, maxForecastTurns: 3 });
assert.equal(comboResult.status, 'measured', JSON.stringify(comboResult.limitations));
assert.equal(comboResult.trials[0].outcome, 'victory');
assert.equal(comboResult.trials[0].netHpLost, 0, 'setup resource then spend it within the same turn preserves state');
assert.equal(comboResult.trials[0].cardsPlayed, 2);

const lustBattle = { enemies:[{...structuredClone(enemy),hp:45,max_hp:45,
  lust_effect:{name:'失控',effects:{damage:1}},
  actions:[{id:'tempt',name:'诱惑',effects:{lust:20}}]}] };
const lustResult = await balanceTowerWithRuntime({persistentBattle:player,generatedBattle:lustBattle,budget,seed:17,seeds:1});
assert.equal(lustResult.evaluation.status,'measured',JSON.stringify(lustResult.evaluation.limitations));
assert.ok(lustResult.evaluation.trials.every(t=>t.outcome==='victory' && t.netHpLost===0 && t.netLustGained>=20));
assert.ok(lustResult.evaluation.policies.every(p=>p.medianConditionLoss>=0.2));
assert.equal(lustResult.needsReview,true,'zero HP loss with persistent lust gain is not a well-preserved finish');
const minorHit = await evaluateIsolatedEncounter({battle:{...player,enemies:[{...enemy,hp:45,max_hp:45}]},policies:['engine'],seeds:1,maxTurns:4});
assert.equal(minorHit.trials[0].netLustGained,0);
assert.ok(minorHit.trials[0].netHpLost>0);
assert.ok(minorHit.trials[0].conditionLoss<lustResult.evaluation.trials[0].conditionLoss,'minor HP damage and high persistent lust stay distinct');
const woundedBattle={enemies:[{...structuredClone(enemy),hp:10,max_hp:100}]};
const woundedResult=await balanceTowerWithRuntime({persistentBattle:player,generatedBattle:woundedBattle,budget,seed:17,seeds:1});
assert.equal(woundedResult.generatedBattle.enemies[0].hp,10,'a legal narrative injury must not be healed by calibration');
assert.deepEqual(woundedResult.changedPaths,[]);
assert.ok(woundedResult.feedback.some(line=>line.includes('耐久')),'actual low starting HP remains visible in the diagnostic');

const manager = BattleManager.getInstance(), saved = manager.executeTurnFlowStep;
try {
  manager.executeTurnFlowStep = async function (...args) {
    await runTriggerTransaction('injected_recovering_trigger', BattleSessionHost.getInstance().triggerTransactionPorts(), () => {
      GameStateManager.getInstance().nextRandom(); throw Error('injected-recovered-failure');
    }, 'recover-and-continue');
    return saved.apply(this, args);
  };
  const failed = await evaluateIsolatedEncounter({battle:{...player,enemies:[{...enemy,hp:70,max_hp:70}]},policies:['tempo'],seeds:1,maxTurns:1});
  assert.equal(failed.status, 'inconclusive');
  assert.match(failed.limitations.join(' '), /injected-recovered-failure/);
} finally { manager.executeTurnFlowStep = saved; }
console.log(JSON.stringify({ hpScale:result.hpScale, policies:result.evaluation.policies, combo:comboResult.policies, auditBytes:JSON.stringify(audit).length },null,2));
console.log('Runtime calibration, compact audit, reference isolation, zero-baseline growth, resource combo and recovered-failure detection passed.');
