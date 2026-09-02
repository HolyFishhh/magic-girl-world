import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from 'parse5';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { createRunState } = require('../src/game-core/runState.ts');
const { mountTowerApp } = require('../src/tower/towerApp.ts');

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(entry => entry !== listener),
    );
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener.call(this, event);
  }
}

class FakeStyle {
  properties = new Map();

  setProperty(name, value) {
    this.properties.set(name, String(value));
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return this.element.className.split(/\s+/).filter(Boolean);
  }

  write(values) {
    this.element.className = [...new Set(values)].join(' ');
  }

  add(...tokens) {
    this.write([...this.values(), ...tokens]);
  }

  remove(...tokens) {
    this.write(this.values().filter(token => !tokens.includes(token)));
  }

  contains(token) {
    return this.values().includes(token);
  }

  toggle(token, force) {
    const active = force === undefined ? !this.contains(token) : Boolean(force);
    if (active) this.add(token);
    else this.remove(token);
    return active;
  }
}

class FakeElement extends FakeEventTarget {
  constructor(ownerDocument, tagName) {
    super();
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = new FakeStyle();
    this.attributes = new Map();
    this.disabled = false;
    this.type = '';
    this._scrollTop = 0;
    this._clientHeight = 680;
    this._textContent = '';
  }

  get scrollTop() {
    return this._scrollTop;
  }

  set scrollTop(value) {
    this._scrollTop = this.ownerDocument.layoutVisible === false ? 0 : Number(value);
  }

  get clientHeight() {
    return this.ownerDocument.layoutVisible === false ? 0 : this._clientHeight;
  }

