import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const entries = this.listeners.get(type) ?? [];
    entries.push(listener);
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(entry => entry !== listener),
    );
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type });
  }
}

class FakeObserver {
  static instances = [];
  observed = [];
  disconnected = false;

  constructor(callback) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }

  observe(target) {
    this.observed.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }

  fire() {
    this.callback([]);
  }
}

const parentDocument = new FakeEventTarget();
parentDocument.fullscreenElement = null;
const frame = new FakeEventTarget();
frame.style = { height: '' };
frame.ownerDocument = parentDocument;

const classNames = new Set();
const document = new FakeEventTarget();
document.fullscreenElement = null;
document.body = { scrollHeight: 964, offsetHeight: 964 };
document.documentElement = {
  scrollHeight: 964,
  offsetHeight: 964,
  classList: { contains: value => classNames.has(value) },
};

const animationFrames = [];
const timers = new Map();
let timerSequence = 0;
const window = new FakeEventTarget();
window.frameElement = frame;
window.requestAnimationFrame = callback => {
  animationFrames.push(callback);
  return animationFrames.length;
};
window.cancelAnimationFrame = () => undefined;
window.setTimeout = callback => {
  const id = ++timerSequence;
  timers.set(id, callback);
  return id;
};
window.clearTimeout = id => timers.delete(id);

globalThis.window = window;
globalThis.document = document;
globalThis.ResizeObserver = FakeObserver;
globalThis.MutationObserver = FakeObserver;

const { ensureRuntimeFrameHeightSync } = require('../src/runtime/runtimeFrameHeight.ts');
const flushAnimationFrame = () => {
  const callback = animationFrames.shift();
  if (callback) callback();
};

const controller = ensureRuntimeFrameHeightSync();
assert.ok(controller);
flushAnimationFrame();
assert.equal(frame.style.height, '964px', 'restored views must outgrow Tavern Helper\'s 150px fallback');

document.body.scrollHeight = 1409;
document.body.offsetHeight = 1409;
FakeObserver.instances[0].fire();
flushAnimationFrame();
assert.equal(frame.style.height, '1409px', 'dynamic common/reward content must resize the message iframe');

frame.style.height = '';
FakeObserver.instances.at(-1).fire();
flushAnimationFrame();
assert.equal(frame.style.height, '1409px', 'a parent-side style reset must be repaired');

classNames.add('mwg-fullscreen-active');
document.body.scrollHeight = 640;
document.body.offsetHeight = 640;
document.documentElement.scrollHeight = 640;
document.documentElement.offsetHeight = 640;
controller.request();
flushAnimationFrame();
assert.equal(frame.style.height, '1409px', 'fullscreen owns the frame geometry until it exits');

classNames.delete('mwg-fullscreen-active');
document.dispatch('fullscreenchange');
flushAnimationFrame();
assert.equal(frame.style.height, '640px', 'exiting fullscreen must restore the current document height');

frame.style.height = '2934px';
document.body.scrollHeight = 760;
document.body.offsetHeight = 760;
document.documentElement.scrollHeight = 2934;
document.documentElement.offsetHeight = 760;
controller.request();
flushAnimationFrame();
assert.equal(
  frame.style.height,
  '760px',
  'switching from a tall common view to battle must not reuse the stale iframe viewport height',
);

controller.destroy();
assert.ok(FakeObserver.instances.every(observer => observer.disconnected));
delete globalThis.window;
delete globalThis.document;
delete globalThis.ResizeObserver;
delete globalThis.MutationObserver;

console.log('runtime iframe height synchronization passed');
