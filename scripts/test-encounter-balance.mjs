import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

function playerPack() {
  return core.createContentPack({
    cards: [
      { id: 'strike', name: '攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 6 } },
      { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 5 } },
    ],
    playerDesireEffect: { id: 'overflow', name: '欲望反击', effects: { damage: 6 } },
  });
}

function encounterPack() {
  const player = playerPack();
  return core.createContentPack({
    cards: player.cards,
    playerDesireEffect: player.desireEffects.player,
    enemy: {
      id: 'calibration_enemy',
      name: '校准敌人',
      description: '名称、描述和机制必须在数值校准后保持不变。',
      hp: 45,
      max_hp: 60,
      actions: [
        {
          id: 'multi_hit',
          name: '连续攻击',
          description: '连续攻击两次。',
          effects: { damage: 8, hits: 2, apply_status: 'pressure', stacks: 2, to: 'opponent' },
        },
        { id: 'guard', name: '蓄势防守', description: '获得格挡。', effects: { block: 5 } },
      ],
      lust_effect: { id: 'overflow', name: '失控追击', effects: { damage: 8 } },
      action_mode: 'sequence_loop',
      action_config: {},
    },
  });
}

const profile = core.profileDeckPower({ pack: playerPack(), maxHp: 80, seeds: 8 });

const ratios = [10, 50, 80, 100, 110];
const envelopes = ratios.map(requestedRatio => core.createEnemyBudgetEnvelope({
  profile,
  requestedRatio,
  currentHp: 80,
  inheritedMechanics: ['连续攻击', '连续攻击', '蓄势'],
}));

for (let index = 1; index < envelopes.length; index += 1) {
  assert.ok(envelopes[index].targetScore > envelopes[index - 1].targetScore, 'target score must increase with difficulty');
  assert.ok(envelopes[index].durability.hp.min >= envelopes[index - 1].durability.hp.min, 'durability must be monotonic');
  assert.ok(envelopes[index].pressureByTurn[0].hpDamage.min >= envelopes[index - 1].pressureByTurn[0].hpDamage.min, 'pressure must be monotonic');
}
assert.deepEqual(envelopes.at(-1).inheritedMechanics, ['连续攻击', '蓄势']);

const resourceCapped = core.createEnemyBudgetEnvelope({
  profile,
  requestedRatio: 110,
  currentHp: 4,
  currentLust: 92,
  maxLust: 100,
});
assert.ok(resourceCapped.effectiveRatio < resourceCapped.requestedRatio, 'low current resources must cap encounter difficulty');
assert.equal(profile.maxHp, 80, 'current HP must not mutate or replace the persistent max-HP score input');

const source = encounterPack();
const scaled = core.scaleEncounterNumbers(source, 1.5);
assert.equal(scaled.pack.enemy.name, source.enemy.name);
assert.equal(scaled.pack.enemy.description, source.enemy.description);
assert.equal(scaled.pack.enemy.actions[0].name, source.enemy.actions[0].name);
assert.equal(scaled.pack.enemy.actions[0].effects.hits, 2, 'hit cadence must never be scaled');
assert.equal(scaled.pack.enemy.hp / scaled.pack.enemy.max_hp, source.enemy.hp / source.enemy.max_hp, 'story damage ratio must be preserved');
assert.equal(scaled.pack.enemy.actions[0].effects.damage, 12);
assert.equal(scaled.pack.enemy.actions[0].effects.stacks, 3);

const balanced = core.calibrateEncounterNumbers({
  pack: source,
  profile,
  requestedRatio: 100,
  currentHp: 80,
  seeds: 8,
});
const balancedEngine = balanced.simulation?.strategies.find(strategy => strategy.strategy === 'engine');
assert.equal(balanced.winnableAtCurrentResources, true);
assert.ok((balancedEngine?.winRate || 0) >= 0.58, '100% frontier must keep a skilled median line winnable');
assert.ok((balancedEngine?.medianHpRatio || 0) >= 0.985, '100% frontier must be close to clean on the reference median line');
assert.equal(balanced.calibratedPack.enemy.actions[0].effects.hits, 2);
assert.ok(
  Math.abs(
    balanced.calibratedPack.enemy.hp / balanced.calibratedPack.enemy.max_hp
      - source.enemy.hp / source.enemy.max_hp,
  ) <= 0.002,
  'calibration must preserve pre-battle story damage within display rounding',
);

const pressured = core.calibrateEncounterNumbers({
  pack: source,
  profile,
  requestedRatio: 110,
  currentHp: 80,
  seeds: 8,
});
const pressuredEngine = pressured.simulation?.strategies.find(strategy => strategy.strategy === 'engine');
assert.equal(pressured.winnableAtCurrentResources, true, '110% must remain winnable');
assert.ok((pressuredEngine?.medianHpRatio || 1) < (balancedEngine?.medianHpRatio || 0), '110% should consume more resources than 100%');

console.log('Encounter balance preserves authored mechanics while enforcing monotonic budgets and a winnable 100/110 frontier.');
