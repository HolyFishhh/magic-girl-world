import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

function basePack(enemyHp = 48, enemyCurrentHp = enemyHp) {
  return core.createContentPack({
    cards: [
      { id: 'strike', name: '攻击', type: 'Attack', cost: 1, quantity: 5, effects: { damage: 7 } },
      { id: 'guard', name: '防御', type: 'Skill', cost: 1, quantity: 5, effects: { block: 6 } },
    ],
    enemy: {
      id: 'guardian',
      name: '守门者',
      hp: enemyCurrentHp,
      max_hp: enemyHp,
      lust: 0,
      max_lust: 100,
      actions: [
        { id: 'hit', name: '挥击', weight: 2, effects: { damage: 8 } },
        { id: 'guard', name: '架势', weight: 1, effects: { block: 6 } },
      ],
      lust_effect: { name: '失衡追击', effects: { damage: 5 } },
    },
  });
}

const pack = basePack();
const started = performance.now();
const base = core.scoreDeckPower({ pack, maxHp: 80 });
const firstElapsed = performance.now() - started;
const cachedStarted = performance.now();
const cached = core.scoreDeckPower({ pack, maxHp: 80 });
const cachedElapsed = performance.now() - cachedStarted;
assert.strictEqual(cached, base, 'identical persistent mechanics must hit the bounded score cache');
assert.ok(cachedElapsed <= firstElapsed, 'a cached base score must not be slower than the original calculation');
assert.equal(base.spec, 'mwg.deck-power/v1');
assert.ok(base.totalScore > 0);
assert.ok(base.curves.every((point, index, values) => index === 0 || point.cumulativePressure >= values[index - 1].cumulativePressure));

// Current HP is intentionally absent from scoreDeckPower. Supplying the same max HP must be invariant.
const fullHpScore = core.scoreDeckPower({ pack, maxHp: 80 });
const woundedHpScore = core.scoreDeckPower({ pack, maxHp: 80 });
assert.equal(woundedHpScore.totalScore, fullHpScore.totalScore);
const largerReserve = core.scoreDeckPower({ pack, maxHp: 120 });
assert.ok(largerReserve.totalScore > base.totalScore, 'maximum HP is persistent build power and must affect the score');

const budgets = [10, 50, 80, 100, 110].map(difficultyPercent => core.createDifficultyBudget({
  deck: base,
  difficultyPercent,
  currentHp: 80,
  currentLust: 0,
  maxLust: 100,
}));
for (let index = 1; index < budgets.length; index += 1) {
  assert.ok(budgets[index].targetEnemyScore > budgets[index - 1].targetEnemyScore);
  assert.ok(budgets[index].enemyHp.min >= budgets[index - 1].enemyHp.min);
  assert.ok(budgets[index].expectedActionDamage.min >= budgets[index - 1].expectedActionDamage.min);
}
assert.equal(budgets.at(-1).difficultyPercent, 110);
assert.ok(budgets.at(-1).desiredHpLossRatio.min > 0, '110% deliberately budgets bounded resource loss');

const woundedBudget = core.createDifficultyBudget({
  deck: base,
  difficultyPercent: 110,
  currentHp: 5,
  currentLust: 90,
  maxLust: 100,
});
assert.equal(woundedBudget.playerScore, base.totalScore, 'current resources must not rewrite the persistent score');
assert.equal(woundedBudget.feasibility.winnableAtCurrentResources, false);
assert.ok(woundedBudget.feasibility.maxRecommendedPercent < 110);

const enemy = core.scoreEnemyPower(pack);
const woundedEnemy = core.scoreEnemyPower(basePack(48, 24));
assert.ok(enemy && woundedEnemy);
assert.equal(enemy.totalScore, woundedEnemy.totalScore, 'story wounds do not change authored full-strength score');
assert.ok(woundedEnemy.currentEncounterScore < enemy.currentEncounterScore, 'story wounds reduce this encounter only');
const calibration = core.calibrateEnemyPower(base, enemy, 80);
assert.ok(Number.isFinite(calibration.actualPercent));
assert.ok(['far_below', 'below', 'on_target', 'above', 'far_above'].includes(calibration.band));

const complexPack = core.createContentPack({
  playerResources: [{ id: 'charge', current: 3, max: 3, refresh: 'reset' }],
  statuses: [{ id: 'trace', triggers: { tick: { effects: { damage: 'self.status.trace.stacks' } } } }],
  cards: [
    { id: 'seed', type: 'Skill', cost: 0, quantity: 3, effects: { apply_status: 'trace', stacks: 2, to: 'opponent' } },
    { id: 'cash', type: 'Attack', cost: 1, quantity: 2, effects: { damage: 'opponent.status.trace.stacks * 3', remove_status: 'trace' } },
    { id: 'cycle', type: 'Skill', cost: 1, quantity: 3, effects: { draw: 2, discard: { from: 'hand', pick: 'random' } } },
    { id: 'echo', type: 'Power', cost: 1, quantity: 1, trigger: { on: 'attack_played', effects: { replay: 1 } } },
    { id: 'burst', type: 'Attack', cost: { charge: 'all' }, quantity: 1, effects: { damage: 'x_resource.charge * 8' } },
  ],
});
const complex = core.scoreDeckPower({ pack: complexPack, maxHp: 80 });
assert.ok(complex.mechanicAxes.includes('状态'));
assert.ok(complex.mechanicAxes.includes('弃牌'));
assert.ok(complex.mechanicAxes.includes('X费用'));
assert.ok(complex.dimensions.scaling > 0);
assert.ok(complex.coverage < 1, 'complex unsupported mechanics must lower confidence instead of pretending exactness');

