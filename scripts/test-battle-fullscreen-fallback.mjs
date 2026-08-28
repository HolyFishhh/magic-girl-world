import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  enterBattleFullscreenFallback,
  exitBattleFullscreenFallback,
} = require(resolve('src/fish/ui/battleFullscreenFallback.ts'));

const properties = new Map();
const attributes = new Map([['style', 'height: 640px; border-radius: 10px']]);
const frame = {
  style: {
    setProperty(name, value, priority) {
      properties.set(name, { value, priority });
    },
  },
  getAttribute(name) {
    return attributes.has(name) ? attributes.get(name) : null;
  },
  setAttribute(name, value) {
    attributes.set(name, value);
  },
  removeAttribute(name) {
    attributes.delete(name);
  },
};
const parentDocument = {
  body: { style: { overflow: 'auto' } },
  documentElement: { style: { overflow: 'clip' } },
};

const snapshot = enterBattleFullscreenFallback(frame, parentDocument);
assert.deepEqual(snapshot, {
  frameStyle: 'height: 640px; border-radius: 10px',
  bodyOverflow: 'auto',
  htmlOverflow: 'clip',
});
for (const property of ['position', 'inset', 'width', 'height', 'max-width', 'max-height', 'z-index']) {
  assert.equal(properties.get(property)?.priority, 'important', `${property} must override Tavern floor styles`);
}
assert.equal(properties.get('position').value, 'fixed');
assert.equal(properties.get('width').value, '100vw');
assert.equal(properties.get('height').value, '100vh');
assert.equal(parentDocument.body.style.overflow, 'hidden');
assert.equal(parentDocument.documentElement.style.overflow, 'hidden');

exitBattleFullscreenFallback(frame, parentDocument, snapshot);
assert.equal(attributes.get('style'), 'height: 640px; border-radius: 10px');
assert.equal(parentDocument.body.style.overflow, 'auto');
assert.equal(parentDocument.documentElement.style.overflow, 'clip');

attributes.delete('style');
const noStyleSnapshot = enterBattleFullscreenFallback(frame, parentDocument);
exitBattleFullscreenFallback(frame, parentDocument, noStyleSnapshot);
assert.equal(attributes.has('style'), false, 'an iframe without inline style must remain without one after exit');

console.log('Battle fullscreen fallback occupies the viewport and restores the exact Tavern floor styles.');
