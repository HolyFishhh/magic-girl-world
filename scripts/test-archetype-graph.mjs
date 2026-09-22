import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

// Classifier feature names are not the authored DSL. The guide must teach the
// actual operation, not leak x_cost/x_formula or numeric-only modify_card as cost.
for (const effect of [{ x_cost: 2 }, { x_formula: 'x_value * 2' }, { modify_card: 'cost', add: -1 }]) {
  assert.equal(core.compileCompactEffectList(effect).ok, false, `internal feature must not become DSL: ${JSON.stringify(effect)}`);
}
for (const effect of [{ damage: 'spent_energy * 2' }, { patch_card: 'cost', subtract: 1 }, { reduce_cost: 1 }]) {
  const result = core.compileCompactEffectList(effect);
  assert.equal(result.ok, true, `documented composition must compile: ${JSON.stringify(result.issues)}`);
}

assert.ok(core.ARCHETYPE_GRAPH.length >= 45, 'the graph must cover a broad mechanic space rather than a few hard-coded decks');
assert.deepEqual(core.validateArchetypeGraph(), [], 'catalog ids and evolution edges must be structurally valid');

function statusDeck(statusId, statusName) {
  return core.createContentPack({
    statuses: [{
      id: statusId,
      name: statusName,
      type: 'debuff',
      triggers: { tick: { effects: { damage: 'self.status.' + statusId + '.stacks' } } },
      stacks_change: 'subtract:1',
    }],
    cards: [
      { id: 'seed', name: statusName + '施加', type: 'Skill', cost: 1, quantity: 4, effects: { apply_status: statusId, stacks: 3, to: 'opponent' } },
      { id: 'burst', name: statusName + '引爆', type: 'Attack', cost: 2, quantity: 2, effects: [
        { damage: 'opponent.status.' + statusId + '.stacks * 3' },
        { remove_status: statusId, to: 'opponent' },
      ] },
      { id: 'guard', name: '稳定防护', type: 'Skill', cost: 1, quantity: 4, effects: { block: 6 } },
    ],
  });
}

const first = core.profileDeckArchetypes(statusDeck('corrosion', '腐蚀'));
const reskinned = core.profileDeckArchetypes(statusDeck('embers', '余烬'));
assert.deepEqual(
  first.affinities.map(entry => [entry.id, entry.share]),
  reskinned.affinities.map(entry => [entry.id, entry.share]),
  'narrative status skins must share the same mechanic-level archetype distribution',
);
assert.ok(first.affinities.some(entry => entry.id === 'damage-over-time' || entry.id === 'status-stack'));
assert.ok(first.cards.find(card => card.id === 'burst').affinities.length >= 2, 'one card may contribute to several archetypes');
assert.ok(first.scatterShare >= 0, 'non-archetype utility remains represented as scatter instead of a forced identity');

const starterOnly = core.createContentPack({ cards: [{ id: 'starter', name: '基础斩击', type: 'Attack', effects: { damage: 6 } }] });
assert.equal(core.profileDeckArchetypes(starterOnly).affinities.some(entry => entry.id === 'direct-pressure'), false, 'plain 6 damage must not establish graph affinity');
const sevenDamage = core.createContentPack({ cards: [{ id: 'seven', name: '强力斩击', type: 'Attack', effects: { damage: 7 } }] });
assert.equal(core.profileDeckArchetypes(sevenDamage).affinities.some(entry => entry.id === 'direct-pressure'), false, 'a numeric-only starter upgrade must not establish a new identity');

const discardDeck = core.createContentPack({
  cards: [
    { id: 'filter', name: '筛选', type: 'Skill', cost: 0, quantity: 4, effects: { discard: { from: 'hand', pick: 'random' }, draw: 1 } },
    { id: 'return', name: '折返', type: 'Skill', cost: 1, quantity: 3, discard_effects: { draw: 1, energy: 1 }, effects: { block: 4 } },
    { id: 'payoff', name: '回收冲击', type: 'Attack', cost: 1, quantity: 3, effects: { damage: 'cards_discarded_this_turn * 4' } },
  ],
});
const discard = core.profileDeckArchetypes(discardDeck);
assert.ok(discard.affinities.some(entry => entry.id === 'discard-engine'));
assert.ok(discard.affinities.some(entry => entry.id === 'discard-payoff' || entry.id === 'tempo-cycle'));
assert.ok(discard.evolutionSuggestions.every(entry => entry.transitionCost >= 0 && entry.transitionCost <= 1));

