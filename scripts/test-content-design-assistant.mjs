import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

function pack(enemy, extras = {}) {
  return core.createContentPack({
    cards: [
      { id: 'mark', type: 'Skill', cost: 1, quantity: 3, effects: { apply_status: 'mark', stacks: 1 } },
      { id: 'payoff', type: 'Attack', cost: 1, quantity: 4, effects: { damage: '6 + opponent.status.mark.stacks * 2' } },
      { id: 'guard', type: 'Skill', cost: 1, quantity: 3, effects: { block: 6 } },
    ],
    statuses: [
      { id: 'mark', name: '标记', type: 'debuff', triggers: { hold: { modify: 'damage_taken', add: 'stacks' } } },
    ],
    enemy,
    ...extras,
  });
}

function assess(content, player = { hp: 80, maxHp: 80, lust: 0, maxLust: 100 }, previous) {
  const budget = core.summarizeBuildBudget(content, player);
  return core.assessContentDesign({ pack: content, budget, player, previous });
}

const fairEnemy = {
  id: 'sentinel',
  name: '守卫',
  hp: 48,
  max_hp: 48,
  actions: [
    { name: '斩击', weight: 2, effects: { damage: 8 } },
    { name: '架势', weight: 1, effects: { block: 7 } },
    { name: '刻印', weight: 1, effects: { apply_status: 'mark', stacks: 1 } },
  ],
  action_mode: 'probability',
  action_config: { probability: { 斩击: 2, 架势: 1, 刻印: 1 } },
};
const first = assess(pack(fairEnemy));
assert.equal(first.context.spec, 'mwg.content-design/v3');
assert.ok(first.deckPower.totalScore > 0);
assert.equal(first.difficulty.difficultyPercent, 80);
assert.ok(first.archetypes.affinities.length > 0);
assert.equal(first.build.winCondition, '生命');
assert.ok(first.build.engines.includes('状态:mark'));
assert.equal(first.enemy.pressure, '生命');
assert.equal(first.enemy.actionDiversity, 3);
assert.equal(first.enemy.counterplayWindow, true);
assert.ok(first.enemy.dimensions.includes('控制'));
assert.ok(first.enemy.actionEntropy > 0);
assert.match(first.context.brief, /软参考/);
assert.equal(first.context.recentEnemySignatures.length, 1);

const betweenEncounters = assess(pack(null), undefined, first.context);
const repeated = assess(pack(fairEnemy), undefined, betweenEncounters.context);
assert.ok(repeated.diagnostics.some(issue => issue.code === 'ENEMY_RECENTLY_REPEATED'));
assert.equal(repeated.context.recentEnemySignatures.length, 1, 'same encounter must not grow history on rerender');

const lethal = assess(
  pack({
    id: 'burst',
    name: '爆发者',
    hp: 50,
    max_hp: 50,
    actions: [{ name: '处决', effects: { damage: 78 } }],
    action_mode: 'random',
    action_config: {},
  }),
);
assert.ok(lethal.diagnostics.some(issue => issue.code === 'ENCOUNTER_OPENING_LETHAL' && issue.severity === 'critical'));
assert.equal(lethal.forecast.challenge, 'severe');

const defeatFeedback = {
  outcome: 'defeat',
  turns: 2,
  hpRatio: 0,
  lustRatio: 0.4,
};
const neutralPack = pack(null);
const neutralBudget = core.summarizeBuildBudget(neutralPack, { hp: 80, maxHp: 80 });
const neutral = core.assessContentDesign({
  pack: neutralPack,
  budget: neutralBudget,
  player: { hp: 80, maxHp: 80 },
});
const afterDefeat = core.assessContentDesign({
  pack: neutralPack,
  budget: neutralBudget,
  player: { hp: 80, maxHp: 80 },
  previous: first.context,
  outcome: defeatFeedback,
});
assert.match(afterDefeat.context.brief, /降低首轮爆发/);
assert.deepEqual(afterDefeat.context.lastBattle, defeatFeedback);
assert.ok(afterDefeat.budget.hpMax < neutral.budget.hpMax);
assert.ok(afterDefeat.budget.hitMax < neutral.budget.hitMax);

