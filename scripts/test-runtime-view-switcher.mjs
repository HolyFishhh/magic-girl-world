import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const runtimeViews = require('../src/runtime/runtimeViewSwitcher.ts');
const { TavernContinuationHost } = require('../src/runtime/tavernContinuation.ts');
const { TavernBattleEndHost } = require('../src/fish/core/battleEndHost.ts');
const { createRunState, enterRunNode } = require('../src/game-core/runState.ts');

const commonSource = readFileSync('src/common/index.ts', 'utf8');
const fishSource = readFileSync('src/fish/index.ts', 'utf8');
assert.doesNotMatch(
  commonSource,
  /addEventListener\(\s*['"]pagehide['"]/,
  'common pagehide belongs to the shared lifecycle',
);
assert.doesNotMatch(
  fishSource,
  /addEventListener\(\s*['"]pagehide['"]/,
  'fish pagehide belongs to the shared lifecycle',
);
assert.match(commonSource, /__CONTENT_PROFILE_SEQUENCE \+= 1/);
assert.match(commonSource, /__disposeTowerGenerationListener\?\.\(\)/);
assert.match(commonSource, /clearTimeout\(__towerGenerationRefreshTimer\)/);
assert.match(commonSource, /document\.removeEventListener\('click', handleCommonDocumentClick\)/);
assert.match(commonSource, /viewSequence === __commonViewSequence/);
assert.match(commonSource, /function maybeOpenTowerBattle[\s\S]*switchRuntimeView\('fish'\)/);
assert.match(fishSource, /for \(const dispose of this\.disposeStateListeners\.splice\(0\)\) dispose\(\)/);
assert.match(fishSource, /if \(this\.destroyed\) return;[\s\S]*registerNaturalLanguageCardRepairHandler/);
assert.match(
  readFileSync('src/runtime/runtimeViewSwitcher.ts', 'utf8'),
  /script\.textContent = isolatedRuntimeScript\(asset\.script\)/,
  'in-place view bundles must be isolated from previous top-level lexical bindings',
);
assert.match(
  readFileSync('src/runtime/viewBootstrap.ts', 'utf8'),
  /script\.textContent = isolatedRuntimeScript\(asset\.script\)/,
  'the first mounted bundle must also be isolated for later in-place switching',
);

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: options === true || options?.once === true });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      entries.filter(entry => entry.listener !== listener),
    );
  }

  dispatchEvent(event) {
    const entries = [...(this.listeners.get(event.type) || [])];
    for (const entry of entries) {
      entry.listener.call(this, event);
      if (entry.once) this.removeEventListener(event.type, entry.listener);
    }
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }
}

