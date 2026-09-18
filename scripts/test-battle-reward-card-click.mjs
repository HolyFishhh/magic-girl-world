import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseFragment } from 'parse5';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { renderBattleRewardsMenu } = require('../src/common/battleRewardsMenu.ts');
const { renderCardFace } = require('../src/shared/cardFace.ts');

class Element {
  children = []; events = new Map(); dataset = {}; disabled = false; className = ''; tabIndex = 0;
  constructor(tag = 'div', ownerDocument = null) { this.tagName = tag.toLowerCase(); this.ownerDocument = ownerDocument; }
  get classList() { return { toggle: (name, enabled) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); enabled ? names.add(name) : names.delete(name); this.className = [...names].join(' '); } }; }
  set innerHTML(html) { this.markup = html; this.children = parseFragment(html).childNodes.map(node => this.#fromParse5(node)); }
  get innerHTML() { return this.markup || ''; }
  #fromParse5(node) {
    const element = new Element(node.tagName || '#text', this.ownerDocument); element.parentElement = this;
    for (const attr of node.attrs || []) {
      if (attr.name === 'class') element.className = attr.value;
      if (attr.name === 'disabled') element.disabled = true;
      if (attr.name.startsWith('data-')) element.dataset[attr.name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = attr.value;
      element.attributes ??= {}; element.attributes[attr.name] = attr.value;
    }
    element.children = (node.childNodes || []).map(child => element.#fromParse5(child)); return element;
  }
  append(node) { node.parentElement = this; this.children.push(node); }
  setAttribute(name, value) { this.attributes ??= {}; this.attributes[name] = value; }
  addEventListener(type, callback) { const handlers = this.events.get(type) || []; handlers.push(callback); this.events.set(type, handlers); }
  focus() {}
  matches(selector) {
    if (selector === 'button') return this.tagName === 'button';
    if (selector === 'a' || selector === 'details') return this.tagName === selector;
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const data = selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);
    if (data) { const value = this.dataset[data[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase())]; return value !== undefined && (data[2] === undefined || value === data[2]); }
    return false;
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (selector.split(',').some(part => node.matches(part.trim()))) return node; return null; }
  querySelectorAll(selector) { const selectors = selector.split(',').map(item => item.trim()), found = []; const visit = node => { for (const child of node.children) { if (selectors.some(item => child.matches(item))) found.push(child); visit(child); } }; visit(this); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  dispatchClick() { for (let node = this; node; node = node.parentElement) for (const handler of node.events.get('click') || []) handler({ target: this, currentTarget: node }); }
}
const doc = { createElement: tag => new Element(tag, doc) };
const card = { id: 'strike', name: '打击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 6 } };
const stat = { reward: { card: [card, { ...card, id: 'guard', name: '防御', effects: { block: 5 } }, { ...card, id: 'burst', name: '爆发', effects: { damage: 9 } }, { ...card, id: 'flare', name: '闪耀', effects: { damage: 12 } }], artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 } } };
const root = new Element('div', doc), claims = [];
const actualCardFace = candidate => renderCardFace(candidate, { costLabel: '1 ⚡', rarityLabel: '普通', typeLabel: '攻击', rulesHtml: '<button type="button" class="nested-card-button">卡面按钮</button><span data-content-reference="card">详情</span>' });
renderBattleRewardsMenu({ root, stat, enabled: true, renderCard: actualCardFace, renderSupport: () => '', claim: async request => { claims.push(request); } });
root.querySelector('.battle-reward-category').dispatchClick();
const option = root.querySelector('.battle-reward-option'), confirm = root.querySelector('.reward-confirm');
assert.match(root.innerHTML, /<div class="reward-header"><strong class="title">卡牌自选<\/strong><span class="battle-reward-hint">4选1<\/span><\/div>/, 'the entry header only carries the reward title and pick count');
assert.match(root.innerHTML, /<div class="reward-actions reward-choice-actions"><button[^>]*reward-back[^>]*>返回<\/button><button[^>]*reward-confirm[^>]*>确认领取<\/button>/, 'back and confirm share the bottom action bar in left-to-right order');
assert.equal(root.querySelectorAll('.battle-reward-option').length, 4, 'four candidates render as four complete selectable card faces');
assert.ok(root.querySelector('.battle-reward-option-list').className.includes('mwg-card-choice-list'), 'the reward surface uses the shared responsive card-choice layout');
assert.equal(confirm.disabled, true);
option.querySelector('[data-content-reference]').dispatchClick();
assert.equal(confirm.disabled, true, 'a detail reference does not select its card candidate');
const nestedCardButton = option.querySelector('.nested-card-button');
assert.ok(nestedCardButton, 'the actual renderCardFace HTML provides the nested control');
nestedCardButton.dispatchClick();
assert.equal(confirm.disabled, false, 'an ordinary card-face button bubbles to and selects the candidate');
root.querySelector('.reward-back').dispatchClick();
assert.ok(root.querySelector('.battle-reward-category'), 'back returns to the unchanged candidate menu');
root.querySelector('.battle-reward-category').dispatchClick();
root.querySelector('.battle-reward-option').dispatchClick();
root.querySelector('.reward-confirm').dispatchClick(); root.querySelector('.reward-confirm').dispatchClick();
await Promise.resolve();
assert.deepEqual(claims, [{ kind: 'cards', indexes: [0], cardGroupId: 'cards' }], 'confirm claims the precise selected index exactly once');
console.log('PASS four complete card faces share the responsive choice layout; explicit detail references do not select; ordinary card controls, back, and claim work.');
// Run the document capture handlers as well: they must not swallow a choice
// face's click before its owning picker can receive it.
const { bindCardPreview } = require('../src/shared/cardPreview.ts');
const captureDocument = new Element('document');
captureDocument.createElement = () => { throw new Error('a choice click must not open a whole-card preview'); };
bindCardPreview(captureDocument);
const effectOption = new Element(); effectOption.className = 'effect-choice-option mwg-card-choice';
effectOption.innerHTML = actualCardFace({ id: 'choice', name: '四选一', type: 'Skill', rarity: 'Common' });
let intercepted = false;
for (const handler of captureDocument.events.get('click') || []) handler({target:effectOption.querySelector('.card-name'),preventDefault(){intercepted=true},stopPropagation(){intercepted=true}});
assert.equal(intercepted,false,'document card-preview capture preserves effect-choice selection');
// The same card-preview binding also owns pointerdown for long-press details.
// A complete card face inside the effect picker must not start that timer,
// otherwise it can put a pinned preview over the picker before a touch click.
const originalSetTimeout = globalThis.setTimeout;
let previewTimerStarts = 0;
globalThis.setTimeout = () => { previewTimerStarts++; return 1; };
for (const handler of captureDocument.events.get('pointerdown') || []) {
  handler({ target: effectOption.querySelector('.card-name'), stopPropagation() {} });
}
assert.equal(previewTimerStarts, 0, 'document card-preview pointer capture leaves effect-choice gestures to their owner');
const ordinaryCard = new Element(); ordinaryCard.className = 'mwg-card enhanced-card';
ordinaryCard.innerHTML = actualCardFace({ id: 'ordinary', name: '普通卡牌', type: 'Skill', rarity: 'Common' });
for (const handler of captureDocument.events.get('pointerdown') || []) {
  handler({ target: ordinaryCard.querySelector('.card-name'), stopPropagation() {} });
}
globalThis.setTimeout = originalSetTimeout;
assert.equal(previewTimerStarts, 1, 'ordinary non-hand cards retain the long-press detail path');
console.log('PASS card-preview capture leaves battle effect/card choice clicks to their owners.');
// Production battle is inside the story panel's open details fold. A guard
// must stop at its own choice boundary instead of treating that fold as a detail control.
const {isCardFaceDetailInteraction}=require('../src/shared/cardChoice.ts');
const adventureFold=new Element('details');adventureFold.append(effectOption);
assert.equal(isCardFaceDetailInteraction(effectOption.querySelector('.card-name')),false,'outer adventure fold does not intercept card selection');
const innerDetails=new Element('details');const innerText=new Element('span');innerDetails.append(innerText);effectOption.append(innerDetails);
assert.equal(isCardFaceDetailInteraction(innerText),true,'a real detail control inside the choice retains its click');
console.log('PASS production adventure fold does not block choice clicks; nested detail controls remain independent.');
