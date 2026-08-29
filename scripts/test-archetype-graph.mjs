import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

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

console.log('Archetype catalog, multi-affinity scoring, narrative-skin invariance, and evolution graph passed.');