const easyVictory = core.assessContentDesign({
  pack: neutralPack,
  budget: neutralBudget,
  player: { hp: 80, maxHp: 80 },
  outcome: { outcome: 'victory', turns: 3, hpRatio: 0.9, lustRatio: 0.1 },
});
assert.match(easyVictory.context.brief, /提升一档机制压力/);
assert.ok(easyVictory.budget.hpMax > neutral.budget.hpMax);
assert.ok(easyVictory.budget.hitMax > neutral.budget.hitMax);

let winningContext = neutral.context;
for (const outcome of [
  { outcome: 'victory', turns: 4, hpRatio: 0.72, lustRatio: 0.18 },
  { outcome: 'victory', turns: 3, hpRatio: 0.84, lustRatio: 0.12 },
  { outcome: 'victory', turns: 4, hpRatio: 0.76, lustRatio: 0.2 },
]) {
  winningContext = core.assessContentDesign({
    pack: neutralPack,
    budget: neutralBudget,
    player: { hp: 80, maxHp: 80 },
    previous: winningContext,
    outcome,
  }).context;
}
assert.equal(winningContext.performance.battles, 3);
assert.ok(winningContext.performance.pressureFactor > 1);
assert.match(winningContext.brief, /近3战校准/);

let losingContext = neutral.context;
for (const outcome of [
  { outcome: 'defeat', turns: 2, hpRatio: 0, lustRatio: 0.4 },
  { outcome: 'defeat', turns: 4, hpRatio: 0, lustRatio: 0.55 },
  { outcome: 'defeat', turns: 3, hpRatio: 0, lustRatio: 0.48 },
]) {
  losingContext = core.assessContentDesign({
    pack: neutralPack,
    budget: neutralBudget,
    player: { hp: 80, maxHp: 80 },
    previous: losingContext,
    outcome,
  }).context;
}
assert.equal(losingContext.performance.battles, 3);
assert.ok(losingContext.performance.pressureFactor < 1);

const pureDesire = core.createContentPack({
  cards: [
    { id: 'tempt', type: 'Skill', cost: 1, quantity: 8, effects: { lust: 9, to: 'opponent' } },
    { id: 'focus', type: 'Skill', cost: 0, quantity: 4, effects: { draw: 1 } },
  ],
});
const pureDesireAssessment = assess(pureDesire);
assert.equal(pureDesireAssessment.build.winCondition, '欲望');
assert.ok(!pureDesireAssessment.diagnostics.some(issue => issue.code === 'BUILD_ENDGAME_UNCERTAIN'));

const glassCannon = core.createContentPack({
  cards: [
    { id: 'burst', type: 'Attack', cost: 2, quantity: 9, effects: { damage: 18 } },
    { id: 'x_burst', type: 'Attack', cost: 'energy', quantity: 3, effects: { damage: 'spent_energy * 7' } },
  ],
});
assert.ok(!assess(glassCannon).diagnostics.some(issue => issue.severity === 'critical'));

const discardEngine = core.createContentPack({
  cards: [
    { id: 'discard', type: 'Skill', cost: 0, quantity: 6, effects: { discard: { from: 'hand', pick: 'random' }, draw: 1 } },
    { id: 'payoff', type: 'Attack', cost: 1, quantity: 6, effects: { damage: '5 + cards_discarded_this_turn * 3' } },
  ],
});
assert.ok(!assess(discardEngine).diagnostics.some(issue => issue.severity === 'critical'));

const lowConfidence = assess(
  pack({
    id: 'complex',
    hp: 220,
    max_hp: 220,
    actions: [{ name: '重压', effects: { damage: 30, apply_status: 'mark', stacks: 1 } }],
    action_mode: 'random',
    action_config: {},
  }),
);
assert.equal(lowConfidence.simulation.confidence, 'low');
assert.ok(
  !lowConfidence.diagnostics.some(issue => issue.code.startsWith('SHADOW_')),
  'low-confidence shadow results must not create strong diagnostics',
);

