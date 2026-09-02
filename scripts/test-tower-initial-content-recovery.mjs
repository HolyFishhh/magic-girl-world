import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { DesignAssistantController } = require(resolve('src/sillytavern-extension/controller.ts'));
const {
  DESIGN_ASSISTANT_CARD_SCOPE,
  DESIGN_ASSISTANT_EXTENSION_ID,
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
} = require(resolve('src/sillytavern-extension/types.ts'));

class FakeEvents {
  listeners = new Map();
  on(event, listener) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
  }
  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter(value => value !== listener));
  }
  async emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) await listener(...args);
  }
}

const validBattle = {
  core: { emoji: '🧙', hp: 100, max_hp: 100, lust: 12, max_lust: 100, card_removal_count: 1 },
  level: 1,
  exp: 0,
  cards: [
    { id: 'summon_bite', name: '契兽撕咬', emoji: '🐺', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
    { id: 'summon_guard', name: '契约守护', emoji: '🛡️', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
  ],
  statuses: [],
  artifacts: [{ id: 'contract_mark', name: '契约印记', rarity: 'Common', trigger: { on: 'battle_start', effects: { block: 3 } } }],
  items: [{ id: 'small_potion', name: '小型药剂', count: 1, effects: { heal: 8 } }],
  player_abilities: [],
  player_status_effects: [],
  player_lust_effect: { name: '共鸣追击', effects: { damage: 8 } },
  enemy: null,
  enemies: [],
};

let variables = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    run: null,
    battle: {
      ...structuredClone(validBattle),
      cards: [
        {
          id: 'summon_bite', name: '契兽撕咬', emoji: '🐺', type: '攻击', rarity: '普通', cost: 1, quantity: 5,
          effects: [{ source: 'card', operation: 'damage', target: 'enemy', value: 7, trigger: 'on_play' }],
        },
        validBattle.cards[1],
      ],
    },
  },
};
const events = new FakeEvents();
const context = {
  chatId: 'tower-initial-recovery',
  chat: [
    { is_user: false, is_system: false, mes: '[开始游戏]' },
    { is_user: true, is_system: false, mes: '完全自由输入的角色开场，不含任何初始化关键词。' },
    { is_user: false, is_system: false, mes: '剧情正文\n<UpdateVariable>不完整变量</UpdateVariable>', variables: [variables] },
  ],
  characterId: 0,
  groupId: null,
  characters: [{ data: { extensions: { magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE } } } }],
  extensionSettings: {
    [DESIGN_ASSISTANT_EXTENSION_ID]: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS, enabled: false },
  },
  saveSettingsDebounced() {},
  chatMetadata: {},
  saveMetadataDebounced() {},
  eventSource: events,
  eventTypes: {
    GENERATE_AFTER_DATA: 'generate_after_data',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_CHANGED: 'chat_id_changed',
    CHAT_LOADED: 'chatLoaded',
    GENERATION_ENDED: 'generation_ended',
  },
};

const previousHelper = globalThis.TavernHelper;
globalThis.TavernHelper = {
  getLastMessageId: () => 2,
  getChatMessages: () => [{ message: context.chat[2].mes }],
  setChatMessages: async updates => {
    context.chat[2].mes = updates[0].message;
  },
  getVariables: () => structuredClone(variables),
  replaceVariables: async next => {
    variables = structuredClone(next);
    context.chat[2].variables = structuredClone(next);
  },
  getAllEnabledScriptButtons: () => [],
  getScriptTrees: () => [],
};

const mvu = {
  getMvuData: () => structuredClone(variables),
  replaceMvuData: async next => {
    variables = structuredClone(next);
    context.chat[2].variables = structuredClone(next);
  },
  isDuringExtraAnalysis: () => false,
};
const host = {
  context: () => context,
  mvu: () => mvu,
  now: () => Date.now(),
  notify() {},
};
const generationCalls = [];
const controller = new DesignAssistantController(host, undefined, {
  currentChatId: () => context.chatId,
  createChatMessages: async () => {},
  generate: async config => {
    generationCalls.push(config);
    return { battle: structuredClone(validBattle) };
  },
  generateNarrative: async () => '',
  stopGenerationById: () => true,
  emitInternalEvent: async () => {},
}, { towerCoordinator: false });

try {
  controller.activate();
  const deadline = Date.now() + 5_000;
  while (!variables.stat_data.run && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(generationCalls.length, 0, 'the extension must not start a separate initialization request');
  assert.equal(variables.stat_data.battle.cards.length, 2);
  assert.equal(variables.stat_data.battle.cards[0].type, 'Attack');
  assert.equal(variables.stat_data.battle.cards[0].rarity, 'Common');
  assert.deepEqual(variables.stat_data.battle.cards[0].effects, [{ damage: 7, to: 'opponent' }]);
  assert.equal(variables.stat_data.run?.schemaVersion, 3);
  assert.equal(variables.stat_data.run?.routeMode, 'map');
  assert.doesNotMatch(context.chat[2].mes, /_.set\('battle'/);
} finally {
  controller.deactivate();
  if (previousHelper === undefined) delete globalThis.TavernHelper;
  else globalThis.TavernHelper = previousHelper;
}

console.log('Persistent extension canonicalizes the first MVU result and creates the map without a second initialization request.');