const discardGenerationFeatures = core.extractContentMechanicFeatures({
  effects: { add_card: 'burden', to: 'discard', count: 2 },
  creates: [{ id: 'burden', name: '负担', type: 'Curse' }],
});
const reskinnedDiscardGenerationFeatures = core.extractContentMechanicFeatures({
  effects: { add_card: 'static_fragment', to: 'discard', count: 2 },
  creates: [{ id: 'static_fragment', name: '静电残片', type: 'Curse' }],
});
assert.ok(discardGenerationFeatures.operations.includes('add_card'));
assert.ok(discardGenerationFeatures.zones.includes('discard'));
assert.ok(!discardGenerationFeatures.targets.includes('discard'));
assert.deepEqual(
  discardGenerationFeatures,
  reskinnedDiscardGenerationFeatures,
  'generated discard-pile pollution must be classified by structure rather than narrative skin',
);

function currentReplayDeck(cardId, cardName) {
  return core.createContentPack({
    cards: [
      {
        id: cardId,
        name: cardName,
        type: 'Attack',
        rarity: 'Uncommon',
        cost: 1,
        quantity: 4,
        effects: [{ damage: 5 }, { replay_current: 1, when: 'cards_played_this_turn >= 2' }],
      },
      { id: `${cardId}_draw`, name: `${cardName}准备`, type: 'Skill', rarity: 'Common', cost: 0, quantity: 3, effects: { draw: 1 } },
    ],
  });
}

const replayFirst = core.profileDeckArchetypes(currentReplayDeck('echo_cut', '回声切割'));
const replayReskinned = core.profileDeckArchetypes(currentReplayDeck('mirror_song', '镜像吟唱'));
assert.ok(replayFirst.affinities.some(entry => entry.id === 'replay-chain'), 'replay_current belongs to the executable Replay loop');
assert.deepEqual(
  replayFirst.affinities.map(entry => [entry.id, entry.share]),
  replayReskinned.affinities.map(entry => [entry.id, entry.share]),
  'current-card Replay is classified by structure rather than card names or narrative skin',
);

function genericDebuffPayoffDeck(statusId, cardId, cardName) {
  return core.createContentPack({
    statuses: [{ id: statusId, name: `${cardName}标记`, emoji: '◈', type: 'debuff', triggers: {} }],
    cards: [
      { id: `${cardId}_setup`, name: `${cardName}铺设`, type: 'Skill', rarity: 'Common', cost: 1, quantity: 4, effects: { apply_status: statusId, stacks: 1 } },
      { id: cardId, name: cardName, type: 'Attack', rarity: 'Uncommon', cost: 2, quantity: 3, effects: { damage: 'opponent.has_debuff ? 18 : 9' } },
      { id: `${cardId}_guard`, name: `${cardName}防护`, type: 'Skill', rarity: 'Common', cost: 1, quantity: 3, effects: { block: 6 } },
    ],
  });
}

const genericDebuffPayoff = core.profileDeckArchetypes(genericDebuffPayoffDeck('fracture', 'fracture_payoff', '裂隙回收'));
const genericDebuffReskin = core.profileDeckArchetypes(genericDebuffPayoffDeck('static_mark', 'static_payoff', '静电回收'));
assert.ok(
  genericDebuffPayoff.affinities.some(entry => entry.id === 'enemy-status-benefit' || entry.id === 'status-scaling'),
  'generic status-kind predicates must feed the existing status payoff family instead of creating a narrative-specific node',
);
assert.deepEqual(
  genericDebuffPayoff.affinities.map(entry => [entry.id, entry.share]),
  genericDebuffReskin.affinities.map(entry => [entry.id, entry.share]),
  'generic status-kind predicates remain invariant across status and card names',
);

