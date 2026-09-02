import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const output = path.join(root, 'dist', 'sillytavern-extension', 'magic-girl-design-assistant');
const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
const script = await fs.readFile(path.join(output, manifest.js), 'utf8');
const worker = await fs.readFile(path.join(output, 'design-worker.js'), 'utf8');
const css = await fs.readFile(path.join(output, manifest.css), 'utf8');

assert.equal(manifest.minimum_client_version, '1.18.0');
assert.equal(manifest.version, '0.3.2', 'manifest must match the tower coordinator capability version');
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
await module.getController().warmup();
const request = { prompt: [{ role: 'user', content: 'update' }] };
duringExtra = true;
await events.emit('generate_after_data', request);
assert.ok(request.prompt.some(message => String(message.content).includes('[MWG_DESIGN_CONTEXT/v1]')));
module.disable();
assert.equal(globalThis.MagicGirlDesignAssistant, undefined);
assert.equal(globalThis.MagicGirlDesignAssistantBootstrap?.phase, 'disabled');
delete globalThis.SillyTavern;
delete globalThis.Mvu;
delete globalThis.MagicGirlDesignAssistantBootstrap;

console.log('Standalone SillyTavern extension package is complete, offline, and exposes its activation hook.');