class FakeNode {
  constructor(tagName, owner) {
    this.tagName = tagName.toUpperCase();
    this.owner = owner;
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.removed = false;
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(node) {
    this.owner.nodes.push(node);
    if (node.tagName === 'SCRIPT') Function(node.textContent)();
    return node;
  }

  remove() {
    this.removed = true;
  }
}

function createFakeDocument() {
  const document = {
    title: '',
    nodes: [],
    documentElement: { dataset: {} },
    createElement(tagName) {
      return new FakeNode(tagName, document);
    },
    querySelectorAll(selector) {
      const key =
        selector === '[data-mwg-runtime-style]'
          ? 'mwgRuntimeStyle'
          : selector === '[data-mwg-runtime-script]'
            ? 'mwgRuntimeScript'
            : null;
      return key ? document.nodes.filter(node => !node.removed && node.dataset[key] !== undefined) : [];
    },
  };
  document.head = new FakeNode('head', document);
  document.body = new FakeNode('body', document);
  return document;
}

const fakeWindow = new FakeEventTarget();
const fakeDocument = createFakeDocument();
globalThis.window = fakeWindow;
globalThis.document = fakeDocument;

const destroyCounts = { common: 0, fish: 0 };
const activeResources = new Set();
let resourceSequence = 0;
globalThis.__MWG_TEST_MOUNT__ = view => {
  if (view === 'fish') {
    const previousScripts = fakeDocument.nodes.filter(
      node => !node.removed && node.dataset.mwgRuntimeScript === 'common',
    );
    assert.ok(previousScripts.length > 0, 'the previous bundle must stay attached until fish has mounted');
  }
  const id = `${view}-${++resourceSequence}`;
  const pulseListener = () => undefined;
  const timer = setTimeout(() => undefined, 10_000);
  activeResources.add(id);
  fakeWindow.addEventListener('mwg-test-pulse', pulseListener);
  runtimeViews.registerRuntimeViewLifecycle(view, () => {
    destroyCounts[view] += 1;
    activeResources.delete(id);
    fakeWindow.removeEventListener('mwg-test-pulse', pulseListener);
    clearTimeout(timer);
  });
};

globalThis.MagicGirlWorld = {
  spec: 'mwg.tavern-runtime/v1',
  version: 'test',
  getViewAsset(view) {
    return {
      title: `view:${view}`,
      bodyHtml: `<main>${view}</main>`,
      styles: `/* ${view} */`,
      script: `globalThis.__MWG_TEST_MOUNT__(${JSON.stringify(view)});`,
    };
  },
};

fakeDocument.documentElement.dataset.mwgView = 'common';
fakeDocument.documentElement.dataset.mwgMountedView = 'common';
const initialCommonScript = fakeDocument.createElement('script');
initialCommonScript.dataset.mwgRuntimeScript = 'common';
fakeDocument.body.appendChild(initialCommonScript);
globalThis.__MWG_TEST_MOUNT__('common');
assert.equal(activeResources.size, 1);
assert.equal(fakeWindow.listenerCount('pagehide'), 1);
assert.equal(fakeWindow.listenerCount('mwg-test-pulse'), 1);

runtimeViews.switchRuntimeView('fish');
assert.equal(runtimeViews.currentRuntimeView(), 'fish');
assert.equal(fakeDocument.title, 'view:fish');
assert.equal(fakeDocument.body.innerHTML, '<main>fish</main>');
assert.equal(destroyCounts.common, 1, 'common must be torn down before fish mounts');
assert.equal(activeResources.size, 1);
assert.equal(fakeWindow.listenerCount('pagehide'), 1);
assert.equal(fakeWindow.listenerCount('mwg-test-pulse'), 1);

runtimeViews.switchRuntimeView('fish');
assert.equal(destroyCounts.fish, 0, 'switching to the already active view is a no-op');

for (let index = 0; index < 8; index += 1) {
  runtimeViews.switchRuntimeView(index % 2 === 0 ? 'common' : 'fish');
  assert.equal(activeResources.size, 1, 'only the current bundle may retain resources');
  assert.equal(fakeWindow.listenerCount('pagehide'), 1, 'pagehide listeners must not accumulate');
  assert.equal(fakeWindow.listenerCount('mwg-test-pulse'), 1, 'view listeners must not accumulate');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function towerVariables(seed) {
  const awaiting = createRunState({ seed });
  const run = enterRunNode(awaiting, awaiting.choices[0].id);
  return {
    stat_data: {
      game_mode: 'tower',
      game_mode_lock: { schemaVersion: 1, mode: 'tower' },
      run,
      battle: {},
    },
    mwg: { battle_session: { turn: 2 } },
  };
}

function storyVariables() {
  return {
    stat_data: {
      game_mode: 'story',
      game_mode_lock: { schemaVersion: 1, mode: 'story' },
      run: null,
      battle: {},
    },
    mwg: { battle_session: { turn: 2 } },
  };
}

function battleState() {
  return {
    currentTurn: 2,
    battleRequest: null,
    battle: {},
    player: {
      currentHp: 20,
      maxHp: 30,
      currentLust: 0,
      maxLust: 100,
      energy: 0,
      maxEnergy: 3,
      block: 0,
      items: [],
      statusEffects: [],
      hand: [],
      drawPile: [],
      discardPile: [],
      exhaustPile: [],
      deck: [],
      relics: [],
      abilities: [],
    },
    enemy: null,
    enemies: [],
    defeatedEnemies: [],
  };
}

function createBattleHarness(variables, continuationCalls) {
  const box = { value: clone(variables) };
  const lifecycle = [];
  let dialog = null;
  const continuation = new TavernContinuationHost({
    createChatMessages: async messages => continuationCalls.push(['create', messages]),
    triggerGeneration: async () => continuationCalls.push(['trigger']),
  });
  const host = new TavernBattleEndHost(
    continuation,
    {
      getState: battleState,
      saveBattleSession: async () => lifecycle.push('save'),
      clearBattleSession: async () => {
        lifecycle.push('clear');
        delete box.value.mwg?.battle_session;
      },
      reloadBattleState: async () => true,
      readVariables: () => clone(box.value),
      replaceVariables: async value => {
        box.value = clone(value);
      },
      settleBattle: async input => lifecycle.push(`settle:${input.result}`),
      reloadPage: () => lifecycle.push('reload'),
      openCommonView: () => runtimeViews.switchRuntimeView('common'),
    },
    {
      hasBattleEndDialog: () => false,
      showBattleEndDialog: request => {
        dialog = request;
      },
      addLog: () => undefined,
    },
  );
  return { host, lifecycle, getDialog: () => dialog };
}

for (const [index, result] of ['victory', 'defeat'].entries()) {
  runtimeViews.switchRuntimeView('fish');
  const continuationCalls = [];
  const harness = createBattleHarness(towerVariables(700 + index), continuationCalls);
  await harness.host.presentBattleEnd(result);
  const dialog = harness.getDialog();
  assert.equal(dialog.mode, 'tower');
  assert.equal(dialog.onRestart, undefined);
  await dialog.onConfirm('这段文本在爬塔结算中必须被忽略');
  assert.equal(runtimeViews.currentRuntimeView(), 'common', `${result} must return fish to common in place`);
  assert.deepEqual(continuationCalls, [], 'tower settlement must not create a floor or invoke /trigger');
  assert.deepEqual(harness.lifecycle, ['save', 'clear', `settle:${result}`]);
}

runtimeViews.switchRuntimeView('fish');
const storyCalls = [];
const storyHarness = createBattleHarness(storyVariables(), storyCalls);
await storyHarness.host.presentBattleEnd('victory');
const storyDialog = storyHarness.getDialog();
assert.equal(storyDialog.mode, 'story');
assert.equal(typeof storyDialog.onRestart, 'function');
await storyDialog.onConfirm('继续调查战场');
assert.deepEqual(
  storyCalls.map(call => call[0]),
  ['create', 'trigger'],
  'story battles must keep the existing narrative continuation path',
);
assert.match(storyCalls[0][1][0].message, /继续调查战场/);

fakeWindow.dispatchEvent({ type: 'pagehide' });
assert.equal(activeResources.size, 0);
assert.equal(fakeWindow.listenerCount('pagehide'), 0);
assert.equal(fakeWindow.listenerCount('mwg-test-pulse'), 0);
delete globalThis.__MWG_TEST_MOUNT__;
delete globalThis.MagicGirlWorld;

console.log('runtime common/fish switching and battle-exit boundaries passed');