const desireOnlyEnemy = {
  id: 'siren',
  hp: 45,
  max_hp: 45,
  actions: [
    { name: '低语', weight: 3, effects: { lust: 12 } },
    { name: '凝视', weight: 1, effects: { lust: 6, apply_status: 'mark', stacks: 1 } },
  ],
  lust_effect: { name: '沉溺', effects: { lust: 8 } },
  action_mode: 'probability',
  action_config: { probability: { 低语: 3, 凝视: 1 } },
};
const desireOnlyAssessment = assess(pack(desireOnlyEnemy));
assert.ok(desireOnlyAssessment.enemy.dimensions.includes('欲望'));
assert.ok(desireOnlyAssessment.diagnostics.some(issue => issue.code === 'ENEMY_NO_DEFEAT_PRESSURE'));
assert.ok(desireOnlyAssessment.diagnostics.some(issue => issue.code === 'ENEMY_LUST_EFFECT_UNDERPOWERED'));

const desireWithFinish = assess(
  pack({
    ...desireOnlyEnemy,
    lust_effect: { name: '沉溺', effects: { damage: 9, lust: 4 } },
  }),
);
assert.ok(!desireWithFinish.diagnostics.some(issue => issue.code === 'ENEMY_NO_DEFEAT_PRESSURE'));
assert.ok(desireWithFinish.diagnostics.some(issue => issue.code === 'ENEMY_LUST_EFFECT_UNDERPOWERED'));

const decisiveDesire = assess(
  pack({
    ...desireOnlyEnemy,
    lust_effect: { name: '终局爆发', effects: { damage: 24, apply_status: 'mark', stacks: 4 } },
  }, {
    playerDesireEffect: { name: '逆转', effects: { damage: 24, draw: 2 } },
  }),
);
assert.ok(!decisiveDesire.diagnostics.some(issue => issue.code === 'ENEMY_LUST_EFFECT_UNDERPOWERED'));
assert.ok(!decisiveDesire.diagnostics.some(issue => issue.code === 'PLAYER_LUST_EFFECT_UNDERPOWERED'));

const rewardAssessment = core.assessContentDesign({
  pack: neutralPack,
  budget: neutralBudget,
  player: { hp: 80, maxHp: 80 },
  rewardCandidates: [
    { id: 'strike_a', name: '不同题材一', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 8 } },
    { id: 'strike_b', name: '不同题材二', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 8 } },
    { id: 'strike_c', name: '更强直击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 11 } },
  ],
});
assert.equal(rewardAssessment.reward.candidateCount, 3);
assert.equal(rewardAssessment.reward.candidates.length, 3);
assert.ok(rewardAssessment.reward.candidates.every(candidate => Number.isFinite(candidate.deckScoreDelta)));
assert.ok(rewardAssessment.reward.candidates.every(candidate => candidate.archetypes.length >= 1));
assert.ok(rewardAssessment.context.rewardPlan.directions.some(entry => entry.kind === 'universal'));
assert.equal(rewardAssessment.reward.uniqueMechanics, 2, 'names and descriptions must not fake reward variety');
assert.ok(rewardAssessment.reward.dominatedPairs.length > 0);
assert.ok(rewardAssessment.diagnostics.some(issue => issue.code === 'REWARD_MECHANICAL_DUPLICATES'));
assert.ok(rewardAssessment.diagnostics.some(issue => issue.code === 'REWARD_STRICT_DOMINANCE'));
assert.ok(rewardAssessment.diagnostics.some(issue => issue.code === 'REWARD_LOW_DECISION_DIVERSITY'));
assert.deepEqual(rewardAssessment.context.rewardReview.diagnosticCodes, [
  'REWARD_MECHANICAL_DUPLICATES',
  'REWARD_STRICT_DOMINANCE',
  'REWARD_LOW_DECISION_DIVERSITY',
]);

const dynamicRewardAssessment = core.assessContentDesign({
  pack: neutralPack,
  budget: neutralBudget,
  player: { hp: 80, maxHp: 80 },
  rewardCandidates: [
    { id: 'flat', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 7 } },
    { id: 'x_card', type: 'Attack', rarity: 'Uncommon', cost: 'energy', quantity: 1, effects: { damage: 'spent_energy * 6' } },
    { id: 'discard_payoff', type: 'Attack', rarity: 'Uncommon', cost: 1, quantity: 1, effects: { damage: '5 + cards_discarded_this_turn * 3' } },
  ],
});
assert.equal(dynamicRewardAssessment.reward.dominatedPairs.length, 0, 'dynamic rewards need simulation, not static dominance');

console.log('Content design assistant produces bounded build, encounter, variety, and outcome feedback.');
