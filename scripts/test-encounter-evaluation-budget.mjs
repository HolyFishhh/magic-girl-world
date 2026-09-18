import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { candidateTargetsForCard, evaluateIsolatedEncounter, selectForecastShortlist } = require('../src/runtime/isolatedEncounterEvaluator.ts');
const { measureTowerBuild } = require('../src/runtime/towerRuntimeBalance.ts');

const selfOnly = { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 4 }] };
const opponent = { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 4 }] };
assert.deepEqual(candidateTargetsForCard(selfOnly, ['a', 'b', 'c']), [undefined]);
assert.deepEqual(candidateTargetsForCard(opponent, ['a', 'b', 'c']), ['a', 'b', 'c']);
const idle = { score: 12, cardId: undefined }, attack = { score: 8, cardId: 'hit' };
assert.deepEqual(selectForecastShortlist([attack, idle], 2), [idle, attack], 'a competitively scored end-turn action reaches stage two');

const battle = { core: { hp: 30, max_hp: 30, lust: 0, max_lust: 100 }, statuses: [], artifacts: [], items: [],
  cards: [{ id: 'guard', name: '守势', type: 'Skill', cost: 1, quantity: 3, effects: { block: 4 } }],
  enemies: Array.from({ length: 3 }, (_, index) => ({ id: `foe_${index}`, name: `敌人${index}`, emoji: '◇', hp: 20, max_hp: 20,
    lust: 0, max_lust: 100, actions: [{ id: 'hit', name: '攻击', effects: { damage: 1 } }] })),
};
const original = structuredClone(battle);
const capped = await evaluateIsolatedEncounter({ battle, seeds: 1, policies: ['tempo'], maxTurns: 1, maxDecisions: 1,
  maxCandidateBranches: 2, search: 'one_turn' });
assert.equal(capped.decisionCoverage, 'limited');
assert.match(capped.limitations.join(' '), /公开策略仅评估2\//);
assert.deepEqual(battle, original, 'candidate pruning never mutates authored input');

const exhausted = await evaluateIsolatedEncounter({ battle: { ...original, enemies: [original.enemies[0]] }, seeds: 1,
  policies: ['engine'], maxTurns: 1, maxDecisions: 1, maxForecastBranches: 0 });
assert.equal(exhausted.decisionCoverage, 'limited');
assert.match(exhausted.limitations.join(' '), /整场续局预算已用尽/);

const lethal = await evaluateIsolatedEncounter({ battle: { ...original, cards: [{ id: 'hit', name: '斩击', type: 'Attack', cost: 1,
  quantity: 1, effects: { damage: 99 } }], enemies: [{ ...original.enemies[0], hp: 8, max_hp: 8 }] }, seeds: 1,
  policies: ['engine'], maxTurns: 1, maxDecisions: 1, maxForecastBranches: 4, maxForecastCandidates: 2 });
assert.equal(lethal.trials[0].outcome, 'victory');
assert.equal(lethal.trials[0].cardsPlayed, 1, 'stage-two comparison keeps a turn-one lethal card over idle');
const build = { core: { hp: 40, max_hp: 40, lust: 0, max_lust: 100 }, statuses: [], artifacts: [], items: [],
  cards: [{ id: 'strike', name: '打击', type: 'Attack', cost: 1, quantity: 5, effects: { damage: 8 } },
    { id: 'guard', name: '格挡', type: 'Skill', cost: 1, quantity: 5, effects: { block: 6 } }] };
const strongerBuild = { ...structuredClone(build), cards: [{ ...build.cards[0], effects: { damage: 16 } }, build.cards[1]] };
const measured = await measureTowerBuild(build, 1), strongerMeasured = await measureTowerBuild(strongerBuild, 1);
assert.equal(measured.decisionCoverage, 'limited');
assert.ok(measured.damageByTurn.some(value => value > 0), 'rollout probe preserves actual nonzero five-turn damage evidence');
assert.ok(strongerMeasured.damageByTurn[0] > measured.damageByTurn[0], 'stronger attacks raise the measured build trajectory');
const longFreeTurn = { core: { hp: 40, max_hp: 40, lust: 0, max_lust: 100 }, statuses: [], artifacts: [], items: [],
  cards: [
    { id: 'accelerant', name: '加速抽牌', type: 'Skill', cost: 0, quantity: 1, effects: { draw: 5 } },
    { id: 'free_guard', name: '免费护盾', type: 'Skill', cost: 0, quantity: 9, effects: { block: 1 } },
    { id: 'finish', name: '收束', type: 'Attack', cost: 1, quantity: 1, effects: { damage: 20 } },
  ] };
const longFreeMeasured = await measureTowerBuild(longFreeTurn, 1);
assert.equal(longFreeMeasured.status, 'measured',
  'the production build probe keeps the evaluator\'s bounded 24-play allowance instead of treating a legal seven-plus-play turn as zero power');
assert.ok(longFreeMeasured.damageByTurn.some(value => value > 0));
console.log('Encounter candidate and forecast budgets preserve target semantics, mark limits, and leave input unchanged.');

const continued = await evaluateIsolatedEncounter({battle:{...build,enemies:[{...battle.enemies[0],hp:200,max_hp:200}]},seeds:1,policies:['tempo'],maxTurns:5,maxSearchDecisions:1,maxCandidateBranches:4});
assert.equal(continued.trials[0].horizons.length,5,'exhausting branch budget continues all five real turns');
assert.notEqual(continued.trials[0].outcome,'inconclusive','ordinary full trajectories are not aborted at the search budget');
assert.equal(continued.decisionCoverage,'limited');
