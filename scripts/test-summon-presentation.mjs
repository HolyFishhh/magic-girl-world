import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { renderSummonPanel } = require('../src/shared/summonPresentation.ts');
const { renderStatusReferences, bindStatusReferenceDetails } = require('../src/shared/statusReference.ts');

const summon = {
  id: 'mirror_fairy', name: '镜中妖精', emoji: '🪞', description: '<img src=x>',
  maxHp: 12, currentHp: 7, block: 3, actionsPerActivation: 2, speed: 4, actionPriority: 2,
  slot: 'mirror', onExisting: 'reinforce', onDefeated: 'revive_reinforce', tags: ['familiar'],
  intercept: { mode: 'unblocked_attack', maxPerTurn: 2 },
  capabilities: { selectable: false, acceptsStatus: false },
  resources: { shine: { id: 'shine', name: '辉光', emoji: '✦', current: 2, max: 4, refresh: 'retain' } },
  statusEffects: [{ id: 'glow', name: '辉光', emoji: '✦', stacks: 2, duration: 3 }],
  modifiers: { damage_modifier: 2, damage_taken_modifier: -1 },
  actions: [{ id: 'ray', name: '镜光', effects: { damage: 6 } }],
  abilities: [{ id: 'echo', name: '回响', trigger: 'turn_start', eventQuery: { ordinal: 'first' }, effects: { block: 4 } }],
};

const panel = renderSummonPanel(summon);
for (const text of ['生命 7/12', '每次激活行动 2 次', '速度 4', '行动优先级 2', '能力与限制', '重复召唤与倒下后的处理', '专属资源', '当前状态', '数值修正', '自动行动', '触发能力', '6点伤害', '回合开始时（本场战斗首次）：自身获得4点格挡']) {
  assert.match(panel, new RegExp(text));
}
assert.match(panel, /&lt;img src=x&gt;/, 'authored markup is escaped');
assert.doesNotMatch(panel, /"maxHp"|\[object Object\]/, 'structured data is never rendered as raw JSON');

const killPanel = renderSummonPanel({ ...summon, abilities: [{
  id: 'harvest', name: '收割', trigger: { on: 'kill', effects: { block: 4 } },
}] });
assert.match(killPanel, /<small>击败敌人/);
assert.match(killPanel, /击败敌人时.*4点格挡/);
assert.doesNotMatch(killPanel, /\bkill\b/, 'both the summon ability header and executable rules translate the trigger');
assert.equal(require('../src/fish/combat/effectDefinitions.ts').getTriggerDefinition('kill').name, '击败敌人时');

const linked = renderStatusReferences('召唤 镜中妖精', [{ id: 'mirror_fairy', name: '镜中妖精', rules: '摘要', summon }]);
assert.match(linked, /data-summon-definition=/);

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.className = ''; }
  append(...children) { this.children.push(...children); }
  remove() { this.removed = true; }
  contains(node) { return node === this || this.children.includes(node); }
  setAttribute() {}
  focus() { this.focused = true; }
  getBoundingClientRect() { return { right: 100, top: 40 }; }
  set innerHTML(value) { this.html = value; }
  get innerHTML() { return this.html || ''; }
  closest(selector) { return selector === '.mwg-status-reference' && this.className === 'mwg-status-reference' ? this : null; }
}
class Document {
  constructor() { this.listeners = {}; this.body = new Element('body'); this.documentElement = { clientWidth: 800, clientHeight: 600 }; }
  createElement(tag) { return new Element(tag); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
}

const doc = new Document();
bindStatusReferenceDetails(doc);
const reference = new Element('span');
reference.className = 'mwg-status-reference';
reference.dataset = { statusName: '镜中妖精', statusRules: '摘要', statusFlavor: '', summonDefinition: JSON.stringify(summon) };
let prevented = false, stopped = false;
doc.listeners.click({ target: reference, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
const popup = doc.body.children.at(-1);
assert.equal(popup.className, 'mwg-status-popover');
assert.equal(prevented && stopped, true, 'reference click is captured before choice handlers');
assert.match(popup.children.at(-1).innerHTML, /mwg-summon-panel/);
assert.match(popup.children.at(-1).innerHTML, /触发能力/);

const stanceReference = new Element('span');
stanceReference.className = 'mwg-status-reference';
stanceReference.dataset = {
  statusName: '恶魔形态', statusRules: '点击查看姿态详情。', statusFlavor: '',
  stanceDefinition: JSON.stringify({ id: 'demon_form', name: '恶魔形态', enter: { block: 2 },
    passive: { modify: 'damage', add: 1 }, exit: [{ draw: 1 }, { apply_status: 'corruption', stacks: 2 }],
    events: [{ on: 'turn_start', effects: { damage: 3, to: 'opponent' } }] }),
  stanceContext: JSON.stringify({ stanceNames: { demon_form: '恶魔形态' }, statusNames: { corruption: '堕转' },
    statusDefinitions: { corruption: { id: 'corruption', name: '堕转', triggers: { hold: { modify: 'damage', add: 1 } } } } }),
};
doc.listeners.click({ target: stanceReference, preventDefault() {}, stopPropagation() {} });
const stancePopup = doc.body.children.at(-1);
assert.equal(stancePopup.className, 'mwg-status-popover');
for (const text of ['mwg-stance-panel', '进入时', '持续生效', '退出时', '仅此姿态生效期间', '回合开始时']) {
  assert.match(stancePopup.children.at(-1).innerHTML, new RegExp(text));
}
assert.match(stancePopup.children.at(-1).innerHTML, /mwg-status-reference[^>]+>堕转<\/span>/);

console.log('Summon/stance presentation and status-reference structured popup tests passed.');
