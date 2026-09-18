import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { evaluateIsolatedEncounter, planIsolatedEncounterAction, candidateTargetsForCard } = require('../src/runtime/isolatedEncounterEvaluator.ts');
const { towerBudgetFromMeasurement, createTowerEncounterBaseline } = require('../src/game-core/towerEncounterBudget.ts');
const { balanceTowerWithRuntime } = require('../src/runtime/towerRuntimeBalance.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { BattleManager } = require('../src/fish/combat/battleManager.ts');
const { createRunState, validateRunState } = require('../src/game-core/runState.ts');

// No document, storage, live game model or player save is available in this process.
globalThis.getVariables = () => { throw Error('Evaluation touched real storage'); };
globalThis.replaceVariables = globalThis.getVariables;
const battle = { core: { hp: 60, max_hp: 60, lust: 0, max_lust: 100 }, cards: [
  { id: 'hit', name: '攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
  { id: 'block', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
], statuses: [], artifacts: [], items: [], enemies: [
  { id: 'enemy', name: '公开攻击', emoji: '◇', hp: 45, max_hp: 45, lust: 0, max_lust: 100,
    actions: [{ id: 'hit', name: '攻击', effects: { damage: 12 } }] },
] };
const original = structuredClone(battle);
assert.deepEqual(candidateTargetsForCard({ spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 4 }] }, ['a', 'b']), [undefined],
  'self-only cards have one semantically identical action regardless of enemy count');
assert.deepEqual(candidateTargetsForCard({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 4 }] }, ['a', 'b']), ['a', 'b'],
  'direct opponent effects preserve every selectable enemy');
assert.deepEqual(candidateTargetsForCard({ spec: 'mwg.effect/v1', steps: [{ op: 'register_trigger', trigger: 'turn_end', effects: [] }] }, ['a', 'b']), ['a', 'b'],
  'deferred effects remain conservative because an active target may affect later execution');
const normal = await evaluateIsolatedEncounter({ battle, seeds: 1, policies: ['tempo', 'survival'], maxTurns: 8 });
assert.equal(normal.status, 'measured');
const tempo = normal.trials.find(row => row.policy === 'tempo'), guard = normal.trials.find(row => row.policy === 'survival');
assert.equal(tempo.seed, guard.seed, 'strategy comparisons use paired initial random samples');
assert.equal(guard.outcome, 'victory'); assert.equal(guard.netHpLost, 0, 'complete no-loss solution is credited');
assert.ok(tempo.hpLost > guard.hpLost && tempo.turns < guard.turns);
assert.deepEqual(battle, original, 'evaluation never mutates authored input');
assert.deepEqual(await evaluateIsolatedEncounter({ battle: JSON.parse(JSON.stringify(battle)), seeds: 1,
  policies: ['tempo', 'survival'], maxTurns: 8 }), normal, 'realm reuse and restoration are deterministic');

const growth = structuredClone(battle);
growth.enemies[0].actions[0].effects.damage = '12 + max(0, turn_number - 3) * 8';
const trap = await evaluateIsolatedEncounter({ battle: growth, seeds: 1, maxTurns: 8 });
const local = trap.trials.find(row => row.policy === 'survival'), full = trap.trials.find(row => row.policy === 'engine');
assert.equal(full.outcome, 'victory');
assert.ok(local.hpLost > full.hpLost, 'local defense must not hide enemy growth and later accumulated damage');
assert.ok(full.turns < local.turns, 'earlier kill is a means to preserve condition against growth');

const swarm = structuredClone(battle);
swarm.cards = [{ ...swarm.cards[0], quantity: 5 }];
swarm.enemies = Array.from({ length: 3 }, (_, i) => ({ ...structuredClone(battle.enemies[0]), id: `foe_${i}`, hp: 7, max_hp: 7 }));
const sweep = await evaluateIsolatedEncounter({ battle: swarm, seeds: 1, policies: ['tempo'], maxTurns: 4 });
assert.equal(sweep.trials[0].outcome, 'victory'); assert.equal(sweep.trials[0].turns, 1);
assert.equal(sweep.trials[0].hpLost, 0, 'killed enemies no longer contribute phantom incoming damage');
assert.equal(new Set(sweep.trials[0].killOrder).size, 3);

