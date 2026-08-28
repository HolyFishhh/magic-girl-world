import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const tx = require(resolve('src/game-core/advancedCardZoneTransaction.ts'));

const program = { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 5 }] };
const card = (id, templateId = id) => ({
  id,
  combatInstanceId: id,
  runInstanceId: `${id}:run`,
  originalId: templateId,
  templateId,
  origin: 'deck',
  name: id,
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  effectProgram: program,
});
const zones = {
  hand: [card('h1'), card('h2')],
  drawPile: [card('bottom'), card('middle'), card('top')],
  discardPile: [card('d1')],
  exhaustPile: [card('x1')],
};

const topMovePlan = tx.planAdvancedCardZoneTransaction(zones, {
  type: 'move',
  selector: { zone: 'hand', pick: 'all' },
  amount: 2,
  destination: 'drawPile',
  position: 'top',
});
assert.equal(topMovePlan.ok, true);
const topMove = tx.commitAdvancedCardZoneTransaction(zones, topMovePlan);
assert.equal(topMove.ok, true);
assert.deepEqual(topMove.zones.drawPile.map(entry => entry.id), ['bottom', 'middle', 'top', 'h2', 'h1']);
assert.equal(topMove.zones.drawPile.pop().id, 'h1', 'first selected card must be drawn first');

const bottomMovePlan = tx.planAdvancedCardZoneTransaction(zones, {
  type: 'move',
  selector: { zone: 'hand', pick: 'all' },
  amount: 2,
  destination: 'drawPile',
  position: 'bottom',
});
const bottomMove = tx.commitAdvancedCardZoneTransaction(zones, bottomMovePlan);
assert.deepEqual(bottomMove.zones.drawPile.map(entry => entry.id).slice(0, 2), ['h1', 'h2']);

const removePlan = tx.planAdvancedCardZoneTransaction(zones, {
  type: 'remove',
  selector: { zone: 'exhaust', pick: 'top', count: 1 },
  amount: 1,
});
const removed = tx.commitAdvancedCardZoneTransaction(zones, removePlan);
assert.equal(removed.ok, true);
assert.deepEqual(removed.removed.map(entry => entry.id), ['x1']);
assert.deepEqual(removed.zones.exhaustPile, []);

const copyPlan = tx.planAdvancedCardZoneTransaction(zones, {
  type: 'copy',
  selector: { zone: 'hand', pick: 'left', count: 1 },
  amount: 1,
  destination: 'drawPile',
  position: 'top',
  persistent: false,
});
const copied = tx.commitAdvancedCardZoneTransaction(zones, copyPlan);
assert.equal(copied.ok, true);
assert.equal(copied.created.length, 1);
assert.notEqual(copied.created[0].id, 'h1');
assert.equal(copied.created[0].runInstanceId, zones.hand[0].runInstanceId);
assert.deepEqual(copied.zones.hand.map(entry => entry.id), ['h1', 'h2'], 'copy must not remove originals');

const stale = tx.commitAdvancedCardZoneTransaction({ ...zones, hand: [...zones.hand, card('late')] }, copyPlan);
assert.deepEqual(stale, { ok: false, code: 'STALE_PLAN' });

const transformed = tx.transformCardInstance(zones.hand[0], {
  ...zones.hand[0],
  originalId: 'new_template',
  templateId: 'new_template',
  name: '变形牌',
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 8 }] },
});
assert.equal(transformed.id, zones.hand[0].id);
assert.equal(transformed.runInstanceId, zones.hand[0].runInstanceId);
assert.equal(transformed.templateId, 'new_template');
assert.equal(transformed.origin, 'transformed');

const generated = tx.placeGeneratedCards(zones, [card('generated')], 'drawPile', 'top');
assert.equal(generated.ok, true);
assert.equal(generated.zones.drawPile.at(-1).id, 'generated');
assert.deepEqual(tx.placeGeneratedCards(zones, [card('h1')], 'drawPile', 'top'), { ok: false, code: 'DUPLICATE_GENERATED_ID' });

console.log('Advanced card-zone transactions preserve order, identity, atomicity, transforms, and stale-plan rollback.');
