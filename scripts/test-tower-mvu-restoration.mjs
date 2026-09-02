import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { DesignAssistantController } = require(resolve('src/sillytavern-extension/controller.ts'));
const { createRunState } = require(resolve('src/game-core/runState.ts'));
const {
  DESIGN_ASSISTANT_CARD_SCOPE,
  DESIGN_ASSISTANT_EXTENSION_ID,
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
} = require(resolve('src/sillytavern-extension/types.ts'));

class FakeEvents {
  listeners = new Map();
  emissions = [];
  on(event, listener) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
  }
  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter(value => value !== listener));
  }
  async emit(event, ...args) {
    this.emissions.push([event, ...args]);
    for (const listener of this.listeners.get(event) || []) await listener(...args);
  }
}

const scopedCharacter = {
  data: { extensions: { magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE } } },
};

function towerVariables(revision = 100) {
  return {
    stat_data: {
      game_mode: 'tower',
      game_mode_lock: { schemaVersion: 1, mode: 'tower' },
      run: { ...createRunState({ seed: 20260831 }), stateRevision: revision },
      battle: {
        cards: [{ id: 'stellar_refuge', name: '星体庇护', quantity: 1 }],
        artifacts: [{ id: 'singularity_pearl', name: '奇点珍珠' }],
      },
      reward: { card: [], artifact: [], item: [], limits: {} },
    },
  };
}

function createFixture(current, persisted = towerVariables()) {
  const events = new FakeEvents();
  const context = {
    chatId: 'tower-chat',
    chat: [{ mes: 'opening' }, { mes: 'tower', swipe_id: 0, variables: [structuredClone(persisted)] }],
    characterId: 0,
    groupId: null,
    characters: [scopedCharacter],
    extensionSettings: {
      [DESIGN_ASSISTANT_EXTENSION_ID]: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS, enabled: false },
    },
    saveSettingsDebounced() {},
    chatMetadata: {},
    saveMetadataDebounced() {},
    async saveChat() {},
    eventSource: events,
    eventTypes: {
      CHAT_CHANGED: 'chat_id_changed',
      CHAT_LOADED: 'chatLoaded',
      GENERATE_AFTER_DATA: 'generate_after_data',
      CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
      GENERATION_ENDED: 'generation_ended',
      MESSAGE_UPDATED: 'message_updated',
    },
  };
  const rerenders = [];
  context.updateMessageBlock = (messageId, message, options) => {
    rerenders.push([messageId, message, structuredClone(options)]);
  };
  let value = current === undefined ? undefined : structuredClone(current);
  const replacements = [];
  const mvu = {
    getMvuData: () => value,
    replaceMvuData: async (next, options) => {
      replacements.push([structuredClone(next), structuredClone(options)]);
      value = structuredClone(next);
    },
  };
  const controller = new DesignAssistantController({
    context: () => context,
    mvu: () => mvu,
    now: () => Date.now(),
    notify() {},
  }, undefined, {
    currentChatId: () => context.chatId,
    createChatMessages: async () => {},
    generate: async () => '',
    generateNarrative: async () => '',
    stopGenerationById: () => false,
    emitInternalEvent: async () => {},
  }, { towerCoordinator: false });
  return { context, controller, replacements, rerenders, value: () => value };
}

async function waitFor(predicate, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 10));
  assert.equal(predicate(), true, 'timed out waiting for persisted MVU restoration');
}

const emptyFixture = createFixture(undefined);
emptyFixture.controller.activate();
await waitFor(() => emptyFixture.replacements.length === 1);
assert.deepEqual(emptyFixture.replacements[0][1], { type: 'message', message_id: 1 });
assert.equal(emptyFixture.value().stat_data.run.stateRevision, 100);
assert.deepEqual(emptyFixture.value().stat_data.reward, { card: [], artifact: [], item: [], limits: {} });
assert.equal(emptyFixture.value().stat_data.battle.cards.at(-1).name, '星体庇护');
assert.equal(emptyFixture.value().stat_data.battle.artifacts.at(-1).name, '奇点珍珠');
assert.equal(emptyFixture.rerenders.length, 1, 'a successful restore must rerender the visible floor once');
assert.deepEqual(emptyFixture.rerenders[0], [
  1,
  emptyFixture.context.chat[1],
  { rerenderMessage: true },
]);
assert.deepEqual(
  emptyFixture.context.eventSource.emissions.filter(([event]) => event === 'message_updated'),
  [['message_updated', 1]],
);
emptyFixture.controller.deactivate();

const initvarFixture = createFixture({
  stat_data: { game_mode: 'story', game_mode_lock: null, run: null, battle: { cards: [] } },
});
initvarFixture.controller.activate();
await waitFor(() => initvarFixture.replacements.length === 1);
assert.equal(initvarFixture.value().stat_data.game_mode, 'tower');
assert.equal(initvarFixture.rerenders.length, 1);
initvarFixture.controller.deactivate();

const newerFixture = createFixture(towerVariables(101));
newerFixture.controller.activate();
await new Promise(resolveWait => setTimeout(resolveWait, 50));
assert.equal(newerFixture.replacements.length, 0, 'newer MVU memory must not be overwritten');
assert.equal(newerFixture.rerenders.length, 1, 'an already-current tower MVU must refresh an earlier empty iframe');
await newerFixture.context.eventSource.emit('chatLoaded');
await new Promise(resolveWait => setTimeout(resolveWait, 50));
assert.equal(newerFixture.rerenders.length, 1, 'the same chat, floor and revision must rerender only once');
newerFixture.controller.deactivate();

const storyFixture = createFixture({
  stat_data: { game_mode: 'story', game_mode_lock: { schemaVersion: 1, mode: 'story' }, run: null },
});
storyFixture.controller.activate();
await new Promise(resolveWait => setTimeout(resolveWait, 50));
assert.equal(storyFixture.replacements.length, 0, 'story mode must remain isolated');
assert.equal(storyFixture.rerenders.length, 0, 'story mode must never be rerendered by tower recovery');
storyFixture.controller.deactivate();

const switchedFixture = createFixture(undefined);
switchedFixture.controller.activate();
switchedFixture.context.chatId = 'another-chat';
switchedFixture.context.chat = [{ mes: 'story', variables: [{ stat_data: { game_mode: 'story' } }] }];
await switchedFixture.context.eventSource.emit('chat_id_changed');
await new Promise(resolveWait => setTimeout(resolveWait, 50));
assert.equal(switchedFixture.replacements.length, 0, 'a stale recovery watcher must not write into a new chat');
assert.equal(switchedFixture.rerenders.length, 0, 'a stale recovery watcher must not rerender a new chat');
switchedFixture.controller.deactivate();

console.log('Persisted tower saves restore into MVU memory and rerender only the matching visible floor.');
