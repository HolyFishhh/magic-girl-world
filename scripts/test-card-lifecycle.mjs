import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

const lifecyclePath = resolve('src/game-core/cardRules.ts');
const resourcePath = resolve('src/game-core/combatResource.ts');
const resourceOutput = ts.transpileModule(await readFile(resourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const resourceUrl = `data:text/javascript;base64,${Buffer.from(resourceOutput).toString('base64')}`;
const source = (await readFile(lifecyclePath, 'utf8')).replace(
  "from './combatResource';",
  `from '${resourceUrl}';`,
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const lifecycle = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

assert.equal(lifecycle.resolvePlayedCardDestination({ type: 'Attack', exhaust: false }), 'discard');
assert.equal(lifecycle.resolvePlayedCardDestination({ type: 'Skill', exhaust: true }), 'exhaust');
assert.equal(
  lifecycle.resolvePlayedCardDestination({ type: 'Power', exhaust: false }),
  'exhaust',
  'Power cards must leave the draw cycle even when generated content omits exhaust',
);

const effectProgram = { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] };
const ordinary = { id: 'ordinary', type: 'Attack', effectProgram };
const retained = { id: 'retained', type: 'Skill', effectProgram, retain: true };
const ethereal = { id: 'ethereal', type: 'Skill', effectProgram, ethereal: true };
const conflicting = {
  id: 'conflicting',
  type: 'Skill',
  effectProgram,
  retain: true,
  ethereal: true,
};
const curse = { id: 'curse', type: 'Curse', effectProgram };
const etherealCurse = { id: 'ethereal_curse', type: 'Curse', effectProgram, ethereal: true };
const emptyCurse = { id: 'empty_curse', type: 'Curse' };

assert.deepEqual(
  lifecycle.selectTurnEndCurseTriggers([ordinary, curse, etherealCurse, emptyCurse]).map(card => card.id),
  ['curse', 'ethereal_curse'],
  'ethereal curses must still trigger once when turn-end processing begins',
);

const disposition = lifecycle.resolveTurnEndHandDisposition([
  ordinary,
  retained,
  ethereal,
  conflicting,
  curse,
  etherealCurse,
]);
assert.deepEqual(disposition.discard.map(card => card.id), ['ordinary']);
assert.deepEqual(disposition.keep.map(card => card.id), ['retained', 'curse']);
assert.deepEqual(
  disposition.exhaust.map(card => card.id),
  ['ethereal', 'conflicting', 'ethereal_curse'],
  'ethereal must win over retain and Curse retention',
);

const openingDeck = [
  { id: 'normal_a', type: 'Attack' },
  { id: 'innate_a', type: 'Skill', innate: true },
  { id: 'normal_b', type: 'Skill' },
  { id: 'innate_b', type: 'Power', innate: true },
  { id: 'normal_c', type: 'Attack' },
  { id: 'normal_d', type: 'Skill' },
];
const reverse = cards => [...cards].reverse();
const opening = lifecycle.resolveStartingHand(openingDeck, 5, reverse);
assert.deepEqual(opening.hand.map(card => card.id), [
  'innate_b',
  'innate_a',
  'normal_a',
  'normal_b',
  'normal_c',
]);
assert.deepEqual(opening.drawPile.map(card => card.id), ['normal_d']);
assert.deepEqual(openingDeck.map(card => card.id), [
  'normal_a',
  'innate_a',
  'normal_b',
  'innate_b',
  'normal_c',
  'normal_d',
]);

const manyInnates = lifecycle.resolveStartingHand(
  Array.from({ length: 12 }, (_, index) => ({ id: `innate_${index}`, type: 'Skill', innate: true })),
  5,
  cards => [...cards],
  10,
);
assert.equal(manyInnates.hand.length, 10, 'innate cards may exceed the normal draw count but not the hand limit');
assert.deepEqual(manyInnates.drawPile.map(card => card.id), ['innate_10', 'innate_11']);

const noInnates = lifecycle.resolveStartingHand(openingDeck.filter(card => !card.innate), 2, reverse);
assert.deepEqual(noInnates.hand.map(card => card.id), ['normal_a', 'normal_b']);
assert.deepEqual(noInnates.drawPile.map(card => card.id), ['normal_d', 'normal_c']);

console.log('Card turn-end lifecycle and deterministic innate opening hand passed.');