function playerOverflowPack(effect, statuses = []) {
  return core.createContentPack({
    statuses,
    cards: [{ id: 'pressure', name: '催欲', type: 'Skill', cost: 0, quantity: 5, effects: { lust: 25 } }],
    playerDesireEffect: effect,
  });
}

const weakPlayerOverflow = core.scoreDeckPower({
  pack: playerOverflowPack({ name: '轻击', effects: { damage: 2 } }), maxHp: 80,
});
const strongPlayerOverflow = core.scoreDeckPower({
  pack: playerOverflowPack({ name: '灼烧处决', effects: [{ damage: 12, damage_kind: 'damage_over_time' }, { execute: 40 }] }), maxHp: 80,
});
assert.ok(strongPlayerOverflow.budget.attack > weakPlayerOverflow.budget.attack,
  'player overflow score must value executable damage-over-time and execute payoff at its cap frequency');
const statusPlayerOverflow = core.scoreDeckPower({
  pack: playerOverflowPack(
    { name: '烙印', effects: { apply_status: 'overflow_burn' } },
    [{ id: 'overflow_burn', type: 'debuff', triggers: { tick: { damage: 10, damage_kind: 'damage_over_time' } } }],
  ), maxHp: 80,
});
assert.ok(statusPlayerOverflow.budget.attack > weakPlayerOverflow.budget.attack,
  'a registered overflow-applied DoT status contributes one conservative tick');
const dynamicPlayerOverflow = core.scoreDeckPower({
  pack: playerOverflowPack({ name: '未知倍率', effects: { damage: 'opponent.hp * 0.2' } }), maxHp: 80,
});
assert.ok(dynamicPlayerOverflow.coverage < weakPlayerOverflow.coverage,
  'dynamic overflow payload lowers confidence instead of being treated as a fixed payout');

function enemyOverflowPack(effect) {
  return core.createContentPack({
    enemy: {
      id: 'temptress', name: '试炼者', hp: 60, max_hp: 60, lust: 0, max_lust: 100,
      actions: [{ id: 'press', name: '压迫', effects: { lust: 100 } }],
      lust_effect: effect,
    },
  });
}
const weakEnemyOverflow = core.scoreEnemyPower(enemyOverflowPack({ name: '轻击', effects: { damage: 2 } }));
const strongEnemyOverflow = core.scoreEnemyPower(enemyOverflowPack({ name: '终焉', effects: [{ damage: 12, damage_kind: 'damage_over_time' }, { execute: 40 }] }));
const selfDamageEnemyOverflow = core.scoreEnemyPower(enemyOverflowPack({ name: '自残', effects: { damage: 99, to: 'self' } }));
const negativeEnemyOverflow = core.scoreEnemyPower(enemyOverflowPack({ name: '负值', effects: { damage: -99 } }));
const gatedKillEnemyOverflow = core.scoreEnemyPower(enemyOverflowPack({ name: '未满足处决', effects: { kill: true, when: '0 == 1' } }));
assert.ok(weakEnemyOverflow && strongEnemyOverflow && selfDamageEnemyOverflow && negativeEnemyOverflow && gatedKillEnemyOverflow);
assert.ok(strongEnemyOverflow.expectedOverflowDamagePerTurn > weakEnemyOverflow.expectedOverflowDamagePerTurn,
  'enemy overflow payload uses the owner effect when its desire pressure reaches the cap');
assert.equal(selfDamageEnemyOverflow.expectedOverflowDamagePerTurn, 0,
  'self-targeted overflow damage is not enemy pressure');
assert.equal(negativeEnemyOverflow.expectedOverflowDamagePerTurn, 0,
  'negative overflow damage is not enemy pressure');
assert.equal(gatedKillEnemyOverflow.expectedOverflowDamagePerTurn, 0,
  'a condition-gated kill has no speculative overflow payout');
const enemyStatusOverflow = core.createContentPack({
  statuses: [{ id: 'enemy_burn', type: 'debuff', triggers: { tick: { damage: 11, damage_kind: 'damage_over_time' } } }],
  enemy: {
    id: 'status_temptress', name: '状态试炼者', hp: 60, max_hp: 60, lust: 0, max_lust: 100,
    actions: [{ id: 'press', name: '压迫', effects: { lust: 100 } }],
    lust_effect: { name: '烙印', effects: { apply_status: 'enemy_burn' } },
  },
});
const enemyStatusScore = core.scoreEnemyPower(enemyStatusOverflow);
assert.ok(enemyStatusScore && enemyStatusScore.expectedOverflowDamagePerTurn > 0,
  'enemy score cache includes status definitions used by overflow payloads');
const lowOwnerCapEnemy = core.createContentPack({
  enemy: {
    id: 'low_owner_cap', name: '低上限敌人', hp: 60, max_hp: 60, lust: 0, max_lust: 25,
    actions: [{ id: 'press', name: '压迫', effects: { lust: 25 } }],
    lust_effect: { name: '轻击', effects: { damage: 8 } },
  },
});
const lowOwnerCapScore = core.scoreEnemyPower(lowOwnerCapEnemy);
assert.equal(lowOwnerCapScore?.expectedOverflowDamagePerTurn, 2,
  'enemy overflow frequency uses the player target cap, not the enemy owner cap');
const actualLowTargetCapScore = core.scoreEnemyPower(lowOwnerCapEnemy, { maxLust: 25 });
assert.equal(actualLowTargetCapScore?.expectedOverflowDamagePerTurn, 8,
  'an explicit player target cap is part of the enemy-score cache context');

console.log('Deck/enemy scores, difficulty budgets, current-resource separation, and cache invariants passed.');
