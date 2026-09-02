import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { normalizeMvuBattleContent } = require(resolve('src/runtime/mvuBattleContentNormalizer.ts'));
const { createContentPackFromMvuBattle } = require(resolve('src/runtime/contentPackAdapter.ts'));
const { validateContentPackContract } = require(resolve('src/game-core/index.ts'));

const source = {
  core: { emoji: '🌌', hp: 88, max_hp: 100, lust: 15, max_lust: 100 },
  statuses: [{
    id: '星屑刻印', name: '星屑刻印', emoji: '✨', type: 'debuff', description: '每层造成伤害。',
    triggers: {
      tick: [{ damage: { formula: 'stacks' } }],
      hold: { modify: { attribute: 'damage_taken', add: 2 } },
    }, maxStacks: 10,
  }],
  cards: [
    { id: 'strike', name: '星屑挥击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: [{ damage: 6 }] },
    { id: 'guard', name: '共鸣屏障', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: [{ block: 5 }] },
    {
      id: 'converge', name: '星钻集束', type: 'Attack', rarity: 'Uncommon', cost: 2, quantity: 1,
      effects: [
        {
          damage: { formula: '10 + self.opponent.status.星屑刻印.stacks' },
          when: 'self|opponent.status.星屑刻印.stacks >= 1',
        },
        {
          apply_status: {
            id: '星屑刻印', name: '星屑刻印', emoji: '✨', type: 'debuff',
            description: '每层造成伤害。', triggers: {}, stacks: 2,
          },
        },
      ],
    },
  ],
  artifacts: [{
    id: 'starlit_eye', name: '星瞳', rarity: 'Uncommon',
    trigger: { on: 'battle_start', effects: [{ apply_status: { id: '星屑刻印', stacks: 1, to: 'opponent' } }] },
  }],
  items: [{ id: 'pouch', name: '星尘袋囊', count: 1, effects: [{ heal: 8 }] }],
  player_abilities: [], player_status_effects: [], enemies: [],
  player_lust_effect: {
    name: '星核失控', effects: [
      { damage: { formula: 'opponent.max_hp * 0.2' } },
      { apply_status: { id: '星屑刻印', stacks: 8, to: 'opponent' } },
      { block: 15 },
    ],
  },
};

const normalized = normalizeMvuBattleContent(source);
assert.match(normalized.statuses[0].id, /^status_[a-z0-9_]+$/);
assert.equal(normalized.statuses[0].name, '星屑刻印');
assert.equal(normalized.statuses[0].triggers.tick[0].damage, 'stacks');
assert.deepEqual(normalized.statuses[0].triggers.hold, { modify: 'damage_taken', add: 2 });
assert.equal(normalized.cards[2].effects[0].damage, `10 + opponent.status.${normalized.statuses[0].id}.stacks`);
assert.equal(normalized.cards[2].effects[0].when, `opponent.status.${normalized.statuses[0].id}.stacks >= 1`);
assert.deepEqual(normalized.cards[2].effects[1], { apply_status: normalized.statuses[0].id, stacks: 2 });
assert.deepEqual(normalized.artifacts[0].trigger.effects[0], {
  apply_status: normalized.statuses[0].id, stacks: 1, to: 'opponent',
});
assert.equal(normalized.player_lust_effect.effects[0].damage, 'opponent.max_hp * 0.2');
assert.equal(source.statuses[0].id, '星屑刻印', 'normalization must not mutate the caller snapshot');

const contract = validateContentPackContract(createContentPackFromMvuBattle(source), { requireExecutable: true });
assert.equal(contract.ok, true, contract.ok ? '' : JSON.stringify(contract.issues));

const nestedResourceTarget = normalizeMvuBattleContent({
  core: {
    resources: [{ id: 'stardust', name: 'Stardust', emoji: '*', current: 3, max: 3, refresh: 'reset' }],
  },
  statuses: [],
  cards: [],
  artifacts: [],
  items: [],
  player_abilities: [],
  player_status_effects: [],
  player_lust_effect: {
    name: 'Burst',
    effects: [{ set_resource: { id: 'stardust', value: 0, to: 'self' } }],
  },
});
assert.deepEqual(nestedResourceTarget.player_lust_effect.effects[0], {
  set_resource: { id: 'stardust', value: 0 },
  to: 'self',
});

console.log('MVU battle normalization canonicalizes equivalent ids, formula wrappers, and status references.');
