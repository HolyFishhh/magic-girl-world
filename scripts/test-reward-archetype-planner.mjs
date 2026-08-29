import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const pack = core.createContentPack({
  statuses: [{
    id: 'echo_mark',
    name: '余响',
    type: 'debuff',
    triggers: { tick: { effects: { damage: 'self.status.echo_mark.stacks' } } },
    stacks_change: 'subtract:1',
  }],
  cards: [
    { id: 'seed', name: '刻痕', type: 'Skill', cost: 1, quantity: 4, effects: { apply_status: 'echo_mark', stacks: 2, to: 'opponent' } },
    { id: 'burst', name: '清算', type: 'Attack', cost: 2, quantity: 2, effects: [{ damage: 'opponent.status.echo_mark.stacks * 3' }, { remove_status: 'echo_mark', to: 'opponent' }] },
    { id: 'guard', name: '护持', type: 'Skill', cost: 1, quantity: 4, effects: { block: 6 } },
  ],
});

const plan = core.createRewardArchetypePlan({ pack, maxHp: 80, recentStructures: ['old-a', 'old-b'] });
assert.equal(plan.spec, 'mwg.reward-archetype-plan/v1');
assert.equal(plan.directions.map(entry => entry.kind).join(','), 'reinforce,bridge,pivot,universal');
assert.ok(plan.baseDeckScore > 0);
assert.ok(plan.primaryArchetypes.every(entry => entry.description.length > 0));
assert.ok(plan.weakestDimensions.length >= 2);
assert.deepEqual(plan.avoidRecentStructures, ['old-a', 'old-b']);

const reinforce = core.evaluateRewardCandidateArchetype({
  pack,
  maxHp: 80,
  candidate: {
    id: 'echo_harvest',
    name: '余响收束',
    type: 'Attack',
    cost: 1,
    effects: { damage: '4 + opponent.status.echo_mark.stacks * 2' },
  },
});
assert.ok(reinforce.affinities.some(entry => entry.id === 'status-stack' || entry.id === 'status-detonation'));
assert.ok(Number.isFinite(reinforce.deckScoreDelta));
assert.ok(reinforce.selectionValue >= 0 && reinforce.selectionValue <= 100);

const utility = core.evaluateRewardCandidateArchetype({
  pack,
  maxHp: 80,
  candidate: { id: 'steady_draw', name: '定息', type: 'Skill', cost: 0, effects: { draw: 1, block: 3 } },
});
assert.ok(Object.hasOwn(utility.pathScores, 'universal'));
assert.ok(Number.isFinite(utility.relativeDeckScoreDelta));

const contributions = core.profileDeckCardContributions({ pack, maxHp: 80 });
assert.equal(contributions.length, pack.cards.length);
assert.ok(contributions.every(entry => Number.isFinite(entry.scoreContribution)));

console.log('Reward generation paths, marginal deck deltas, archetype affinities, and card contributions passed.');
