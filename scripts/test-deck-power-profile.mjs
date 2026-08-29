import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

function referencePack(name = '攻击') {
  return core.createContentPack({
    cards: [
      { id: 'strike', name, type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 6 } },
      { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 5 } },
    ],
    playerDesireEffect: { id: 'overflow', effects: { damage: 6 } },
  });
}

const started = performance.now();
const profile = core.profileDeckPower({ pack: referencePack(), maxHp: 80, seeds: 8 });
const elapsed = performance.now() - started;
assert.equal(profile.spec, 'mwg.deck-power/v2');
assert.ok(profile.totalScore >= 70 && profile.totalScore <= 140, `reference score drifted to ${profile.totalScore}`);
assert.deepEqual(Object.keys(profile.horizons).map(Number), [1, 2, 3, 5, 8]);
assert.equal(profile.probeFrontiers.length, 6);
assert.equal(profile.archetypes.some(entry => entry.id === 'direct-pressure'), true);
assert.ok(profile.horizons[5].hpDamage.p10 <= profile.horizons[5].hpDamage.p50);
assert.ok(profile.horizons[5].hpDamage.p50 <= profile.horizons[5].hpDamage.p90);
assert.ok(elapsed < 5000, `initial profile took ${Math.round(elapsed)}ms`);

const cachedStarted = performance.now();
assert.strictEqual(core.profileDeckPower({ pack: referencePack(), maxHp: 80, seeds: 8 }), profile);
assert.ok(performance.now() - cachedStarted < elapsed);

const renamed = core.profileDeckPower({ pack: referencePack('完全不同的展示名'), maxHp: 80, seeds: 8 });
assert.equal(renamed.totalScore, profile.totalScore, 'presentation names must not alter the score');

const reidentified = core.profileDeckPower({
  pack: core.createContentPack({
    cards: [
      { id: 'another_strike_id', name: '另一攻击名', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 6 } },
      { id: 'another_guard_id', name: '另一防御名', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 5 } },
    ],
    playerDesireEffect: { id: 'another_overflow_id', effects: { damage: 6 } },
  }),
  maxHp: 80,
  seeds: 8,
});
assert.equal(reidentified.totalScore, profile.totalScore, 'author IDs must not alter mechanically identical deck samples');

const polluted = core.profileDeckPower({
  pack: core.createContentPack({
    cards: [
      ...referencePack().cards,
      { id: 'dead_curse', name: '沉重诅咒', type: 'Curse', rarity: 'Corrupt', quantity: 2, effects: { damage: 2, to: 'self' } },
    ],
    playerDesireEffect: { id: 'overflow', effects: { damage: 6 } },
  }),
  maxHp: 80,
  seeds: 8,
});
assert.ok(
  polluted.totalScore < profile.totalScore,
  `dead curse copies must lower persistent deck power (${polluted.totalScore} >= ${profile.totalScore})`,
);
assert.equal(polluted.deckQuality.deadCopies, 2);

const unaffordable = core.profileDeckPower({
  pack: core.createContentPack({
    cards: [
      ...referencePack().cards,
      { id: 'unaffordable', name: '无法运转', type: 'Attack', rarity: 'Common', cost: 4, quantity: 2, effects: { damage: 5 } },
    ],
    playerDesireEffect: { id: 'overflow', effects: { damage: 6 } },
  }),
  maxHp: 80,
  seeds: 8,
});
assert.ok(unaffordable.totalScore < profile.totalScore, 'cards outside the deck resource envelope must lower power');
assert.equal(unaffordable.deckQuality.hardToPlayCopies, 2);
assert.equal(unaffordable.deckQuality.inefficientCopies, 2);

const offPlanClog = core.profileDeckPower({
  pack: core.createContentPack({
    cards: [
      ...referencePack().cards,
      { id: 'off_plan_clog', name: '无联动弃牌', type: 'Skill', rarity: 'Common', cost: 2, quantity: 2, effects: { discard: 1, from: 'hand', pick: 'random' } },
    ],
    playerDesireEffect: { id: 'overflow', effects: { damage: 6 } },
  }),
  maxHp: 80,
  seeds: 8,
});
assert.ok(offPlanClog.totalScore < profile.totalScore, 'an inefficient card outside the current archetype must lower power');
assert.equal(offPlanClog.deckQuality.offPlanCopies, 2);

const efficientUpgrade = core.profileDeckPower({
  pack: core.createContentPack({
    cards: [
      ...referencePack().cards,
      { id: 'efficient_upgrade', name: '高效强袭', type: 'Attack', rarity: 'Rare', cost: 1, quantity: 2, effects: { damage: 12 } },
    ],
    playerDesireEffect: { id: 'overflow', effects: { damage: 6 } },
  }),
  maxHp: 80,
  seeds: 8,
});
assert.ok(efficientUpgrade.totalScore > profile.totalScore, 'the pollution model must not punish efficient additions');
assert.equal(efficientUpgrade.deckQuality.multiplier, 1);

const largerReserve = core.profileDeckPower({ pack: referencePack(), maxHp: 120, seeds: 8 });
assert.ok(largerReserve.totalScore > profile.totalScore, 'maximum HP must affect persistent build power');

const detonation = core.scoreContentArchetypes({
  id: 'detonate', type: 'Attack', cost: 1,
  effects: [{ damage: '4 + opponent.status.mark.stacks * 3' }, { remove_status: 'mark', to: 'opponent' }],
});
assert.ok(detonation.some(entry => entry.id === 'status-detonation' && entry.score >= 50));

const deckGraph = core.profileDeckArchetypes(core.createContentPack({
  cards: [
    { id: 'seed', type: 'Skill', quantity: 4, effects: { apply_status: 'mark', stacks: 2, to: 'opponent' } },
    { id: 'cash', type: 'Attack', quantity: 2, effects: [{ damage: '4 + opponent.status.mark.stacks * 3' }, { remove_status: 'mark' }] },
    { id: 'utility', type: 'Skill', quantity: 2, effects: { draw: 1 } },
  ],
}));
assert.ok(deckGraph.affinities.length > 0);
assert.ok(deckGraph.scatterShare >= 0 && deckGraph.scatterShare <= 100);

console.log(`Deck power v2 produced probe frontiers, horizon distributions, and archetype affinities in ${Math.round(elapsed)}ms.`);
