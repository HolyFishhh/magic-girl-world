import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = await readFile(resolve('src/game-core/cardZoneOperation.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const reducerSource = await readFile(resolve('src/game-core/cardZoneReducer.ts'), 'utf8');
const reducerOutput = ts.transpileModule(reducerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const reducerUrl = `data:text/javascript;base64,${Buffer.from(reducerOutput).toString('base64')}`;
const operation = await import(
  `data:text/javascript;base64,${Buffer.from(output.replace("from './cardZoneReducer'", `from '${reducerUrl}'`)).toString('base64')}`,
);

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

console.log('Portable card-zone plans validate candidates, hand limits, ordering, stale hosts, and atomic commits.');
