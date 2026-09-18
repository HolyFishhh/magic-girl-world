import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

class EventTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }
}
class Element extends EventTarget {
  constructor(document, tagName) {
    super();
    this.ownerDocument = document;
    this.tagName = tagName;
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.dataset = {};
    this.attributes = new Map();
    this.disabled = false;
    this.type = '';
    this._html = '';
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) || null;
  }
  get classList() {
    return {
      toggle: (token, on) => {
        const parts = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on) parts.add(token);
        else parts.delete(token);
        this.className = [...parts].join(' ');
      },
    };
  }
  set innerHTML(value) {
    this._html = String(value);
  }
  get innerHTML() {
    return this._html;
  }
  focus() {}
  click() {
    if (!this.disabled) this.dispatchEvent({ type: 'click' });
  }
  querySelectorAll(selector) {
    const descendants = root => root.children.flatMap(child => [child, ...descendants(child)]);
    if (selector === '[data-choice-index]')
      return descendants(this).filter(node => node.dataset.choiceIndex !== undefined);
    return [];
  }
}
class Document extends EventTarget {
  constructor() {
    super();
    this.body = new Element(this, 'body');
  }
  createElement(tag) {
    return new Element(this, tag);
  }
  querySelectorAll() {
    return [];
  }
}
const descendants = root => root.children.flatMap(child => [child, ...descendants(child)]);
const buttons = document => descendants(document.body).filter(node => node.tagName === 'button');
const choices = document => descendants(document.body).filter(node => node.dataset.choiceIndex !== undefined);

const document = new Document();
globalThis.document = document;
const { collectArtifactAcquisitionAnswers, collectNonCombatAnswers } = require('../src/common/nonCombatSelection.ts');
const stat = {
  battle: {
    cards: [
      {
        id: 'a',
        runInstanceId: 'a#1',
        templateId: 'a',
        name: '甲',
        type: 'Attack',
        rarity: 'Common',
        quantity: 1,
        cost: 1,
        effects: { damage: 4, apply_status: 'focus' },
        statuses: [
          { id: 'focus', name: '专注', emoji: '✨', type: 'buff', triggers: { hold: { modify: 'damage', add: 1 } } },
        ],
      },
      {
        id: 'b',
        runInstanceId: 'b#1',
        templateId: 'b',
        name: '乙',
        type: 'Skill',
        rarity: 'Common',
        quantity: 1,
        cost: 1,
        effects: { block: 4 },
      },
    ],
  },
};
const unchanged = structuredClone(stat);
const pending = collectNonCombatAnswers({
  stat,
  seed: 'fixture',
  settlement: {
    deck_actions: [{ id: 'remove-one', kind: 'remove', count: 1, pick: 'choose' }],
    grant: {
      cards: [
        { id: 'gift', name: '礼物', type: 'Skill', rarity: 'Common', quantity: 1, cost: 0, effects: { block: 3 } },
      ],
      items: [{ id: 'tonic', name: '药剂', count: 1, effects: { heal: 3 } }],
      limits: { cards: 1, items: 1 },
    },
  },
});
const chooseFirst = () => choices(document).find(node => node.dataset.choiceIndex === '0');
const confirm = () => buttons(document).find(node => node.textContent === '确认选择');
assert.match(
  chooseFirst().innerHTML,
  /造成4点伤害/,
  'selection face must show executable damage rather than flavor alone',
);
assert.match(
  chooseFirst().innerHTML,
  /mwg-status-reference/,
  'selection rules retain a clickable registered-status reference',
);
chooseFirst().click();
confirm().click();
const answers = await pending;
assert.deepEqual(answers, { deck: { 'remove-one': ['a#1'] }, grant: { cards: [0], items: [0] } });
assert.deepEqual(stat, unchanged, 'collection must never write the supplied save object');
assert.equal(document.body.children.length, 0, 'each confirmed surface is removed');

const cancelled = collectNonCombatAnswers({
  stat,
  seed: 'fixture',
  settlement: {
    grant: {
      cards: [
        { id: 'left', name: '左', type: 'Skill', rarity: 'Common', quantity: 1, cost: 0, effects: { block: 1 } },
        { id: 'right', name: '右', type: 'Skill', rarity: 'Common', quantity: 1, cost: 0, effects: { block: 2 } },
      ],
      items: [],
      limits: { cards: 1, items: 0 },
    },
  },
});
buttons(document)
  .find(node => node.textContent === '返回')
  .click();
assert.equal(await cancelled, null);
assert.deepEqual(stat, unchanged, 'cancellation must not consume or mutate anything');
const frozen = collectNonCombatAnswers({
  stat,
  seed: 'fixture',
  randomTargets: { 'copy-fixed': ['b#1'] },
  settlement: { deck_actions: [{ id: 'copy-fixed', kind: 'duplicate', count: 1, pick: 'random' }] },
});
assert.equal(choices(document).length, 0, 'frozen random actions never offer a new roll');
buttons(document)
  .find(node => node.textContent === '确认继续')
  .click();
