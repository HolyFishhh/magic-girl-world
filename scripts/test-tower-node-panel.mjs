import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const runCore = require('../src/game-core/runState.ts');
const { renderTowerNodePanel } = require('../src/common/towerNodePanel.ts');

class FakeEventTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener.call(this, event);
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }
  values() {
    return this.element.className.split(/\s+/).filter(Boolean);
  }
  contains(value) {
    return this.values().includes(value);
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
    this.style = {};
    this.attributes = new Map();
    this.disabled = false;
    this.type = '';
    this._textContent = '';
  }
  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }
  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
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
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  click() {
    if (!this.disabled) this.dispatchEvent({ type: 'click' });
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(this, tagName);
  }
  createTextNode(value) {
    const node = new FakeElement(this, '#text');
    node.textContent = value;
    return node;
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

function reach(kind) {
  for (let seed = 1; seed <= 180; seed += 1) {
    let run = runCore.createRunState({ seed });
    const path = run.map.acts[0].paths.find(candidate =>
      candidate.some(nodeId => run.map.nodes.find(node => node.id === nodeId)?.kind === kind),
    );
    if (!path) continue;
    for (const nodeId of path) {
      const choice = run.choices.find(entry => entry.id === nodeId);
      assert.ok(choice);
      if (choice.kind === kind) return runCore.enterRunNode(run, choice.id);
      run = runCore.completeRunNode(runCore.enterRunNode(run, choice.id), { outcome: 'cleared' });
    }
  }
  throw new Error(`unable to reach ${kind}`);
}

const document = new FakeDocument();
const root = document.createElement('main');
const battle = {
  core: { emoji: '🧙', hp: 75, max_hp: 80 },
  cards: [
    {
      id: 'starter_strike',
      name: '起手斩',
      emoji: '⚔️',
      type: 'Attack',
      rarity: 'Common',
      cost: 1,
      quantity: 2,
      effects: { damage: 6 },
    },
  ],
};

// Opening choices expose narrative and natural-language outcome tags.
{
  const run = runCore.createRunState({ seed: 7 });
  run.opening = {
    phase: 'ready',
    attempts: 1,
    content: {
      title: '星门守望者',
      narrative: '守望者把两份启程礼放在门前。',
      choices: [
        { id: 'gold', label: '接过钱袋', description: '准备沿途交易。', outcome: { gold: 30 } },
        { id: 'heal', label: '接受祝福', outcome: { max_hp: 5 } },
      ],
    },
  };
  let selected = '';
  assert.equal(
    renderTowerNodePanel({
      root,
      stat: { battle },
      run,
      isLatest: true,
      callbacks: {
        onOpeningChoice: id => {
          selected = id;
        },
      },
    }),
    true,
  );
  assert.ok(root.textContent.includes('星门守望者'));
  assert.ok(root.textContent.includes('金币+30'));
  assert.equal(withClass(root, 'is-gain').length, 2);
  assert.equal(withClass(root, 'tower-node-panel')[0].attributes.get('role'), 'region');
  withDataset(root, 'choiceId', 'gold')[0].click();
  assert.equal(selected, 'gold');
}

// Failed opening is explicit and safely retryable.
{
  const run = runCore.createRunState({ seed: 9 });
  run.opening = { phase: 'failed', attempts: 2, error: '模型返回格式错误' };
  let retried = 0;
  renderTowerNodePanel({
    root,
    stat: { battle },
    run,
    isLatest: true,
    callbacks: {
      onRetryOpening: () => {
        retried += 1;
      },
    },
  });
  assert.ok(root.textContent.includes('模型返回格式错误'));
  withClass(root, 'tower-node-primary')[0].click();
  assert.equal(retried, 1);
}

// Event and rest stay on the same panel and dispatch only structured actions.
{
  const run = reach('event');
  run.opening = { phase: 'consumed', attempts: 1 };
  const stat = {
    battle,
    run_node: { title: '雾中石碑', narrative: '石碑要求旅人留下一个选择。' },
    run_event: {
      choices: [
        { id: 'touch', label: '触碰石碑', outcome: { hp: -4, reward: { items: [] } } },
        { id: 'leave', label: '绕行', outcome: {} },
      ],
    },
  };
  let selected = '';
  renderTowerNodePanel({
    root,
    stat,
    run,
    isLatest: true,
    callbacks: {
      onEventChoice: id => {
        selected = id;
      },
    },
  });
  assert.ok(root.textContent.includes('雾中石碑'));
  assert.ok(root.textContent.includes('生命-4'));
  assert.equal(withClass(root, 'is-cost').length, 1);
  withDataset(root, 'choiceId', 'touch')[0].click();
  assert.equal(selected, 'touch');
}
{
  const run = reach('rest');
  run.opening = { phase: 'consumed', attempts: 1 };
  let healed = 0;
  let cardAction = '';
  renderTowerNodePanel({
    root,
    stat: { battle, run_node: { title: '余烬营火' }, run_rest: { description: '火焰仍有温度。' } },
    run,
    isLatest: true,
    callbacks: {
      onRestHeal: () => {
        healed += 1;
      },
      onRestCardAction: action => {
        cardAction = action;
      },
    },
  });
  assert.ok(root.textContent.includes('恢复 30% 最大生命'));
  withClass(root, 'tower-node-primary')[0].click();
  assert.equal(healed, 1);
  withClass(root, 'tower-rest-upgrade')[0].click();
  assert.equal(cardAction, 'upgrade');
}

// A failed combat keeps a terminal panel with one explicit restart action.
{
  const initial = runCore.createRunState({ seed: 77 });
  const active = runCore.enterRunNode(initial, initial.choices[0].id);
  const run = runCore.completeRunNode(active, { outcome: 'failed' });
  let restarted = 0;
  renderTowerNodePanel({
    root,
    stat: { battle },
    run,
    isLatest: true,
    callbacks: {
      onRestart: () => {
        restarted += 1;
      },
    },
  });
  assert.equal(withClass(root, 'tower-node-panel')[0].dataset.panel, 'terminal');
  assert.equal(withClass(root, 'tower-node-primary').length, 1);
  withClass(root, 'tower-node-primary')[0].click();
  assert.equal(restarted, 1);
}

// The completed run uses the shared deterministic finale calculator.
{
  const run = runCore.createRunState({ seed: 88 });
  run.opening = { phase: 'consumed', attempts: 1 };
  run.phase = 'won';
  run.act = run.actCount;
  run.score = { defeatedEnemyScore: 426, averageDifficultyPercent: 91.5, encounters: [] };
  renderTowerNodePanel({ root, stat: { battle }, run, isLatest: true });
  assert.ok(root.textContent.includes('🐟'));
  assert.ok(root.textContent.includes('426'));
  assert.ok(root.textContent.includes('91.5%'));
}

const source = readFileSync('src/common/towerNodePanel.ts', 'utf8');
assert.doesNotMatch(source, /\.innerHTML\s*=/);
assert.doesNotMatch(source, /insertAdjacentHTML\s*\(/);

const styleSource = readFileSync('src/common/index.scss', 'utf8');
assert.match(styleSource, /\.tower-node-primary,[\s\S]*min-height:\s*44px/);
assert.match(styleSource, /\.run-section\.has-tower-map \+ \.action-section/);
assert.match(styleSource, /@media \(min-width:\s*1040px\)/);

console.log('Tower opening, event, rest, and finale panel DOM tests passed.');
