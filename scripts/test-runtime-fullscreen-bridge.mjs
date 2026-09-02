import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

class FakeClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeStyle {
  values = new Map();
  overflow = '';
  setProperty(name, value, priority = '') {
    this.values.set(name, { value, priority });
    if (name === 'overflow') this.overflow = value;
  }
  value(name) { return this.values.get(name)?.value || ''; }
  priority(name) { return this.values.get(name)?.priority || ''; }
  getPropertyValue(name) { return this.value(name); }
  getPropertyPriority(name) { return this.priority(name); }
}

class FakeElement {
  constructor() {
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.isConnected = true;
    this.children = [];
    this.parentNode = null;
  }
  get parentElement() { return this.parentNode; }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) {
    if (name === 'style') this.style = new FakeStyle();
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    if (name === 'style') this.style = new FakeStyle();
    this.attributes.delete(name);
  }
  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
  appendChild(node) {
    node.parentNode?.removeChild?.(node);
    this.children.push(node);
    node.parentNode = this;
    node.isConnected = this.isConnected;
    return node;
  }
  insertBefore(node, reference) {
    node.parentNode?.removeChild?.(node);
    const index = this.children.indexOf(reference);
    if (index < 0) return this.appendChild(node);
    this.children.splice(index, 0, node);
    node.parentNode = this;
    node.isConnected = this.isConnected;
    return node;
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    node.isConnected = false;
    return node;
  }
  remove() { this.parentNode?.removeChild?.(this); }
}

class FakeIframe extends FakeElement {
  constructor(id, source, srcdoc) {
    super();
    this.id = id;
    this.contentWindow = source;
    this.setAttribute('srcdoc', srcdoc);
  }
}

class FakeEventTarget {
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

class FakeEventSource extends FakeEventTarget {
  on(type, listener) { this.addEventListener(type, listener); }
  removeListener(type, listener) { this.removeEventListener(type, listener); }
}

let observerCallback = null;
class FakeMutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
  disconnect() {}
}

globalThis.HTMLElement = FakeElement;
globalThis.HTMLIFrameElement = FakeIframe;
const { activateRuntimeFullscreenBridge } = require('../src/sillytavern-extension/runtimeFullscreenBridge.ts');

const sourceWindow = { messages: [], postMessage(message) { this.messages.push(message); } };
const olderSource = { messages: [], postMessage(message) { this.messages.push(message); } };
const foreignSource = { messages: [], postMessage(message) { this.messages.push(message); } };
const runtimeSource = "<script>waitGlobalInitialized('MagicGirlWorld');/* mwg.tavern-runtime/v1 */</script>";
const latestFrame = new FakeIframe('TH-message--4--0', sourceWindow, runtimeSource);
latestFrame.setAttribute('style', 'height: 812px');
const olderFrame = new FakeIframe('TH-message--2--0', olderSource, runtimeSource);
const foreignFrame = new FakeIframe('TH-message--4--1', foreignSource, '<div>another card</div>');
const frames = [olderFrame, latestFrame, foreignFrame];

const hostWindow = new FakeEventTarget();
hostWindow.MutationObserver = FakeMutationObserver;
const hostDocument = new FakeEventTarget();
hostDocument.body = new FakeElement();
hostDocument.documentElement = new FakeElement();
hostDocument.createComment = () => new FakeElement();
const olderHost = new FakeElement();
const latestHost = new FakeElement();
const foreignHost = new FakeElement();
const hostChrome = new FakeElement();
hostDocument.body.appendChild(olderHost);
hostDocument.body.appendChild(latestHost);
hostDocument.body.appendChild(foreignHost);
hostDocument.body.appendChild(hostChrome);
olderHost.appendChild(olderFrame);
latestHost.appendChild(latestFrame);
foreignHost.appendChild(foreignFrame);
hostDocument.querySelectorAll = selector => selector.startsWith('iframe') ? frames : [hostChrome];
hostDocument.getElementById = id => frames.find(frame => frame.id === id) || null;
const eventSource = new FakeEventSource();
let scoped = true;
const context = () => ({
  characterId: 0,
  groupId: null,
  characters: [{ data: { extensions: { magic_girl_world: {
    design_assistant_scope: scoped ? 'mwg.design-assistant-card/v1' : 'another-card',
  } } } }],
  chat: Array.from({ length: 5 }, () => ({})),
  extensionSettings: {},
  saveSettingsDebounced() {},
  chatMetadata: {},
  saveMetadataDebounced() {},
  eventSource,
  eventTypes: {},
});
const stop = activateRuntimeFullscreenBridge(hostWindow, hostDocument, context, eventSource);

