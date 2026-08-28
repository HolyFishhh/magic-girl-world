import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  resolveCardClickAction,
  resolveCardDropAction,
  restoreDraggedElementToSlot,
} = require(resolve('src/fish/ui/cardPlayInteraction.ts'));

const firstCard = {};
const secondCard = {};
assert.equal(resolveCardClickAction(null, firstCard), 'select');
assert.equal(resolveCardClickAction(firstCard, secondCard), 'select');
assert.equal(resolveCardClickAction(firstCard, firstCard), 'play');

assert.equal(
  resolveCardDropAction({ dragActive: false, pointerCancelled: false, insidePlayArea: true }),
  'none',
  'a click-sized pointer gesture must remain available to the click path',
);
assert.equal(
  resolveCardDropAction({ dragActive: true, pointerCancelled: false, insidePlayArea: true }),
  'play',
);
assert.equal(
  resolveCardDropAction({ dragActive: true, pointerCancelled: false, insidePlayArea: false }),
  'restore',
);
assert.equal(
  resolveCardDropAction({ dragActive: true, pointerCancelled: true, insidePlayArea: true }),
  'restore',
  'pointercancel must never play a card even when its last coordinates overlap the cast zone',
);

const calls = [];
const originalParent = {
  insertBefore(element, placeholder) {
    calls.push(['insertBefore', element, placeholder]);
  },
  appendChild(element) {
    calls.push(['appendChild', element]);
  },
};
const placeholder = {
  parentNode: originalParent,
  remove() {
    calls.push(['removePlaceholder']);
    this.parentNode = null;
  },
};
const restoredAttributes = new Map([['style', 'temporary-fixed-position']]);
const realCard = {
  removeAttribute(name) {
    restoredAttributes.delete(name);
  },
  setAttribute(name, value) {
    restoredAttributes.set(name, value);
  },
};

restoreDraggedElementToSlot(realCard, {
  parent: originalParent,
  placeholder,
  originalStyle: 'left: 12px; transform: rotate(-2deg)',
});
assert.equal(restoredAttributes.get('style'), 'left: 12px; transform: rotate(-2deg)');
assert.deepEqual(calls, [
  ['insertBefore', realCard, placeholder],
  ['removePlaceholder'],
]);

calls.length = 0;
placeholder.parentNode = null;
restoredAttributes.set('style', 'temporary-fixed-position');
restoreDraggedElementToSlot(realCard, {
  parent: originalParent,
  placeholder,
  originalStyle: null,
});
assert.equal(restoredAttributes.has('style'), false);
assert.deepEqual(calls, [['appendChild', realCard]], 'a missing marker falls back to the original hand parent');

console.log('Two-click play, drag play, pointer cancellation, and exact-slot restoration share one tested interaction policy.');
