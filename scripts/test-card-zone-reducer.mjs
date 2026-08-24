import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

const path = resolve('src/game-core/cardZoneReducer.ts');
const source = await readFile(path, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const zones = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const cards = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
const initial = {
  hand: [cards[0]],
  drawPile: [cards[1]],
  discardPile: [cards[2], cards[3], cards[4]],
  exhaustPile: [],
};

const removed = zones.removeCardFromZone(initial, 'hand', 'a');
assert.equal(removed.card.id, 'a');
assert.deepEqual(removed.zones.hand, []);
assert.deepEqual(initial.hand.map(card => card.id), ['a'], 'zone reducers must not mutate their input');
assert.equal(zones.removeCardFromZone(initial, 'hand', 'missing').card, null);

const appended = zones.appendCardToZone(removed.zones, 'discardPile', removed.card);
assert.deepEqual(appended.discardPile.map(card => card.id), ['c', 'd', 'e', 'a']);
assert.notEqual(appended.discardPile.at(-1), removed.card, 'cards entering a zone must be copied');

const randomSamples = [0, 0.75, 0.25];
const shuffled = zones.shuffleCards(cards, () => randomSamples.shift() ?? 0);
assert.deepEqual(shuffled.map(card => card.id), ['b', 'c', 'e', 'd', 'a']);
assert.deepEqual(cards.map(card => card.id), ['a', 'b', 'c', 'd', 'e']);

const drawn = zones.drawCardsFromZones(initial, 4, pile => [...pile].reverse(), 10);
assert.deepEqual(drawn.drawn.map(card => card.id), ['b', 'c', 'd', 'e']);
assert.deepEqual(drawn.zones.hand.map(card => card.id), ['a', 'b', 'c', 'd', 'e']);
assert.deepEqual(drawn.zones.drawPile, []);
assert.deepEqual(drawn.zones.discardPile, []);
assert.equal(drawn.recycledDiscard, true);

const capped = zones.drawCardsFromZones({ ...initial, hand: Array.from({ length: 10 }, (_, i) => ({ id: `h${i}` })) }, 2, pile => [...pile]);
assert.equal(capped.drawn.length, 0);
assert.deepEqual(capped.zones.drawPile.map(card => card.id), ['b'], 'a full hand must not consume draw cards');
assert.deepEqual(capped.zones.discardPile.map(card => card.id), ['c', 'd', 'e']);

const moved = zones.moveCardsBetweenZones(initial, ['d', 'a', 'missing'], ['hand', 'drawPile', 'discardPile'], 'exhaustPile');
assert.deepEqual(moved.moved.map(card => card.id), ['d', 'a']);
assert.deepEqual(moved.zones.hand, []);
assert.deepEqual(moved.zones.discardPile.map(card => card.id), ['c', 'e']);
assert.deepEqual(moved.zones.exhaustPile.map(card => card.id), ['d', 'a']);

const updated = zones.updateCardsInZones(initial, ['a', 'd'], ['hand', 'drawPile', 'discardPile'], card => ({ ...card, marked: true }));
assert.deepEqual(updated.updated.map(card => card.id), ['a', 'd']);
assert.equal(updated.zones.hand[0].marked, true);
assert.equal(updated.zones.discardPile[1].marked, true);
assert.equal(initial.hand[0].marked, undefined);

const recovered = zones.moveCardsBetweenZones(initial, ['c', 'd'], ['discardPile'], 'hand', 3);
assert.deepEqual(recovered.moved.map(card => card.id), ['c', 'd']);
assert.deepEqual(recovered.zones.hand.map(card => card.id), ['a', 'c', 'd']);

const sought = zones.moveCardsBetweenZones(
  { ...initial, hand: Array.from({ length: 9 }, (_, i) => ({ id: `h${i}` })) },
  ['b'],
  ['drawPile'],
  'hand',
  10,
);
assert.deepEqual(sought.moved.map(card => card.id), ['b']);
assert.equal(sought.zones.hand.length, 10);
assert.deepEqual(sought.zones.drawPile, []);

const scryInput = {
  hand: [],
  drawPile: [{ id: 'bottom' }, { id: 'third' }, { id: 'second' }, { id: 'top' }],
  discardPile: [{ id: 'old' }],
  exhaustPile: [],
};
const scried = zones.scryCardsFromDraw(scryInput, 3, ['second', 'bottom', 'top', 'missing']);
assert.deepEqual(scried.inspected.map(card => card.id), ['top', 'second', 'third']);
assert.deepEqual(scried.discarded.map(card => card.id), ['top', 'second']);
assert.deepEqual(scried.zones.drawPile.map(card => card.id), ['bottom', 'third']);
assert.deepEqual(scried.zones.discardPile.map(card => card.id), ['old', 'top', 'second']);
assert.deepEqual(scryInput.drawPile.map(card => card.id), ['bottom', 'third', 'second', 'top']);

console.log('Portable card-zone reducer preserves draw, recycle, scry, removal, and hand-limit semantics.');
