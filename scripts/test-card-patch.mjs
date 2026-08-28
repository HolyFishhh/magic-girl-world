import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const patching = require(resolve('src/game-core/cardPatch.ts'));

const baseCard = {
  id: 'strike__1',
  originalId: 'strike',
  templateId: 'strike',
  runInstanceId: 'strike__run__1',
  combatInstanceId: 'strike__1',
  type: 'Attack',
  rarity: 'Common',
  cost: 2,
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 6 }] },
};

const numeric = {
  id: 'status:rage:1:1',
  source: { kind: 'status', id: 'rage' },
  scope: 'turn',
  createdTurn: 1,
  priority: 0,
  removeOn: 'turn_end',
  kind: 'numeric',
  stat: 'damage',
  operator: 'multiply',
  value: 1.5,
};
const cost = {
  id: 'card:focus:1:1',
  source: { kind: 'card', id: 'focus' },
  scope: 'until_played',
  createdTurn: 1,
  priority: 1,
  removeOn: 'played',
  kind: 'cost',
  operator: 'subtract',
  value: 1,
};
const replay = {
  id: 'ability:echo:1:1',
  source: { kind: 'ability', id: 'echo' },
  scope: 'combat',
  createdTurn: 1,
  priority: 2,
  removeOn: 'combat_end',
  kind: 'replay',
  extra: 2,
};

let card = patching.appendCardPatch(baseCard, numeric);
card = patching.appendCardPatch(card, cost);
card = patching.appendCardPatch(card, replay);
assert.equal(card.effectProgram.steps[0].amount, 9);
assert.equal(card.cost, 1);
assert.equal(card.replayCount, 2);

card = patching.clearCardPatches(card, 'played');
assert.equal(card.cost, 2, 'until-played cost must restore from immutable base');
assert.equal(card.effectProgram.steps[0].amount, 9);
assert.equal(card.replayCount, 2);
card = patching.clearCardPatches(card, 'turn_end');
assert.equal(card.effectProgram.steps[0].amount, 6, 'turn patch cleanup must not accumulate rounding drift');

const enchantment = {
  id: 'enchantment:edge:0:1',
  source: { kind: 'enchantment', id: 'edge' },
  scope: 'permanent',
  createdTurn: 0,
  priority: 0,
  removeOn: 'manual',
  kind: 'keyword',
  keyword: 'retain',
  enabled: true,
};
const afflicted = patching.appendCardPatch(patching.appendCardPatch(baseCard, numeric), enchantment);
assert.deepEqual(
  patching.inheritedCardPatches(afflicted, patching.TEMPORARY_COPY_PATCH_POLICY).map(entry => entry.id),
  [numeric.id, enchantment.id],
);
assert.deepEqual(
  patching.inheritedCardPatches(afflicted, patching.PERSISTENT_COPY_PATCH_POLICY).map(entry => entry.id),
  [enchantment.id],
);
assert.deepEqual(
  patching.inheritedCardPatches(afflicted, patching.TRANSFORM_PATCH_POLICY),
  [],
);

const templatePatch = { ...numeric, id: 'status:forge:1:1', target: { match: 'template', templateId: 'strike', includeFutureCopies: true } };
assert.equal(patching.cardPatchApplies(baseCard, templatePatch), true);
assert.equal(patching.cardPatchApplies({ ...baseCard, templateId: 'guard' }, templatePatch), false);
assert.throws(() => patching.appendCardPatch(baseCard, { ...numeric, id: 'bad', operator: 'divide', value: 0 }), /divide by zero/);

const ledgerStart = patching.createCardPatchLedger();
const ledgerResult = patching.createCardPatch(ledgerStart, {
  source: { kind: 'system', id: 'test' },
  scope: 'combat',
  createdTurn: 2,
  kind: 'replay',
  extra: 1,
});
assert.equal(ledgerResult.patch.id, 'system:test:2:1');
assert.equal(ledgerResult.ledger.nextSequence, 2);

console.log('Card patches rebuild deterministically across scope cleanup, copying, targeting, and saves.');
