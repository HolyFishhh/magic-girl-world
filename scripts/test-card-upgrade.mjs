import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const upgrades = require(resolve('src/game-core/cardUpgrade.ts'));

const base = {
  id: 'moon_slash',
  name: '月轮斩',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  quantity: 3,
  description: '造成6点伤害。',
  effects: [{ damage: 6 }],
};
const deck = [base, { ...base, id: 'guard', name: '守护', type: 'Skill', effects: [{ block: 5 }] }];
const patch = {
  node_id: 'a1_f3_rest_0',
  card_id: 'moon_slash',
  effects: [{ damage: 9 }],
};

assert.equal(
  upgrades.applyCardUpgrade(base, { node_id: 'a1_f3_rest_0', card_id: 'moon_slash', effects: [{ damage: 9 }] }).ok,
  true,
);
assert.equal(
  upgrades.applyCardUpgrade(base, {
    node_id: 'a1_f3_rest_0',
    card_id: 'moon_slash',
    id: 'moon_slash',
    upgrade_level: 0,
    effects: [{ damage: 9 }],
  }).ok,
  true,
  'models may echo the selected card id and current upgrade level without invalidating the patch',
);
assert.deepEqual(
  upgrades.applyCardUpgrade(base, { node_id: '', card_id: 'moon_slash', effects: [{ damage: 9 }] }),
  { ok: false, message: 'upgrade node_id must be a non-empty string' },
);

const upgraded = upgrades.applyCardUpgradeToDeck(deck, patch);
assert.equal(upgraded.ok, true);
assert.equal(upgraded.card.id, 'moon_slash');
assert.equal(upgraded.card.name, '月轮斩+');
assert.equal(upgraded.card.quantity, 3);
assert.equal(upgraded.card.upgrade_level, 1);
assert.deepEqual(upgraded.card.effects, [{ damage: 9 }]);
assert.equal(upgraded.card.description, undefined, 'rule changes without prose must switch to generated descriptions');
assert.deepEqual(deck[0], base, 'upgrade must not mutate the source deck');

const second = upgrades.applyCardUpgrade(upgraded.card, {
  node_id: 'a1_f3_rest_0',
  card_id: 'moon_slash',
  description: '造成9点伤害，费用变为0。',
  cost: 0,
}, { maxLevel: 2 });
assert.equal(second.ok, true);
assert.equal(second.card.name, '月轮斩+2');
assert.equal(second.card.cost, 0);

const innateUpgrade = upgrades.applyCardUpgrade(base, {
  node_id: 'a1_f3_rest_0',
  card_id: 'moon_slash',
  innate: true,
});
assert.equal(innateUpgrade.ok, true);
assert.equal(innateUpgrade.card.innate, true);

assert.deepEqual(
  upgrades.applyCardUpgrade(base, { ...patch, effects: [{ damage: 'unknown + 1' }] }),
  { ok: false, message: '$[0].damage.left: Unsupported variable: unknown' },
);
assert.equal(upgrades.applyCardUpgrade(base, { ...patch, id: 'hijack' }).ok, false);
assert.equal(upgrades.applyCardUpgrade(base, { ...patch, upgrade_level: 1 }).ok, false);
assert.equal(upgrades.applyCardUpgrade(base, { node_id: 'a1_f3_rest_0', card_id: 'moon_slash', effects: [{ damage: 6 }] }).ok, false);
assert.equal(upgrades.applyCardUpgrade(base, { node_id: 'a1_f3_rest_0', card_id: 'other', description: '错误', effects: [{ damage: 9 }] }).ok, false);
assert.equal(upgrades.applyCardUpgrade(upgraded.card, patch).ok, false, 'default upgrade limit is one');
assert.equal(
  upgrades.applyCardUpgrade(base, {
    node_id: 'a1_f3_rest_0', card_id: 'moon_slash', description: '错误固有标记。', innate: 'true',
  }).ok,
  false,
);

assert.deepEqual(
  upgrades.applyCardUpgrade(base, {
    node_id: 'a1_f3_rest_0',
    card_id: 'moon_slash',
    description: '施加2层月蚀。',
    effects: [{ apply_status: 'eclipse', stacks: 2 }],
  }, { knownStatusIds: [] }),
  { ok: false, message: '引用了未注册状态: eclipse' },
);
assert.equal(
  upgrades.applyCardUpgrade(base, {
    node_id: 'a1_f3_rest_0',
    card_id: 'moon_slash',
    description: '施加2层月蚀。',
    effects: [{ apply_status: 'eclipse', stacks: 2 }],
  }, { knownStatusIds: ['eclipse'] }).ok,
  true,
);

const ambiguous = upgrades.applyCardUpgradeToDeck([base, structuredClone(base)], patch);
assert.deepEqual(ambiguous, { ok: false, message: 'selected card id is ambiguous' });

console.log('Portable on-demand card upgrade patches preserve identity and reject malformed formulas atomically.');
