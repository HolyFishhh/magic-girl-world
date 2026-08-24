import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = await readFile(resolve('src/game-core/cardZoneReducer.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const core = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const cards = ['a', 'b', 'c'].map(id => ({ id }));
let zones = { hand: [], drawPile: [cards[0]], discardPile: [cards[1], cards[2]], exhaustPile: [] };
const events = [];

let step = core.advanceCardDrawLifecycle(zones, pile => [...pile].reverse(), 10);
events.push(step.event.type);
assert.equal(step.event.type, 'draw');
zones = step.zones;
assert.equal(step.event.card.id, 'a');

step = core.advanceCardDrawLifecycle(zones, pile => [...pile].reverse(), 10);
events.push(step.event.type);
assert.equal(step.event.type, 'shuffle', 'recycling is observable before the next card draw');
zones = step.zones;
assert.deepEqual(zones.drawPile.map(card => card.id), ['c', 'b']);

step = core.advanceCardDrawLifecycle(zones, pile => [...pile].reverse(), 10);
events.push(step.event.type);
assert.equal(step.event.type, 'draw');
assert.equal(step.event.card.id, 'b');

const fullHand = { ...zones, hand: Array.from({ length: 10 }, (_, index) => ({ id: `h${index}` })) };
assert.deepEqual(core.advanceCardDrawLifecycle(fullHand, pile => pile, 10).event, {
  type: 'stopped',
  reason: 'hand_limit',
});

console.log(`Card draw lifecycle preserves ordered events: ${events.join(' -> ')}`);
