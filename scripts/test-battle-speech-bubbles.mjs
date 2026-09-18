import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = '';
    this.textContent = '';
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
  remove() { if (!this.parentElement) return; const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get('click')?.({ preventDefault() {}, stopPropagation() {} }); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) || null; }
}

const player = new FakeElement();
const playerMain = new FakeElement();
playerMain.className = 'stage-main-unit';
player.append(playerMain);
let enemies = [];
const stage = new FakeElement();
const timers = [];
let stageObserver;
class FakeMutationObserver {
  constructor(callback) { this.callback = callback; }
  observe() { stageObserver = this; }
  disconnect() {}
  fire() { this.callback(); }
}
const bubbles = () => [playerMain, ...enemies].flatMap(host => host.children.filter(child => child.className === 'battle-speech-bubble'));
globalThis.window = {
  setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
  clearTimeout(timer) { timer.cleared = true; },
};
globalThis.MutationObserver = FakeMutationObserver;
globalThis.document = {
  getElementById(id) { return id === 'battle-stage' ? stage : null; },
  createElement(tagName) { return new FakeElement(tagName); },
  querySelector(selector) { return selector === '#stage-player .stage-main-unit' ? playerMain : null; },
  querySelectorAll(selector) {
    if (selector === '#stage-enemy-party [data-enemy-id]') return enemies;
    if (selector === '.battle-speech-bubble') return bubbles();
    return [];
  },
};

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { showBattleDialogue } = require(resolve('src/fish/ui/battleDialogue.ts'));

const firstEnemy = new FakeElement('button');
firstEnemy.dataset.enemyId = 'first';
const secondEnemy = new FakeElement('button');
secondEnemy.dataset.enemyId = 'second';
enemies = [firstEnemy, secondEnemy];
showBattleDialogue('第一名敌人的行动台词', { actor: 'enemy', id: 'first', name: '火焰' });
showBattleDialogue('第二名敌人的行动台词', { actor: 'enemy', id: 'second', name: '冰霜' });
assert.equal(firstEnemy.children.length, 1, 'each enemy owns its own bubble rather than using the selected target');
assert.equal(secondEnemy.children.length, 1);
assert.equal(timers.at(-1).delay, 5_000, 'bubbles use the five-second lifetime');

showBattleDialogue('火焰更新后的台词', { actor: 'enemy', id: 'first', name: '火焰' });
assert.equal(firstEnemy.children.length, 1, 'an updated line replaces the same actor bubble');
assert.equal(timers[0].cleared, true, 'an update resets the previous actor timer');
const refreshedTimer = timers.at(-1);
const replacement = new FakeElement('button');
replacement.dataset.enemyId = 'first';
enemies = [replacement, secondEnemy];
stageObserver.fire();
await Promise.resolve();
assert.equal(replacement.children.length, 1, 'stage redraw reattaches a bubble by stable enemy id');

enemies = [secondEnemy];
replacement.remove(); // Mirrors the DOM removal performed by the stage redraw.
stageObserver.fire();
await Promise.resolve();
assert.equal(bubbles().includes(replacement.children[0]), false, 'a removed/dead enemy bubble is no longer attached to the live stage');
assert.equal(refreshedTimer.cleared, true, 'death cleanup cancels the pending timer');

showBattleDialogue('我方自动消失台词', '技能卡');
const expiringPlayerBubble = playerMain.children.find(child => child.className === 'battle-speech-bubble');
assert.equal(expiringPlayerBubble.parentElement, playerMain, 'legacy/card speech resolves to the player actor');
timers.at(-1).callback();
assert.equal(expiringPlayerBubble.parentElement, null, 'the five-second timer removes a player bubble');

showBattleDialogue('我方点击消失台词', '技能卡');
const playerBubble = playerMain.children.find(child => child.className === 'battle-speech-bubble');
playerBubble.click();
assert.equal(playerBubble.parentElement, null, 'clicking a bubble dismisses it without waiting for combat');

const styles = readFileSync(resolve('src/fish/index.scss'), 'utf8');
const html = readFileSync(resolve('src/fish/index.html'), 'utf8');
assert.match(styles, /battle-speech-bubble[\s\S]*max-width:[\s\S]*@media \(max-width: 540px\)/, 'speech bubbles have wrapped narrow-screen styling');
assert.doesNotMatch(html, /id="battle-dialogue"/, 'the standalone dialogue panel is removed');
console.log('PASS actor speech bubbles preserve stable enemy identity, refresh safely, expire/click-dismiss, and fit narrow screens.');