function summonPresenceDeck(summonId, summonName, payoffId, payoffName) {
  return core.createContentPack({
    cards: [
      {
        id: `${summonId}_call`, name: `呼唤${summonName}`, type: 'Skill', rarity: 'Common', cost: 1, quantity: 4,
        effects: [{
          spawn_summon: {
            id: summonId, name: summonName, emoji: '◇', max_hp: 8,
            actions: [{
              id: `${summonId}_act`, name: `${summonName}行动`,
              effects: [{ damage: 3 }, { summoner_effects: { block: 1 } }],
            }],
          },
        }, { block: 2, when: 'self.has_summon' }],
      },
      {
        id: payoffId, name: payoffName, type: 'Attack', rarity: 'Uncommon', cost: 1, quantity: 3,
        effects: { damage: 'self.has_summon ? 12 : 6' },
      },
      {
        id: `${payoffId}_scale`, name: `${payoffName}扩展`, type: 'Skill', rarity: 'Uncommon', cost: 1, quantity: 3,
        effects: { block: 'self.summon_count * 2' },
      },
    ],
  });
}

const summonPresenceFeatures = core.extractContentMechanicFeatures({
  effects: { block: 6, when: 'self.has_summon' },
});
assert.ok(summonPresenceFeatures.operations.includes('summon_condition'));
assert.ok(summonPresenceFeatures.axes.includes('召唤'));
const summonPresenceFirst = core.profileDeckArchetypes(
  summonPresenceDeck('clockwork_companion', '发条伙伴', 'clockwork_payoff', '协作冲击'),
);
const summonPresenceReskin = core.profileDeckArchetypes(
  summonPresenceDeck('paper_familiar', '纸灵', 'paper_payoff', '灵契回响'),
);
assert.ok(summonPresenceFirst.affinities.some(entry => entry.id === 'summon-engine' || entry.id === 'summon-swarm'));
assert.deepEqual(
  summonPresenceFirst.affinities.map(entry => [entry.id, entry.share]),
  summonPresenceReskin.affinities.map(entry => [entry.id, entry.share]),
  'summon-presence payoffs are classified by executable structure rather than summon or card names',
);

function allyConditionDeck(prefix, setupName, payoffName) {
  return core.createContentPack({
    cards: [
      {
        id: `${prefix}_sweep`, name: setupName, type: 'Attack', rarity: 'Common', cost: 1, quantity: 4,
        effects: { damage: 5, targets: { mode: 'all' } },
      },
      {
        id: `${prefix}_coordination`, name: payoffName, type: 'Skill', rarity: 'Uncommon', cost: 1, quantity: 3,
        effects: { block: 'self.ally_count * 3', when: 'self.has_ally' },
      },
      {
        id: `${prefix}_counter`, name: `${payoffName}反制`, type: 'Attack', rarity: 'Uncommon', cost: 1, quantity: 3,
        effects: { damage: 8, when: 'opponent.has_ally' },
      },
    ],
  });
}

const allyConditionFeatures = core.extractContentMechanicFeatures({
  effects: { damage: 'opponent.ally_count * 2', when: 'opponent.has_ally' },
});
assert.ok(allyConditionFeatures.operations.includes('ally_condition'));
assert.ok(allyConditionFeatures.axes.includes('多目标'));
const allyConditionFirst = core.profileDeckArchetypes(
  allyConditionDeck('formation', '阵列横扫', '协同壁垒'),
);
const allyConditionReskin = core.profileDeckArchetypes(
  allyConditionDeck('chorus', '合唱震波', '共鸣屏障'),
);
assert.deepEqual(
  allyConditionFirst.affinities.map(entry => [entry.id, entry.share]),
  allyConditionReskin.affinities.map(entry => [entry.id, entry.share]),
  'ally-count mechanics remain invariant across unrelated narrative skins',
);

console.log('Archetype catalog, multi-affinity scoring, narrative-skin invariance, and evolution graph passed.');

assert.ok(first.affinities.length>1);
assert.ok(first.affinities.every(entry=>entry.share<100), "overlapping matches must not each become 100% build emphasis");
assert.ok(Math.abs(first.affinities.reduce((sum,entry)=>sum+entry.share,first.scatterShare)-100)<1, "owned evidence is conserved rather than multiplied by matching labels");