  set clientHeight(value) {
    this._clientHeight = Number(value);
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  get scrollHeight() {
    if (this.ownerDocument.layoutVisible === false) return 0;
    return this.classList.contains('tower-map-canvas') ? 1600 : 680;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  async requestFullscreen() {
    this.ownerDocument.fullscreenElement = this;
    this.ownerDocument.dispatchEvent({ type: 'fullscreenchange' });
  }

  click() {
    if (!this.disabled) this.dispatchEvent({ type: 'click' });
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.layoutVisible = true;
    this.fullscreenElement = null;
    this.documentElement = new FakeElement(this, 'html');
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  createElementNS(_namespace, tagName) {
    return new FakeElement(this, tagName);
  }

  async exitFullscreen() {
    this.fullscreenElement = null;
    this.dispatchEvent({ type: 'fullscreenchange' });
  }
}

function descendants(root) {
  return root.children.flatMap(child => [child, ...descendants(child)]);
}

function withClass(root, className) {
  return descendants(root).filter(element => element.classList.contains(className));
}

function withDataset(root, key, value) {
  return descendants(root).filter(
    element => element.dataset[key] !== undefined && (value === undefined || element.dataset[key] === value),
  );
}

const document = new FakeDocument();
const root = document.createElement('main');
const cleanSnapshot = createRunState({ seed: 0x70de57, startingGold: 77 });
for (const choice of cleanSnapshot.choices) {
  cleanSnapshot.nodeContent[choice.id].phase = 'ready';
  cleanSnapshot.nodeContent[choice.id].content = { title: '测试地点' };
}
const snapshot = structuredClone(cleanSnapshot);
const failedId = snapshot.choices[0].id;
snapshot.nodeContent[failedId].phase = 'failed';
snapshot.nodeContent[failedId].error = '测试错误';

let selectedNode = '';
let retriedNode = '';
let selectedAct = 0;
const controller = mountTowerApp({
  root,
  snapshot,
  difficultyPercent: 80,
  callbacks: {
    onNodeSelect: node => {
      selectedNode = node.id;
    },
    onRetryNode: node => {
      retriedNode = node.id;
    },
    onActChange: act => {
      selectedAct = act;
    },
  },
});

assert.equal(root.children.length, 1);
assert.equal(root.children[0].dataset.selectedAct, '1');
assert.equal(withClass(root, 'tower-act-tab').length, 3);
assert.equal(withClass(root, 'tower-map-status').length, 1);
assert.ok(root.textContent.includes('浅蓝路线代表当前可达'));
assert.equal(withDataset(root, 'nodeId').length, snapshot.map.acts[0].nodes.length);
assert.equal(withClass(root, 'tower-route-line').length, snapshot.map.acts[0].edges.length);
assert.equal(withDataset(root, 'contentState', 'failed').length, 1);
assert.ok(root.textContent.includes('测试错误'), 'node generation errors should be rendered as text');

withDataset(root, 'nodeId', failedId)[0].click();
assert.equal(retriedNode, failedId);

const viewportBeforeContentUpdate = withClass(root, 'tower-map-viewport')[0];
viewportBeforeContentUpdate.scrollTop = 321;
controller.update(cleanSnapshot, { difficultyPercent: 80 });
assert.equal(
  withClass(root, 'tower-map-viewport')[0].scrollTop,
  321,
  'content-only rerenders must preserve the player map viewport instead of jumping away from reachable nodes',
);
const playable = cleanSnapshot.choices[0].id;
withDataset(root, 'nodeId', playable)[0].click();
assert.equal(selectedNode, playable);

withDataset(root, 'act', '2')[0].click();
assert.equal(selectedAct, 2);
assert.equal(root.children[0].dataset.selectedAct, '2');
assert.equal(withDataset(root, 'nodeId').length, cleanSnapshot.map.acts[1].nodes.length);

const fullscreen = withClass(root, 'tower-fullscreen-button')[0];
fullscreen.click();
await Promise.resolve();
assert.equal(document.fullscreenElement, root.children[0]);
assert.equal(fullscreen.textContent, '退出全屏');

controller.destroy();
assert.equal(root.children.length, 0);

const initiallyHiddenDocument = new FakeDocument();
initiallyHiddenDocument.layoutVisible = false;
const initiallyHiddenRoot = initiallyHiddenDocument.createElement('main');
const initiallyHiddenController = mountTowerApp({
  root: initiallyHiddenRoot,
  snapshot: cleanSnapshot,
  difficultyPercent: 80,
});
assert.equal(
  withClass(initiallyHiddenRoot, 'tower-map-viewport')[0].scrollTop,
  0,
  'a reward-hidden map has no scrollable layout and must remain at the browser default position',
);
initiallyHiddenDocument.layoutVisible = true;
initiallyHiddenController.update(cleanSnapshot, { difficultyPercent: 80 });
assert.ok(
  withClass(initiallyHiddenRoot, 'tower-map-viewport')[0].scrollTop > 0,
  'showing the map after reward settlement must retry focus instead of preserving the hidden zero position',
);
initiallyHiddenController.destroy();

const sourceFiles = ['src/tower/towerApp.ts', 'src/tower/towerMapPresenter.ts'];
for (const sourceFile of sourceFiles) {
  const source = readFileSync(sourceFile, 'utf8');
  assert.doesNotMatch(source, /\.innerHTML\s*=/, `${sourceFile} must not inject dynamic markup`);
  assert.doesNotMatch(source, /insertAdjacentHTML\s*\(/, `${sourceFile} must not inject adjacent markup`);
}

const styleSource = readFileSync('src/tower/index.scss', 'utf8');
assert.match(styleSource, /\.mwg-tower-host[\s\S]*overflow-x:\s*clip/);
assert.match(styleSource, /\.tower-map-viewport[\s\S]*touch-action:\s*pan-y/);
assert.match(styleSource, /@media \(max-width:\s*430px\)/);
assert.match(styleSource, /\.mwg-tower-app:fullscreen[\s\S]*flex-direction:\s*column/);

const html = readFileSync('src/tower/index.html', 'utf8');
const documentTree = parse(html);
const flattened = [];
const visit = node => {
  flattened.push(node);
  for (const child of node.childNodes ?? []) visit(child);
};
visit(documentTree);
assert.ok(flattened.some(node => node.tagName === 'main' && node.attrs?.some(attr => attr.name === 'data-tower-root')));
assert.ok(
  flattened.some(
    node => node.tagName === 'script' && node.attrs?.some(attr => attr.name === 'src' && attr.value === './index.ts'),
  ),
);

console.log('tower map DOM and source safety tests passed');
