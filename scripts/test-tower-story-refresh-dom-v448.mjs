import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the two production renderers together. This catches ownership bugs
// that source checks miss: story polling must not take room controls back from
// the tower screen after it has made the screen owner authoritative.
class Element {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase(); this.children = []; this.dataset = {}; this.style = {};
    this.className = ''; this.hidden = false; this.id = ''; this.parentElement = null;
    this.attributes = new Map(); this.listeners = new Map(); this.open = false; this._text = '';
    this.classList = { toggle: (name, force) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      if (force === false) names.delete(name); else if (force === true) names.add(name); else names.has(name) ? names.delete(name) : names.add(name);
      this.className = [...names].join(' ');
    } };
  }
  get childElementCount() { return this.children.length; }
  get nextElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  prepend(...nodes) { for (const node of nodes.reverse()) { node.remove(); node.parentElement = this; this.children.unshift(node); } }
  after(node) { const parent = this.parentElement; node.remove(); node.parentElement = parent; parent.children.splice(parent.children.indexOf(this) + 1, 0, node); }
  before(node) { const parent = this.parentElement; node.remove(); node.parentElement = parent; parent.children.splice(parent.children.indexOf(this), 0, node); }
  remove() { if (!this.parentElement) return; this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; this.append(...nodes); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    return this.tagName === selector.toLowerCase();
  }
  querySelector(selector) { return this.descendants().find(node => node.matches(selector)) || null; }
  querySelectorAll(selector) { return this.descendants().filter(node => node.matches(selector)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get('click')?.({ currentTarget: this }); }
}

const document = { body: new Element('body'), documentElement: new Element('html'), createElement: tag => new Element(tag) };
document.getElementById = id => document.body.descendants().find(node => node.id === id) || null;
document.querySelector = selector => document.body.querySelector(selector);
const mount = (tag, id) => { const node = document.createElement(tag); node.id = id; document.body.append(node); return node; };

let variables = { stat_data: { game_mode: 'tower', run: {
  seed: 448, act: 1, floor: 0, phase: 'awaiting_choice', currentNode: { id: 'opening', kind: 'event', floor: 0 },
  opening: { phase: 'pending' }, visitedNodeIds: [], nodeContent: {},
} } };
const moduleFor = (file, require) => {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require, document, window: {}, globalThis: {}, console });
  return module.exports;
};
const story = moduleFor('src/runtime/storyPanel.ts', name => {
  if (name.includes('messageVariables')) return { getCurrentMessageVariables: () => variables, getCurrentChatMessageText: () => '' };
  if (name.includes('towerMode')) return { readGameMode: () => 'tower' };
  throw new Error(`Unexpected story dependency: ${name}`);
});
const tower = moduleFor('src/common/towerScreenPresentation.ts', name => {
  if (name.includes('/html')) return { escapeHtml: value => String(value) };
  throw new Error(`Unexpected screen dependency: ${name}`);
});

const map = mount('div', 'tower-map-root');
const node = mount('div', 'tower-node-panel-root');
const rewards = mount('div', 'choice-container');
const choose = document.createElement('button'); choose.id = 'opening-choice'; choose.textContent = '接受启程礼物';
let clicks = 0; const clickHandler = () => { clicks += 1; };
choose.addEventListener('click', clickHandler); rewards.append(choose);
mount('div', 'tower-player-panel');

// Before prose or room controls arrive, the production screen shows a real
// pending state instead of exposing the hidden legacy folds as a blank page.
tower.renderTowerScreen(variables.stat_data, false, () => {});
const host = document.getElementById('tower-screen-host');
const room = document.getElementById('tower-room-page');
assert.equal(document.getElementById('tower-room-loading')?.textContent, '正在加载当前地点…生成完成后会自动显示剧情与可选内容。');
assert.equal(room.parentElement, host);

// The opening becomes ready, then the normal common view order renders prose
// and lets the tower screen place every live panel in its visible owner.
variables.stat_data.run.opening = { phase: 'offered', content: { title: '启程', narrative: '第一幕已经就绪。' } };
story.renderStoryPanel('common');
tower.renderTowerScreen(variables.stat_data, false, () => {});
const prose = document.getElementById('mwg-story-panel');
assert.equal(document.getElementById('tower-room-loading'), null, 'ready opening removes the pending placeholder');
assert.equal(prose.parentElement, room);
assert.equal(node.parentElement, room);
assert.equal(rewards.parentElement, room);
assert.equal(map.parentElement, host);
assert.equal(map.style.display, 'none', 'the route stays owned by the screen while the opening room is active');
assert.equal(choose.listeners.get('click'), clickHandler, 'screen move preserves the original choice callback');

// This is the 750 ms common story refresh: it may redraw prose, but must not
// reparent the room/reward/map controls into legacy folds or replace callbacks.
for (let refresh = 0; refresh < 3; refresh += 1) story.renderStoryPanel('common');
assert.equal(document.body.dataset.towerScreen, 'room');
assert.equal(document.getElementById('mwg-story-panel').parentElement, room);
assert.equal(node.parentElement, room);
assert.equal(rewards.parentElement, room);
assert.equal(map.parentElement, host);
assert.equal(choose.listeners.get('click'), clickHandler);
choose.click();
assert.equal(clicks, 1, 'the original opening choice remains actionable after story-only refreshes');

// Once the opening is settled, map routing remains in the screen host and is
// visible; a subsequent story-only refresh must leave that ownership intact.
variables.stat_data.run.opening.phase = 'consumed';
tower.renderTowerScreen(variables.stat_data, false, () => {});
assert.equal(document.body.dataset.towerScreen, 'map');
assert.equal(map.parentElement, host);
assert.equal(map.style.display, '');
story.renderStoryPanel('common');
assert.equal(map.parentElement, host);
assert.equal(map.style.display, '');
assert.equal(node.parentElement, room, 'the hidden room keeps its live node panel for the next room transition');
assert.equal(rewards.parentElement, room);

console.log('PASS v448 tower story refresh DOM: pending opening placeholder, ready room ownership, map ownership, and choice callback stability. Browser visual layout is not verified.');