assert.deepEqual(await frozen, { deck: { 'copy-fixed': ['b#1'] } });
assert.deepEqual(stat, unchanged, 'frozen result review remains read-only');

const dependent = collectNonCombatAnswers({
  stat, seed: 'unused-current-seed', randomSeeds: { second: 'persisted-stage-order' },
  settlement: { deck_actions: [
    { id: 'first', kind: 'remove', count: 1, pick: 'choose' },
    { id: 'second', kind: 'remove', count: 1, pick: 'random' },
  ] },
});
chooseFirst().click();
confirm().click();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(choices(document).length, 0, 'dependent random action shows its result, never a reroll picker');
buttons(document).find(node => node.textContent === '确认继续').click();
assert.deepEqual(await dependent, { deck: { first: ['a#1'], second: ['b#1'] } });
assert.deepEqual(stat, unchanged, 'manual then seeded random collection never edits live cards');

const acquisitionStat = structuredClone(stat);
acquisitionStat.battle.core = { hp: 20, max_hp: 20, lust: 0, max_lust: 10, resources: [] };
const acquisitions = collectArtifactAcquisitionAnswers({
  stat: acquisitionStat,
  artifacts: [
    { id: 'first', on_acquire: { deck_actions: [{ id: 'first-remove', kind: 'remove', count: 1, pick: 'choose' }] } },
    { id: 'second', on_acquire: { deck_actions: [{ id: 'second-remove', kind: 'remove', count: 1, pick: 'choose' }] } },
  ],
});
chooseFirst().click();
confirm().click();
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(chooseFirst().innerHTML, /乙/, 'the second acquisition sees the first acquisition private-draft removal');
chooseFirst().click();
confirm().click();
assert.deepEqual(await acquisitions, {
  first: { deck: { 'first-remove': ['a#1'] } },
  second: { deck: { 'second-remove': ['b#1'] } },
});
assert.deepEqual(
  acquisitionStat.battle.cards,
  stat.battle.cards,
  'artifact answer collection preplays only a private draft',
);

const stanceGrantStat = structuredClone(stat);
stanceGrantStat.battle.cards.push({
  id: 'demon_awakening', runInstanceId: 'demon_awakening#1', templateId: 'demon_awakening',
  name: '恶魔觉醒', type: 'Skill', rarity: 'Rare', quantity: 1, cost: 1,
  effects: { stance: { id: 'demon_form', name: '恶魔形态', enter: { block: 2 },
    passive: { modify: 'damage', multiply: 1.5 }, exit: { draw: 1 } } },
});
const stanceGrant = collectNonCombatAnswers({
  stat: stanceGrantStat, seed: 'stance-grant', settlement: { grant: {
    cards: [{ id: 'guilt_hammer', name: '罪念凿击', type: 'Attack', rarity: 'Common', quantity: 1, cost: 1,
      effects: { damage: "self.stance == 'demon_form' ? 8 : 5", to: 'opponent' } },
      { id: 'plain_guard', name: '素身防御', type: 'Skill', rarity: 'Common', quantity: 1, cost: 1,
        effects: { block: 5 } }],
    items: [], limits: { cards: 1, items: 0 },
  } },
});
const stanceGrantFace = chooseFirst().innerHTML;
assert.match(stanceGrantFace, /自身处于<span class="mwg-status-reference[^>]+>恶魔形态<\/span>时改为8点/,
  'grant preview resolves a stance defined by another owned card into a clickable Chinese reference');
assert.doesNotMatch(stanceGrantFace, /self\.stance|>demon_form</, 'raw stance ids never appear as visible card text');
chooseFirst().click(); confirm().click();
assert.deepEqual(await stanceGrant, { grant: { cards: [0], items: [] } });
assert.deepEqual(stanceGrantStat.battle.cards.at(-1).id, 'demon_awakening', 'grant preview remains read-only');
console.log(
  'Non-combat selection DOM fixture passed: sequential picks, x-of-y grants, cancellation, and no-save-write boundary.',
);
const {choosePendingCardRemoval}=require('../src/common/nonCombatSelection.ts');
const pendingAbort=new AbortController();
const pendingSelection=choosePendingCardRemoval(stat,1,pendingAbort.signal);
assert.equal(document.body.children.length,1);
pendingAbort.abort();
assert.equal(await pendingSelection,null);
assert.equal(document.body.children.length,0,'destroying the owner view removes its pending dialog');
assert.deepEqual(stat,unchanged,'aborting a pending removal never mutates cards');
assert.equal(await choosePendingCardRemoval(stat,1,pendingAbort.signal),null);
assert.equal(document.body.children.length,0,'already-aborted view never mounts an orphan dialog');