const summons = structuredClone(swarm);
summons.cards = [{ id: 'summon', name: '召唤', type: 'Skill', cost: 1, quantity: 5,
  effects: { spawn_summon: { id: 'ally', name: '伙伴', emoji: '◇', max_hp: 5,
    action: { damage: 7, to: 'opponent' } }, to: 'self' } }];
const summonResult = await evaluateIsolatedEncounter({ battle: summons, seeds: 1, policies: ['tempo'], maxTurns: 5 });
assert.equal(summonResult.status, 'measured', JSON.stringify(summonResult.limitations));
assert.ok(summonResult.trials[0].damageDealt > 0, 'summons actually execute their actions');

const store = GameStateManager.getInstance();
const request = require('../src/fish/core/battleContractAdapter.ts').createBattleRequestFromMvu({stat_data:{battle}}, battle);
store.loadIsolatedBattleRequest(request);
await BattleManager.getInstance().beginInitialPlayerTurn();
const stateBeforePlan = structuredClone(store.getGameState());
const publicPlan = await planIsolatedEncounterAction('tempo', 1);
assert.deepEqual(store.getGameState(), stateBeforePlan, 'search leaves live trial state and RNG untouched');
store.updatePlayer({ drawPile: [...stateBeforePlan.player.drawPile].reverse() });
assert.deepEqual(await planIsolatedEncounterAction('tempo', 1), publicPlan,
  'two hidden pile orders with identical public information produce the same decision');
store.replaceState(stateBeforePlan);

const manager = BattleManager.getInstance(), saved = manager.executeTurnFlowStep;
try {
  manager.executeTurnFlowStep = async () => { throw Error('injected-turn-failure'); };
  const failed = await evaluateIsolatedEncounter({ battle, seeds: 1, policies: ['tempo'], maxTurns: 2 });
  assert.equal(failed.status, 'inconclusive');
  assert.match(failed.limitations.join(' '), /injected-turn-failure/);
  assert.equal(GameStateManager.getInstance().getGameState().phase, 'player_turn', 'failed branch rolls back state');
} finally { manager.executeTurnFlowStep = saved; }

const m = { spec: 'mwg.tower-build-measurement/v1', damageByTurn: [18, 35, 50, 65, 80], defensePerTurn: 6,
  maxHp: 60, status: 'measured', decisionCoverage: 'bounded', evidence: [] };
const baseline = createTowerEncounterBaseline(m, 1);
const budget = (act, measurement = m, hp = 60) => towerBudgetFromMeasurement({ measurement: { ...measurement, maxHp: hp },
  baseline, kind: 'battle', act, floor: 3, difficulty: 80 });
const one = budget(1), two = budget(2), three = budget(3);
assert.ok(one.durability.hp.max < two.durability.hp.max && two.durability.hp.max < three.durability.hp.max);
const stronger = budget(1, { ...m, damageByTurn: m.damageByTurn.map(value => value * 2) });
assert.ok(stronger.durability.hp.max > one.durability.hp.max && stronger.durability.hp.max < one.durability.hp.max * 2,
  'world responds partially to growth while player keeps a measurable build advantage');
const run = { ...createRunState({ seed: 82 }), encounterBaseline: baseline };
assert.equal(validateRunState(JSON.parse(JSON.stringify(run))).ok, true);
assert.equal(validateRunState({ ...run, encounterBaseline: { ...baseline, damageByTurn: [NaN] } }).ok, false);

console.log(JSON.stringify({ normal: normal.policies, growthTrap: trap.policies, sweep: sweep.policies,
  summon: summonResult.policies, actHpBudgets: [one, two, three].map(value => value.durability.hp) }, null, 2));
console.log('Production battle evaluation: paired seeds, no-loss objective, growth trap, kill order, summons, rollback and persistent partial growth passed.');
