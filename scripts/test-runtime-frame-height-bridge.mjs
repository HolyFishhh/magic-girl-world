import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

class FakeWindow {
  listeners = new Map();

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== listener));
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeEventSource extends FakeWindow {
  on(type, listener) {
    this.addEventListener(type, listener);
  }

  removeListener(type, listener) {
    this.removeEventListener(type, listener);
  }
}

class FakeIframe {
  constructor(id, source, srcdoc) {
    this.id = id;
    this.contentWindow = source;
    this.srcdoc = srcdoc;
    this.style = { height: '' };
  }

  getAttribute(name) {
    return name === 'srcdoc' ? this.srcdoc : null;
  }

  hasAttribute(name) {
    return name === 'data-mwg-runtime-fullscreen' && this.fullscreen === true;
  }
}

globalThis.HTMLIFrameElement = FakeIframe;
const { activateRuntimeFrameHeightBridge } = require('../src/sillytavern-extension/runtimeFrameHeightBridge.ts');

const hostWindow = new FakeWindow();
const sourceWindow = {};
const foreignWindow = {};
const frame = new FakeIframe(
  'TH-message--2--0',
  sourceWindow,
  '<script>__MWG_RUNTIME_FRAME_HEIGHT_CONTROLLER__</script>',
);
const foreignFrame = new FakeIframe('TH-message--9--0', foreignWindow, '<div>another card</div>');
const elements = new Map([[frame.id, frame], [foreignFrame.id, foreignFrame]]);
const eventSource = new FakeEventSource();
const helperEventSource = new FakeEventSource();
const tavernHelper = {
  _bind: {
    _eventOn: (eventName, listener) => helperEventSource.on(eventName, listener),
    _eventRemoveListener: (eventName, listener) => helperEventSource.removeListener(eventName, listener),
  },
};
const stop = activateRuntimeFrameHeightBridge(hostWindow, {
  getElementById: id => elements.get(id) ?? null,
  querySelectorAll: () => [frame, foreignFrame],
}, eventSource, () => tavernHelper);

const payload = {
  spec: 'mwg.runtime-frame-height/v1',
  runtime: 'magic-girl-world',
  frameId: frame.id,
  view: 'common',
  height: 964,
};
hostWindow.emit('message', { source: foreignWindow, data: payload });
assert.equal(frame.style.height, '', 'another iframe cannot resize the Magic Girl World frame');

hostWindow.emit('message', { source: sourceWindow, data: { ...payload, spec: 'other-card' } });
assert.equal(frame.style.height, '', 'unrelated messages must be ignored');

hostWindow.emit('message', { source: sourceWindow, data: payload });
assert.equal(frame.style.height, '964px');

frame.fullscreen = true;
hostWindow.emit('message', { source: sourceWindow, data: { ...payload, height: 1040 } });
assert.equal(frame.style.height, '964px', 'fullscreen frames must retain their viewport height');
frame.fullscreen = false;

frame.style.height = '';
hostWindow.emit('message', { source: sourceWindow, data: { ...payload, frameId: '', height: 1080 } });
assert.equal(frame.style.height, '1080px', 'source-window fallback must resize restored frames without ids');

frame.style.height = '';
eventSource.emit('mwg_runtime_frame_height', { ...payload, frameId: '', height: 1120 });
assert.equal(frame.style.height, '1120px', 'Tavern Helper events must resize restored frames without window access');

frame.style.height = '';
helperEventSource.emit('mwg_runtime_frame_height', { ...payload, frameId: '', height: 1180 });
assert.equal(frame.style.height, '1180px', 'Tavern Helper private bindings must reach the persistent extension');

hostWindow.emit('message', {
  source: foreignWindow,
  data: { ...payload, frameId: foreignFrame.id, height: 1200 },
});
assert.equal(foreignFrame.style.height, '', 'a non-Magic-Girl srcdoc must remain untouched');

hostWindow.emit('message', { source: sourceWindow, data: { ...payload, height: 99_999 } });
assert.equal(frame.style.height, '6000px', 'reported heights must be safely bounded');

stop();
hostWindow.emit('message', { source: sourceWindow, data: { ...payload, height: 800 } });
eventSource.emit('mwg_runtime_frame_height', { ...payload, height: 800 });
helperEventSource.emit('mwg_runtime_frame_height', { ...payload, height: 800 });
assert.equal(frame.style.height, '6000px', 'deactivation must remove both parent listeners');
delete globalThis.HTMLIFrameElement;

console.log('runtime iframe parent height bridge passed');
