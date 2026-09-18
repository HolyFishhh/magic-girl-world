import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const output = process.env.ST_EXTENSION_TEST_OUTPUT
  ? path.resolve(process.env.ST_EXTENSION_TEST_OUTPUT)
  : path.join(root, 'dist', 'sillytavern-extension', 'magic-girl-design-assistant');
const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
const sourceManifest = JSON.parse(await fs.readFile(path.join(root, 'sillytavern-extension/manifest.json'), 'utf8'));
const script = await fs.readFile(path.join(output, manifest.js), 'utf8');
const worker = await fs.readFile(path.join(output, 'design-worker.js'), 'utf8');
const encounterWorker = await fs.readFile(path.join(output, 'encounter-worker.js'), 'utf8');
assert.match(encounterWorker, /mwg.encounter-evaluation/);
assert.match(encounterWorker, /production-battle-runtime/);
assert.match(script, /encounter-worker\.js/);
const css = await fs.readFile(path.join(output, manifest.css), 'utf8');

assert.equal(manifest.minimum_client_version, '1.18.0');
assert.equal(manifest.version, sourceManifest.version, 'built manifest must match the current extension release');
assert.deepEqual(manifest.dependencies, ['third-party/JS-Slash-Runner']);
assert.equal(manifest.hooks.activate, 'activate');
assert.ok(script.length > 10000, 'gameplay scoring core must be bundled into the standalone extension');
assert.ok(worker.length > 10000, 'seeded simulation must be bundled into the background worker');
assert.match(script, /DOMContentLoaded/, 'the entry module must self-activate in SillyTavern 1.18');
assert.match(script, /\.\.\/\.\.\/\.\.\/extensions\.js/, 'the entry must load SillyTavern 1.18 official extension API');
assert.ok(css.length <= 128, 'the card-scoped extension must not ship a global settings drawer stylesheet');
assert.doesNotMatch(css, /mwg-design-assistant-settings/);
assert.doesNotMatch(script, /https?:\/\//, 'runtime bundle must not fetch executable code from a CDN');
assert.doesNotMatch(worker, /https?:\/\//, 'worker bundle must not fetch executable code from a CDN');

const module = await import(`${url.pathToFileURL(path.join(output, manifest.js)).href}?test=${Date.now()}`);
assert.equal(typeof module.activate, 'function');
assert.equal(typeof module.getController, 'function');

class FakeEvents {
  listeners = new Map();
  on(event, listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }
  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter(item => item !== listener));
  }
  async emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) await listener(...args);
  }
}

const events = new FakeEvents();
let duringExtra = false;
const variables = {
  stat_data: {
    battle: {
      core: { emoji: '✨', hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
      cards: [
        { id: 'strike', name: '攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 6 } },
        { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 5 } },
      ],
      statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
      player_lust_effect: { name: '终局', effects: { damage: 6 } }, enemy: null, enemies: [],
    },
  },
};
const context = {
  characterId: 0,
  groupId: null,
  characters: [{
    data: { extensions: { magic_girl_world: { design_assistant_scope: 'mwg.design-assistant-card/v1' } } },
  }],
  extensionSettings: {
    'magic-girl-design-assistant': {
      enabled: true, difficultyPercent: 80, autoCalibration: false,
      simulationSeeds: 8, showNotifications: false, debug: false,
    },
  },
  saveSettingsDebounced() {},
  chatMetadata: {},
  saveMetadataDebounced() {},
  eventSource: events,
  eventTypes: { GENERATE_AFTER_DATA: 'generate_after_data', CHAT_CHANGED: 'chat_id_changed' },
};
globalThis.SillyTavern = { getContext: () => context };
globalThis.Mvu = {
  getMvuData: () => variables,
  isDuringExtraAnalysis: () => duringExtra,
};
await module.activate();
assert.equal(globalThis.MagicGirlDesignAssistantBootstrap?.phase, 'ready');
const owner = module.getController();
assert.equal(owner.getCapabilities().version, manifest.version, 'bundled coordinator and shipped manifest must agree');
const duplicateModule = await import(`${url.pathToFileURL(path.join(output, manifest.js)).href}?duplicate=${Date.now()}`);
assert.equal(globalThis.MagicGirlDesignAssistantBootstrap?.phase, 'ready', 'loading a duplicate bundle preserves active bootstrap status');
await duplicateModule.activate();
assert.equal(duplicateModule.getController(), owner);
assert.equal(globalThis.MagicGirlDesignAssistant, owner, 'another installed folder must not create another controller');
duplicateModule.disable();
assert.equal(globalThis.MagicGirlDesignAssistant, owner, 'disabling the skipped duplicate does not detach the active owner');
assert.equal(globalThis.MagicGirlDesignAssistantBootstrap?.phase, 'ready');
await module.getController().warmup();
const request = { prompt: [{ role: 'user', content: 'update' }] };
duringExtra = true;
await events.emit('generate_after_data', request);
assert.ok(request.prompt.some(message => String(message.content).includes('[MWG_DESIGN_CONTEXT/v1]')));
module.disable();
assert.equal(globalThis.MagicGirlDesignAssistant, undefined);
assert.equal(globalThis.MagicGirlDesignAssistantBootstrap?.phase, 'disabled');
// Both copies racing through their separate host initialization promises still
// publish only one shared controller. The former duplicate can become owner
// after a deliberate owner shutdown.
await Promise.all([duplicateModule.activate(), module.activate()]);
assert.ok(globalThis.MagicGirlDesignAssistant);
assert.equal(module.getController(), duplicateModule.getController());
module.disable();
assert.ok(globalThis.MagicGirlDesignAssistant, 'the racing loser does not own shutdown');
duplicateModule.disable();
assert.equal(globalThis.MagicGirlDesignAssistant, undefined);
assert.ok([...events.listeners.values()].every(list => list.length === 0));
const normalOn = events.on;
let activationRegistrations = 0;
events.on = function(event, listener) {
  if (++activationRegistrations === 3) throw new Error('injected partial activation failure');
  return normalOn.call(this, event, listener);
};
await module.activate();
assert.equal(globalThis.MagicGirlDesignAssistantBootstrap?.phase, 'error');
assert.equal(globalThis.MagicGirlDesignAssistant, undefined, 'failed activation releases the singleton');
assert.ok([...events.listeners.values()].every(list => list.length === 0), 'partial subscriptions are removed');
events.on = normalOn;
await module.activate();
assert.equal(globalThis.MagicGirlDesignAssistantBootstrap?.phase, 'ready', 'failed initialization can be retried');
module.disable();
delete globalThis.SillyTavern;
delete globalThis.Mvu;
delete globalThis.MagicGirlDesignAssistantBootstrap;

console.log('Standalone SillyTavern extension package is complete, offline, and exposes its activation hook.');
