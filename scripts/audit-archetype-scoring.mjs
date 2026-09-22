// Diagnostic observations, not assertions that today's scores/classifications are correct.
// node scripts/audit-archetype-scoring.mjs [--measured] [--output=tmp/archetype-scoring-audit.json]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createContentPack } = require('../src/game-core/contentPack.ts');
const { profileDeckArchetypes, ARCHETYPE_GRAPH } = require('../src/game-core/archetypeGraph.ts');
const { TOWER_ARCHETYPE_PRESETS } = require('../src/game-core/towerArchetypeCatalog.ts');
const { scoreDeckPower, clearDeckPowerScoreCache } = require('../src/game-core/deckPowerScore.ts');
const { scoreEnemyPower, clearEnemyPowerScoreCache } = require('../src/game-core/enemyPowerScore.ts');
const { validateContentPackContract } = require('../src/game-core/contentContract.ts');

// Synthetic content only. Any accidental access to host saves must fail.
globalThis.getVariables = () => { throw Error('Audit touched host storage'); };
globalThis.replaceVariables = globalThis.getVariables;
const card = (id, effects, extra = {}) => ({ id, name: id, type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects, ...extra });
const status = (id, triggers) => ({ id, name: id, emoji: '◇', type: 'buff', triggers });
const baseCards = [card('hit', { damage: 6 }, { type: 'Attack', quantity: 5 }), card('guard', { block: 5 }, { quantity: 5 })];
const overflow = { name: '满溢护盾', effects: { block: 1, to: 'self' } };
const resource = current => [{ id: 'mana', name: '法力', emoji: '◇', current, start: current, max: 5, refresh: 'retain' }];
const cases = {
  base: { cards: baseCards },
  unusedStatus: { cards: baseCards, statuses: [status('unused', { turn_start: [{ damage: 100 }, { energy: 10 }, { heal: 20 }] })] },
  damage6: { cards: [card('hit', { damage: 6 }, { type: 'Attack', quantity: 5 })] },
  damage7: { cards: [card('hit', { damage: 7 }, { type: 'Attack', quantity: 5 })] },
  damage30: { cards: [card('hit', { damage: 30 }, { type: 'Attack', quantity: 5 })] },
  mixedIndependent: { cards: [card('mixed', [{ lust: 10 }, { damage: 10 }])], playerDesireEffect: overflow },
  sly: { cards: [card('sly', { damage: 10 }, { type: 'Attack', sly: true }), card('discard', { discard: 1 })] },
  abandoned: { cards: [card('vanish', { damage: 10 }, { type: 'Attack', lifecycle: { on_discard: 'remove' } }), card('discard', { discard: 1 })] },
  forgotten: { cards: [card('vanish', { damage: 10 }, { type: 'Attack', lifecycle: { on_discard: 'purge' } }), card('discard', { discard: 1 })] },
  zeroCost: { cards: [card('zero', [{ damage: 4 }, { draw: 1 }], { type: 'Attack', cost: 0, quantity: 5 })] },
  selfHealing: { cards: [card('heal', { heal: 10, to: 'self' })] },
  enemyHealing: { cards: [card('heal', { heal: 10, to: 'opponent' })] },
  selfShield: { cards: [card('mitigation', [{ apply_status: 'shield', stacks: 1, to: 'self' }, { damage: 8 }], { type: 'Attack' })],
    statuses: [status('shield', { hold: { modify: 'damage_taken', multiply: 0.5 } })] },
  basicUpgrade: { cards: [card('guard', { block: 6 }, { quantity: 5 }), card('ritual', [{ damage: 12 }, { draw: 1 }], { quantity: 2 })] },
  basicUpgrade7: { cards: [card('guard', { block: 7 }, { quantity: 5 }), card('ritual', [{ damage: 12 }, { draw: 1 }], { quantity: 2 })] },
  lifesteal: { cards: [card('drain', { damage: 10, lifesteal: 0.5 }, { type: 'Attack' })] },
  absentResource: { cards: [card('cost', { damage: 40 }, { type: 'Attack', cost: { mana: 2 }, quantity: 5 })], playerResources: resource(0) },
  availableResource: { cards: [card('cost', { damage: 40 }, { type: 'Attack', cost: { mana: 2 }, quantity: 5 })], playerResources: resource(5) },
};
let validatedPacks = 0;
function checkedPack(input, name) {
  const pack = createContentPack(input);
  const result = validateContentPackContract(pack, { requireExecutable: true });
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.issues)}`);
  validatedPacks++;
  return pack;
}
const output = { counts: { nodes: ARCHETYPE_GRAPH.length, presets: TOWER_ARCHETYPE_PRESETS.length }, cases: {}, cache: {}, enemy: {} };
for (const [key, input] of Object.entries(cases)) {
  const pack = checkedPack(input, key), before = structuredClone(pack);
  clearDeckPowerScoreCache();
  const score = scoreDeckPower({ pack, maxHp: 80 }), profile = profileDeckArchetypes(pack);
  assert.deepEqual(pack, before, `${key}: scoring mutated input`);
  assert.deepEqual(profileDeckArchetypes(pack), profile, `${key}: profile is nondeterministic`);
  output.cases[key] = { score: score.totalScore, budget: score.budget, dimensions: score.dimensions, coverage: score.coverage,
    flows: profile.affinities.map(a => ({ id: a.id, share: a.share, missing: a.missingPayoffs })), scatter: profile.scatterShare };
}
const statuses = [status('small', { hold: { modify: 'damage', add: 1 } }), status('big', { hold: { modify: 'damage', add: 20 } })];
const packA = checkedPack({ cards: baseCards, statuses, activeStatuses: [{ id: 'small', stacks: 1 }] }, 'cacheA');
const packB = checkedPack({ cards: baseCards, statuses, activeStatuses: [{ id: 'big', stacks: 1 }] }, 'cacheB');
clearDeckPowerScoreCache();
const a = scoreDeckPower({ pack: packA, maxHp: 80 }), bCached = scoreDeckPower({ pack: packB, maxHp: 80 });
clearDeckPowerScoreCache();
const bFresh = scoreDeckPower({ pack: packB, maxHp: 80 });
output.cache = { a: a.totalScore, bCached: bCached.totalScore, bFresh: bFresh.totalScore, collision: a.fingerprint === bFresh.fingerprint };

const enemyBase = { id: 'foe', name: '敌人', emoji: '◇', hp: 80, max_hp: 80, lust: 0, max_lust: 100,
  actions: [{ id: 'attack', name: '攻击', effects: { damage: 30 } }, { id: 'rest', name: '休息', effects: { wait: true } }] };
const thorns = amount => [{ id: 'thorns', name: '荆棘', trigger: { on: 'take_damage', effects: { damage: amount, to: 'opponent' } } }];
for (const [key, config] of Object.entries({ equal: {}, rareAttack: { action_mode: 'sequence', action_config: { sequence: ['attack', 'rest', 'rest', 'rest', 'rest'] } },
  thorns1: { abilities: thorns(1) }, thorns100: { abilities: thorns(100) } })) {
  clearEnemyPowerScoreCache();
  const score = scoreEnemyPower(checkedPack({ enemy: { ...enemyBase, ...config } }, `enemy.${key}`));
  output.enemy[key] = { score: score.totalScore, damage: score.expectedDamagePerTurn, actions: score.actions, coverage: score.coverage };
}

const path = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length) || 'tmp/archetype-scoring-audit.json';
const save = () => {
  output.validatedPacks = validatedPacks;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(output, null, 2) + '\n');
};
save();
if (process.argv.includes('--measured')) {
  const { measureTowerBuild } = require('../src/runtime/towerRuntimeBalance.ts');
  const { assessMeasuredBuild } = require('../src/game-core/buildAssessment.ts');
  output.measured = {};
  const measuredCards = Object.fromEntries(Object.entries({ noLust: [{ block: 40 }], nonlethalLust: [{ block: 40 }, { lust: 100, to: 'opponent', targets: { mode: 'all' } }] })
    .map(([key, effects]) => [key, [card(key, effects, { quantity: 5 })]]));
  for (const [key, cards] of Object.entries(measuredCards)) checkedPack({ cards, playerDesireEffect: overflow }, `measured.${key}`);
  for (const [key, cards] of Object.entries(measuredCards)) {
    const battle = { core: { hp: 80, max_hp: 80, lust: 0, max_lust: 100 }, cards, statuses: [], artifacts: [], items: [],
      player_lust_effect: overflow, enemies: [] };
    const before = structuredClone(battle);
    const measurement = await measureTowerBuild(battle, 2);
    assert.deepEqual(battle, before, 'Measured evaluation mutated its input');
    const assessment = assessMeasuredBuild(measurement);
    output.measured[key] = { measurement, assessment };
    save();
    console.log(`${key}: score=${assessment.score}, ${assessment.dimensions.combo}`);
  }
}
save();
console.log(`Audit observations written to ${path}; ${validatedPacks} synthetic packs passed executable contract validation.`);
console.log('This records current behavior. It does not certify score or archetype accuracy.');
