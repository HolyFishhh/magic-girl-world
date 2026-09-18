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
  shouldRestoreInterruptedDrag,
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
  shouldRestoreInterruptedDrag(true, true),
  true,
  'a hidden or blurred window must restore a card that has already been moved out of its hand slot',
);
assert.equal(
  shouldRestoreInterruptedDrag(false, true),
  false,
  'a click-sized interrupted pointer must not mutate an otherwise intact card',
);
assert.equal(
  shouldRestoreInterruptedDrag(true, false),
  false,
  'a drag without a reserved hand slot must not be relocated speculatively',
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

// Exercise the actual CardPlayMode visibility/blur handlers with a deliberately
// small DOM/JQuery surface. A backgrounded browser can omit pointercancel.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function mockBattleUi(request, parent, isMain) {
  if (request === './battleUI' && parent?.filename.endsWith('cardPlayMode.ts')) {
    return { BattleUI: { dismissCardTooltip() {}, showCardTooltip() {} } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function eventTarget() {
  const handlers = new Map();
  return {
    handlers,
    off() { return this; },
    on(names, handler) {
      for (const name of names.split(/\s+/)) handlers.set(name.split('.')[0], handler);
      return this;
    },
  };
}

const documentTarget = eventTarget();
const windowTarget = eventTarget();
const playArea = { removed: [], removeClass(value) { this.removed.push(value); return this; } };
globalThis.document = {
  hidden: true,
  documentElement: { classList: { add() {} } },
};
globalThis.window = { setTimeout, clearTimeout };
globalThis.cancelAnimationFrame = () => {};
globalThis.$ = value => {
  if (value === globalThis.document) return documentTarget;
  if (value === globalThis.window) return windowTarget;
  if (value === '#playArea') return playArea;
  throw new Error(`Unexpected JQuery selector in interruption test: ${String(value)}`);
};

const { CardPlayMode } = require(resolve('src/fish/ui/cardPlayMode.ts'));
Module._load = originalLoad;

const interruptedCalls = [];
const interruptedParent = {
  insertBefore(element, marker) { interruptedCalls.push(['insertBefore', element, marker]); },
  appendChild(element) { interruptedCalls.push(['appendChild', element]); },
};
const interruptedSlot = {
  parentNode: interruptedParent,
  remove() { interruptedCalls.push(['removeSlot']); this.parentNode = null; },
};
const interruptedStyle = new Map([['style', 'position: fixed; pointer-events: none']]);
const interruptedElement = {
  getAttribute(name) { return interruptedStyle.get(name) ?? null; },
  removeAttribute(name) { interruptedStyle.delete(name); },
  setAttribute(name, value) { interruptedStyle.set(name, value); },
  hasPointerCapture() { return true; },
  releasePointerCapture() { throw new Error('NotFoundError: capture was already lost'); },
};
const interruptedData = new Map([['playPending', true], ['suppressPlayClick', true]]);
const interruptedCard = {
  get() { return interruptedElement; },
  data(name, value) {
    if (arguments.length === 1) return interruptedData.get(name);
    interruptedData.set(name, value);
    return this;
  },
  removeData(name) { interruptedData.delete(name); return this; },
  removeClass(value) { interruptedCalls.push(['removeClass', value]); return this; },
  addClass() { return this; },
  removeAttr() { return this; },
  trigger() { return this; },
};

const mode = CardPlayMode.getInstance();
mode.init();
mode.draggedCard = interruptedCard;
mode.pressPreviewCard = interruptedCard;
mode.dragSlot = { parent: interruptedParent, placeholder: interruptedSlot, originalStyle: 'transform: rotate(-2deg)' };
mode.dragPointerId = 7;
mode.pointerDragActive = true;
documentTarget.handlers.get('visibilitychange')();

assert.equal(interruptedStyle.get('style'), 'transform: rotate(-2deg)', 'visibility recovery restores the original style, including pointer-events');
assert.deepEqual(interruptedCalls.slice(0, 3), [
  ['removeClass', 'dragging is-cast-ready card-playing'],
  ['insertBefore', interruptedElement, interruptedSlot],
  ['removeSlot'],
]);
assert.equal(interruptedData.get('playPending'), true, 'visibility recovery must preserve an actual pending play mutation');
assert.equal(interruptedData.has('suppressPlayClick'), false, 'visibility recovery clears a stale long-press suppression');
assert.deepEqual(playArea.removed, ['show active']);

const previewData = new Map([['suppressPlayClick', true]]);
mode.pressPreviewCard = { removeData(name) { previewData.delete(name); return this; } };
windowTarget.handlers.get('blur')();
assert.equal(previewData.has('suppressPlayClick'), false, 'blur clears long-press suppression even without an active drag');

console.log('Two-click play, drag play, pointer cancellation, hidden-window interruption, and exact-slot restoration share one tested interaction policy.');
