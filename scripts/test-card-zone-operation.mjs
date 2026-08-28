import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const operation = require(resolve('src/game-core/cardZoneOperation.ts'));

const card = id => ({ id, name: id });
const zones = {
  hand: [card('h1'), card('h2')],
  drawPile: [card('d1'), card('d2'), card('d3'), card('d4')],
  discardPile: [card('c1')],
  exhaustPile: [card('x1')],
};

const seek = operation.planCardZoneOperation(zones, { type: 'recover_cards', source: 'draw', pick: 'choose', amount: 2 }, { handLimit: 4 });
assert.equal(seek.ok, true);
assert.deepEqual(seek.candidateCardIds, ['d1', 'd2', 'd3', 'd4']);
assert.deepEqual(seek.selection, { kind: 'interactive', minimum: 2, maximum: 2 });
const sought = operation.commitCardZoneOperation(zones, seek, ['d4', 'd2']);
assert.equal(sought.ok, true);
assert.deepEqual(sought.moved.map(entry => entry.id), ['d2', 'd4'], 'commit uses core candidate order');
assert.deepEqual(sought.zones.hand.map(entry => entry.id), ['h1', 'h2', 'd2', 'd4']);

const fullHand = { ...zones, hand: [card('h1'), card('h2'), card('h3')] };
const recoverAll = operation.planCardZoneOperation(
  fullHand,
  { type: 'recover_cards', source: 'discard', pick: 'all', amount: 1 },
  { handLimit: 4 },
);
assert.equal(recoverAll.ok, true);
assert.deepEqual(recoverAll.selection, { kind: 'automatic', cardIds: ['c1'] });
const recovered = operation.commitCardZoneOperation(fullHand, recoverAll);
assert.equal(recovered.ok, true);
assert.deepEqual(recovered.zones.hand.map(entry => entry.id), ['h1', 'h2', 'h3', 'c1']);

const scry = operation.planCardZoneOperation(zones, { type: 'scry_cards', amount: 3 });
assert.equal(scry.ok, true);
assert.deepEqual(scry.candidateCardIds, ['d4', 'd3', 'd2']);
const scried = operation.commitCardZoneOperation(zones, scry, ['d2', 'd4']);
assert.equal(scried.ok, true);
assert.deepEqual(scried.moved.map(entry => entry.id), ['d4', 'd2']);
assert.deepEqual(scried.zones.drawPile.map(entry => entry.id), ['d1', 'd3']);
assert.deepEqual(scried.zones.discardPile.map(entry => entry.id), ['c1', 'd4', 'd2']);

const stale = operation.commitCardZoneOperation({ ...zones, hand: [...zones.hand, card('new')] }, seek, ['d1', 'd2']);
assert.deepEqual(stale, { ok: false, code: 'STALE_PLAN' });
const invalid = operation.commitCardZoneOperation(zones, seek, ['x1']);
assert.deepEqual(invalid, { ok: false, code: 'INVALID_SELECTION' });
const duplicate = operation.planCardZoneOperation(
  { ...zones, hand: [card('h1'), card('d1')] },
  { type: 'scry_cards', amount: 1 },
);
assert.deepEqual(duplicate, { ok: false, code: 'DUPLICATE_CARD_ID' });

const richZones = {
  hand: [
    { id: 'attack-low', type: 'Attack', rarity: 'Common', cost: 0, tags: ['strike'], templateId: 'attack', origin: 'deck' },
    { id: 'skill', type: 'Skill', rarity: 'Rare', cost: 1, tags: ['guard'], templateId: 'guard', origin: 'deck', upgraded: true },
  ],
  drawPile: [
    { id: 'bottom', type: 'Attack', rarity: 'Common', cost: 1, templateId: 'attack', origin: 'deck' },
    { id: 'middle', type: 'Attack', rarity: 'Uncommon', cost: 2, templateId: 'attack', origin: 'generated' },
    { id: 'top', type: 'Power', rarity: 'Rare', cost: 3, templateId: 'power', origin: 'deck' },
  ],
  discardPile: [],
  exhaustPile: [{ id: 'exhausted', type: 'Curse', rarity: 'Corrupt', cost: 0, origin: 'generated' }],
};
const drawTop = operation.planCardZoneOperation(richZones, {
  type: 'exhaust_cards',
  amount: 2,
  selector: { zone: 'draw', pick: 'top', count: 2 },
});
assert.equal(drawTop.ok, true);
assert.deepEqual(drawTop.selection.cardIds, ['top', 'middle']);
const drawBottom = operation.planCardZoneOperation(richZones, {
  type: 'discard_cards',
  amount: 1,
  selector: { zone: 'draw', pick: 'bottom', count: 1 },
});
assert.deepEqual(drawBottom.selection.cardIds, ['bottom']);
const filtered = operation.planCardZoneOperation(richZones, {
  type: 'discard_cards',
  amount: 1,
  selector: { zone: 'hand', pick: 'choose', count: 1, filter: { types: ['Skill'], rarities: ['Rare'], upgraded: true } },
});
assert.deepEqual(filtered.candidateCardIds, ['skill']);
const explicitExhaust = operation.planCardZoneOperation(richZones, {
  type: 'discard_cards',
  amount: 1,
  selector: { zone: 'exhaust', pick: 'top', count: 1, filter: { origin: 'generated' } },
});
assert.deepEqual(explicitExhaust.candidateCardIds, ['exhausted']);
assert.deepEqual(explicitExhaust.selection.cardIds, ['exhausted']);

console.log('Portable card-zone plans validate candidates, hand limits, ordering, stale hosts, and atomic commits.');
