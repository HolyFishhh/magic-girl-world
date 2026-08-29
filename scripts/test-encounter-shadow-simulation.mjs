import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

function fixture(cardName = '斩击', enemyName = '守门者') {
  return core.createContentPack({
    cards: [
      { id: 'strike', name: cardName, type: 'Attack', cost: 1, quantity: 5, effects: { damage: 7 } },
      { id: 'guard', name: '防御', type: 'Skill', cost: 1, quantity: 5, effects: { block: 6 } },
    ],
    enemy: {
      id: 'gatekeeper',
      name: enemyName,
      hp: 48,
      max_hp: 48,
      lust: 0,
      max_lust: 100,
      actions: [
        { name: '攻击', weight: 2, effects: { damage: 8 } },
        { name: '防守', weight: 1, effects: { block: 6 } },
      ],
      action_mode: 'probability',
      action_config: { probability: { 攻击: 2, 防守: 1 } },
      lust_effect: { name: '追击', effects: { damage: 5 } },
    },
  });
}

const player = { hp: 80, maxHp: 80, lust: 0, maxLust: 100 };
const first = core.simulateEncounterShadow({ pack: fixture(), player, seeds: 32 });
const second = core.simulateEncounterShadow({ pack: fixture(), player, seeds: 32 });
assert.deepEqual(second, first, 'the same mechanics and seeds must be deterministic');
assert.equal(first.spec, 'mwg.encounter-shadow/v1');
assert.equal(first.confidence, 'high');
assert.equal(first.strategies.length, 4);
for (const result of first.strategies) {
  assert.equal(result.runs, 32);
  assert.ok(result.winRate >= 0 && result.winRate <= 1);
  assert.ok(result.winRateLow <= result.winRateHigh);
  assert.ok(result.medianTurns >= 1 && result.medianTurns <= 16);
}

const renamed = core.simulateEncounterShadow({ pack: fixture('流星切', '暮色守卫'), player, seeds: 32 });
assert.deepEqual(renamed, first, 'names and presentation text must not change mechanical simulation');
assert.equal(core.createContentMechanicsFingerprint(fixture()), core.createContentMechanicsFingerprint(fixture('流星切', '暮色守卫')));

function xResourceFixture(max) {
  return core.createContentPack({
    playerResources: [{ id: 'stars', name: '星辉', emoji: '★', current: max, max, refresh: 'reset' }],
    cards: [{ id: 'nova', type: 'Attack', cost: { stars: 'all' }, quantity: 5, effects: { damage: 'x_resource.stars * 10' } }],
    enemy: {
      id: 'dummy', hp: 30, max_hp: 30,
      actions: [{ id: 'wait', name: '等待', effects: { block: 0 } }],
      lust_effect: { name: '无', effects: { damage: 0 } },
    },
  });
}
const lowResource = core.simulateEncounterShadow({ pack: xResourceFixture(1), player, seeds: 16 });
const highResource = core.simulateEncounterShadow({ pack: xResourceFixture(4), player, seeds: 16 });
assert.ok(
  highResource.strategies[0].medianTurns < lowResource.strategies[0].medianTurns,
  'shadow simulation applies the actual custom-resource X payment to card output',
);

const multiEnemy = core.simulateEncounterShadow({
  pack: core.createContentPack({
    cards: [{ id: 'sweep', type: 'Attack', cost: 1, quantity: 5, effects: { damage: 8 } }],
    enemies: [
      { id: 'left', hp: 8, max_hp: 8, actions: [{ id: 'poke', effects: { damage: 1 } }] },
      { id: 'right', hp: 8, max_hp: 8, actions: [{ id: 'poke', effects: { damage: 1 } }] },
    ],
  }),
  player,
  seeds: 16,
});
assert.ok(multiEnemy, 'multi-enemy encounters produce a bounded advisory estimate instead of null');
assert.equal(multiEnemy.confidence, 'high', 'simple multi-enemy turns and stable action order are directly covered');
assert.ok(multiEnemy.coverage.supportedFeatures.includes('multi_enemy_order'));
assert.equal(multiEnemy.coverage.unsupportedFeatures.length, 0);
assert.equal(multiEnemy.strategies.every(entry => entry.wins > 0), true);

const multiTarget = core.simulateEncounterShadow({
  pack: core.createContentPack({
    cards: [{ id: 'sweep', type: 'Attack', cost: 1, quantity: 5, effects: { damage: 8, targets: { mode: 'all' } } }],
    enemies: [
      { id: 'left', hp: 12, max_hp: 12, action_priority: 0, speed: 1, actions: [{ id: 'poke', effects: { damage: 1 } }] },
      { id: 'right', hp: 12, max_hp: 12, action_priority: 1, speed: 0, actions: [{ id: 'poke', effects: { damage: 1 } }] },
    ],
  }),
  player,
  seeds: 16,
});
assert.ok(multiTarget.coverage.supportedFeatures.includes('enemy_target_selector'));
assert.equal(multiTarget.confidence, 'high');
assert.ok(
  multiTarget.strategies[0].medianTurns <= multiEnemy.strategies[0].medianTurns,
  'all-target damage is applied to every living enemy instead of concentrating on the active target',
);

const complexCoverage = core.simulateEncounterShadow({
  pack: core.createContentPack({
    cards: [{ id: 'orb', type: 'Skill', cost: 1, quantity: 5, effects: { channel_orb: { id: 'spark', name: '火花', value: 3 } } }],
    enemy: { id: 'dummy', hp: 20, max_hp: 20, actions: [{ id: 'wait', effects: { block: 1 } }] },
  }),
  player,
  seeds: 8,
});
assert.ok(complexCoverage.coverage.unsupportedFeatures.includes('channel_orb'));
assert.equal(complexCoverage.confidence, 'low');

console.log('Encounter shadow simulation is deterministic, multi-strategy, bounded, and presentation invariant.');
