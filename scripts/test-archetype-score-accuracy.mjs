import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createContentPack } = require('../src/game-core/contentPack.ts');
const { profileDeckArchetypes, scoreContentArchetypes } = require('../src/game-core/archetypeGraph.ts');
const { extractArchetypeEvidence } = require('../src/game-core/archetypeEvidence.ts');
const { compileCompactEffectList } = require('../src/game-core/compactEffectDsl.ts');
const { createDeckPowerProfileFingerprint } = require('../src/game-core/deckPowerProfile.ts');
const { scoreDeckPower } = require('../src/game-core/deckPowerScore.ts');
const { validateContentPackContract } = require('../src/game-core/contentContract.ts');
const output = 'tmp/scoring-accuracy-regression.json';
execFileSync(process.execPath, ['scripts/audit-archetype-scoring.mjs', `--output=${output}`], { windowsHide: true });
const audit = JSON.parse(readFileSync(output, 'utf8')), c = audit.cases;
assert.equal(audit.validatedPacks, 24);
assert.equal(c.base.score, c.unusedStatus.score, 'unreachable definitions grant no static benefit');
assert.equal(audit.cache.collision, false);
assert.equal(audit.cache.bCached, audit.cache.bFresh, 'cached and fresh evaluation agree after switching a status ID');
assert.ok(audit.cache.bFresh > audit.cache.a);
assert.deepEqual(c.basicUpgrade.flows, c.basicUpgrade7.flows, 'numeric starter upgrades do not change identity');
assert.ok(c.sly.flows.some(x => x.id === 'discard-payoff' && !x.missing.length));
assert.ok(c.sly.flows.some(x => x.id === 'discard-engine' && !x.missing.length));
for (const key of ['abandoned', 'forgotten']) assert.ok(!c[key].flows.some(x => x.id === 'discard-payoff'), 'discard removal is not free execution');
assert.ok(c.zeroCost.flows.some(x => x.id === 'zero-cost-engine'));
assert.ok(c.selfHealing.flows.some(x => x.id === 'healing-engine'));
assert.ok(!c.enemyHealing.flows.some(x => x.id === 'healing-engine'));
assert.ok(!c.selfShield.flows.some(x => ['critical-scaling', 'healing-conversion'].includes(x.id)));
assert.ok(c.absentResource.dimensions.consistency < c.availableResource.dimensions.consistency);
assert.equal(audit.enemy.rareAttack.damage, 6);
assert.ok(audit.enemy.rareAttack.score < audit.enemy.equal.score);
assert.ok(audit.enemy.thorns1.coverage <= 0.6 && audit.enemy.thorns100.coverage <= 0.6, 'unmodeled reactive passives must not claim full coverage');

const card = (effects, extra = {}) => ({ id: 'test', name: '黑暗仪式', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects, ...extra });
const status = { id: 'recovery', name: '滋养', emoji: '◇', type: 'buff', triggers: { turn_start: { heal: 4 } } };
for (const target of ['self', 'opponent']) {
  const pack = createContentPack({ cards: [card({ apply_status: 'recovery', to: target })], statuses: [status] });
  assert.equal(validateContentPackContract(pack, { requireExecutable: true }).ok, true);
  assert.equal(profileDeckArchetypes(pack).affinities.some(x => x.id === 'healing-engine'), target === 'self', 'status holder decides who receives healing');
}
for (const [effects, id] of [[{ damage: 'opponent.lust * 2' }, 'desire-conversion'], [{ damage: { history: { metric: 'last_heal', scope: 'combat' } } }, 'healing-conversion']]) {
  const definition = card(effects), compiled = compileCompactEffectList(effects);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
  for (const value of [definition, { ...definition, effects: undefined, effectProgram: compiled.value }]) {
    assert.ok(scoreContentArchetypes(value).some(x => x.id === id), `causal ${id} survives compilation`);
  }
}
const lifecyclePack = createContentPack({ cards: [card({ damage: 10 }, { lifecycle: { on_discard: 'purge' } })] });
assert.ok(extractArchetypeEvidence(lifecyclePack.cards[0]).operations.includes('discard_purge'));
assert.ok(scoreDeckPower({ pack: lifecyclePack, maxHp: 80 }).reasons.some(x => x.includes('永久删牌')));
assert.deepEqual(profileDeckArchetypes(JSON.parse(JSON.stringify(lifecyclePack))), profileDeckArchetypes(lifecyclePack));
const base = createContentPack({ cards: [card({ damage: 10 })] });
const signature = pack => createDeckPowerProfileFingerprint({ pack, maxHp: 80 });
for (const [field, value] of [['playerStance', { id: 'form' }], ['playerOrbs', [{ id: 'orb' }]], ['playerOrbSlots', 3],
  ['playerCardPatches', [{ id: 'patch' }]], ['playerSummonGrowth', [{ id: 'growth' }]]]) {
  assert.notEqual(signature({ ...base, [field]: value }), signature(base), `${field} is an evaluation dependency`);
}
assert.equal(signature({ ...base, enemy: { id: 'unrelated' }, enemies: [{ id: 'unrelated' }] }), signature(base), 'enemy changes do not alter persistent player build cache');
console.log('PASS scoring accuracy: validated counterexamples, cache identities, ownership, causal/compiled parity, lifecycle risks and save stability');
