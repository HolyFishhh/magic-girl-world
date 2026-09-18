import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const m = require('../src/game-core/nonCombatDeckActions.ts');
const cards = [
  { id: 'same', type: 'Attack', quantity: 1, runInstanceId: 'a' },
  { id: 'same', type: 'Attack', quantity: 1, runInstanceId: 'b' },
  { id: 'same', type: 'Attack', quantity: 1, runInstanceId: 'c' },
];
const action = m.parseNonCombatDeckActions([{ id: 'cut', kind: 'remove', count: 2, pick: 'choose' }])[0];
const plan = m.planNonCombatDeckAction(cards, action, 'seed', ['a', 'c']);
assert.deepEqual(plan.selectedIds, ['a', 'c']);
const out = m.executeNonCombatDeckPlan(cards, plan, () => {});
assert.deepEqual(
  out.map(x => x.runInstanceId),
  ['b'],
);
const random = m.parseNonCombatDeckActions([{ id: 'r', kind: 'duplicate', count: 1, pick: 'random' }])[0];
assert.deepEqual(
  m.planNonCombatDeckAction(cards, random, 'same').selectedIds,
  m.planNonCombatDeckAction(cards, random, 'same').selectedIds,
);
assert.equal(m.planNonCombatDeckAction(cards, action, 'seed').pending, true);
assert.throws(() => m.planNonCombatDeckAction(cards, action, 'seed', ['a', 'a']));
const transform = m.parseNonCombatDeckActions([
  { id: 't', kind: 'transform', count: 1, pick: 'choose', replacement: { id: 'new', type: 'Skill', quantity: 1 } },
])[0];
const changed = m.executeNonCombatDeckPlan(cards, m.planNonCombatDeckAction(cards, transform, 'execute', ['b']), x =>
  assert.equal(x.id, 'new'),
);
assert.equal(changed.find(x => x.runInstanceId === 'b').templateId, 'new');
assert.throws(() =>
  m.parseNonCombatDeckActions([{ id: 'bad', kind: 'remove', count: 1, pick: 'choose', extra: true }]),
);
const frozen = m.planNonCombatDeckAction(cards, random, 'frozen');
assert.throws(
  () =>
    m.executeNonCombatDeckPlan(
      cards.filter(c => c.runInstanceId !== frozen.selectedIds[0]),
      frozen,
      () => {},
    ),
  /stale/,
);
assert.throws(
  () => m.executeNonCombatDeckPlan(cards, { ...plan, selectedIds: ['a', 'a'], pending: false }, () => {}),
  /stale/,
);
const unique = [{ id: 'only', type: 'Skill', unique: true, runInstanceId: 'u' }],
  copy = m.parseNonCombatDeckActions([{ id: 'copy', kind: 'duplicate', count: 1, pick: 'choose' }])[0];
assert.throws(() => m.executeNonCombatDeckPlan(unique, m.planNonCombatDeckAction(unique, copy, 'u', ['u']), () => {}));
assert.throws(() => m.planNonCombatDeckAction(cards, { ...action, count: 4 }, 's', ['a', 'b', 'c', 'd']));
console.log('Non-combat deck action planning and atomic persistent mutations passed.');