const request = {
  spec: 'mwg.runtime-fullscreen-request/v1',
  runtime: 'magic-girl-world',
  requestId: 'enter-1',
  frameId: latestFrame.id,
  view: 'tower',
  active: true,
};

hostWindow.emit('message', { source: foreignSource, data: request });
assert.equal(latestFrame.style.value('position'), '', 'another iframe cannot impersonate the latest frame');

hostWindow.emit('message', { source: olderSource, data: { ...request, frameId: olderFrame.id } });
assert.equal(olderFrame.style.value('position'), '', 'an older message iframe cannot enter fullscreen');

hostWindow.emit('message', { source: sourceWindow, data: request });
assert.equal(latestFrame.style.value('position'), 'fixed');
assert.equal(latestFrame.style.value('width'), '100vw');
assert.equal(latestFrame.style.value('height'), '100vh');
assert.equal(latestFrame.style.priority('width'), 'important');
assert.equal(latestFrame.style.value('z-index'), '2147483000');
assert.equal(hostDocument.body.style.overflow, 'hidden');
assert.equal(hostDocument.documentElement.style.overflow, 'hidden');
assert.equal(hostDocument.documentElement.classList.contains('mwg-runtime-fullscreen-host'), true);
assert.equal(latestFrame.parentNode, latestHost, 'fullscreen must not reload the iframe by reparenting it');
assert.equal(latestHost.style.value('overflow'), 'visible');
assert.equal(hostChrome.style.value('visibility'), 'hidden');
assert.deepEqual(sourceWindow.messages.at(-1), {
  spec: 'mwg.runtime-fullscreen-state/v1',
  runtime: 'magic-girl-world',
  requestId: 'enter-1',
  accepted: true,
  active: true,
});

latestFrame.style.setProperty('height', '1891px');
observerCallback?.([]);
assert.equal(latestFrame.style.value('height'), '100vh',
  'host iframe height observers cannot overwrite the fullscreen viewport');
assert.equal(latestFrame.style.priority('height'), 'important');

hostDocument.emit('keydown', { key: 'Escape' });
assert.equal(latestFrame.getAttribute('style'), 'height: 812px', 'Escape must restore the exact iframe style');
assert.equal(latestFrame.parentNode, latestHost, 'Escape must return the iframe to its original message');
assert.equal(latestHost.style.value('overflow'), '', 'message ancestor styles must be restored');
assert.equal(hostChrome.style.value('visibility'), '', 'host chrome must become visible after exit');
assert.equal(hostDocument.body.style.overflow, '');
assert.equal(sourceWindow.messages.at(-1).active, false, 'Escape must notify the iframe UI');

hostWindow.emit('message', { source: sourceWindow, data: { ...request, requestId: 'enter-2' } });
latestFrame.isConnected = false;
observerCallback?.([]);
assert.equal(hostDocument.documentElement.classList.contains('mwg-runtime-fullscreen-host'), false,
  'removing the iframe must restore the host page');
assert.equal(latestFrame.isConnected, false, 'a removed iframe must remain disconnected');
latestHost.appendChild(latestFrame);

scoped = false;
hostWindow.emit('message', { source: sourceWindow, data: { ...request, requestId: 'rejected-scope' } });
assert.equal(sourceWindow.messages.some(message => message.requestId === 'rejected-scope'), false);

scoped = true;
hostWindow.emit('message', { source: sourceWindow, data: { ...request, requestId: 'enter-3' } });
eventSource.emit('chat_id_changed');
assert.equal(latestFrame.getAttribute('style'), 'height: 812px', 'chat changes must exit fullscreen');

stop();
hostWindow.emit('message', { source: sourceWindow, data: { ...request, requestId: 'after-stop' } });
assert.equal(sourceWindow.messages.some(message => message.requestId === 'after-stop'), false);

delete globalThis.HTMLIFrameElement;
delete globalThis.HTMLElement;
console.log('runtime parent fullscreen bridge passed');
