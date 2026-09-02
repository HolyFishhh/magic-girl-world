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
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter(value => value !== listener));
  }

  async emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) await listener(...args);
  }
}

const events = new FakeEvents();
const context = {
  chatId: 'single-floor-start-chat',
  chat: [{ is_user: false, is_system: false, mes: '[爬塔模式开场]' }],
  characterId: 0,
  groupId: null,
  characters: [{
    data: {
      extensions: {
        magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE },
      },
    },
  }],
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
    MESSAGE_UPDATED: 'message_updated',
  },
  updateMessageBlock(messageId, message) {
    assert.equal(messageId, 0);
    this.chat[messageId] = message;
  },
  async saveChat() {
    saveChatCalls += 1;
  },
};

let variables = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    status: {},
    battle: {},
  },
};
const modelCalls = [];
const mvuWrites = [];
const chatVariableWrites = [];
let createChatMessageCalls = 0;
let saveChatCalls = 0;

const initialContent = {
  status: {
    time: '旅途第一日',
    location: '无名高塔入口',
    profession: { name: '星火旅者', ability: '在攻守转换时收集星火。' },
  },
  battle: {
    core: { emoji: '✨', hp: 72, max_hp: 72, lust: 0, max_lust: 100 },
    cards: [
      {
        id: 'star_strike', name: '星火斩', emoji: '🌠', type: 'Attack', rarity: 'Common',
        cost: 1, quantity: 5, description: '以星火切开敌阵。', effects: { damage: 7 },
      },
      {
        id: 'star_guard', name: '星幕', emoji: '🌌', type: 'Skill', rarity: 'Common',
        cost: 1, quantity: 5, description: '展开一层流动星幕。', effects: { block: 6 },
      },
    ],
    artifacts: [{
      id: 'star_compass', name: '星路罗盘', rarity: 'Common',
      description: '在旅途开始时标出一条短暂的安全路径。',
      trigger: { on: 'battle_start', effects: { block: 4 } },
    }],
    items: [{
      id: 'starlight_tonic', name: '星露药剂', count: 1,
      description: '饮下后恢复少量生命。', effects: { heal: 8 },
    }],
    statuses: [],
    player_abilities: [],
    player_status_effects: [],
    player_lust_effect: {
      name: '星潮反击', description: '欲望满溢时引爆积蓄的星火。', effects: { damage: 8 },
    },
    level: 1,
    exp: 0,
  },
};

// Even a complete-looking stale/template deck must be replaced at the only
// legitimate initialization boundary: the first assistant greeting.
variables.stat_data.status = structuredClone(initialContent.status);
variables.stat_data.battle = structuredClone(initialContent.battle);
variables.stat_data.battle.cards = variables.stat_data.battle.cards.map(card => ({
  ...card,
  id: `stale_${card.id}`,
  name: `旧模板${card.name}`,
}));

const mvu = {
  getMvuData: options => {
    assert.deepEqual(options, { type: 'message', message_id: 0 });
    return structuredClone(variables);
  },
  replaceMvuData: async (next, options) => {
    assert.deepEqual(options, { type: 'message', message_id: 0 });
    variables = structuredClone(next);
    mvuWrites.push(structuredClone(next));
  },
  isDuringExtraAnalysis: () => false,
};

const previousTavernHelper = globalThis.TavernHelper;
globalThis.TavernHelper = {
  async replaceVariables(next, options) {
    assert.deepEqual(options, { type: 'chat' });
    chatVariableWrites.push(structuredClone(next));
  },
};

const controller = new DesignAssistantController({
  context: () => context,
  mvu: () => mvu,
  now: () => 202609020001,
  notify() {},
}, undefined, {
  currentChatId: () => context.chatId,
  createChatMessages: async () => { createChatMessageCalls += 1; },
  generate: async config => {
    modelCalls.push(['structured', structuredClone(config)]);
    const firstAttempt = modelCalls.filter(([kind]) => kind === 'structured').length === 1;
    const playerBattle = structuredClone(initialContent.battle);
    if (firstAttempt) {
      playerBattle.cards[0].effects = [{ damage: 7 }, { discard: 1, to: 'opponent' }];
      playerBattle.cards[1].effects = [{ block: 6, amount: 6 }];
      playerBattle.statuses = [{
        id: 'bad_tick', name: '错误状态', emoji: '⚠️', type: 'buff',
        triggers: { tick: { effects: { block: 2 }, target: 'self' } },
      }];
    }
    return JSON.stringify({
      narrative: '雾中的高塔吞没了归路，守门人告诉旅者：只有连续越过三幕试炼，出口才会重新出现。',
      player: {
        status: initialContent.status,
        ...playerBattle,
      },
      opening: {
        title: '守门人的星火馈赠',
        narrative: '守门人摊开两枚仍在发光的星屑，示意旅者选一枚带走。',
        choices: [
          { id: 'warm_star', label: '温暖星屑', outcome: { hp: 8 } },
          { id: 'sharp_star', label: '锐利星屑', outcome: { gold: 40 } },
        ],
      },
    });
  },
  generateNarrative: async config => {
    modelCalls.push(['unexpected-narrative', structuredClone(config)]);
    throw new Error('single-floor start must not issue a separate narrative request');
  },
  stopGenerationById: () => true,
  emitInternalEvent: async () => {},
}, { towerCoordinator: false });

try {
  controller.activate();
  const floorCountBefore = context.chat.length;
  const result = await controller.startTowerSingleFloor({
    spec: 'mwg.tower-single-floor-start/v1',
    sourceMessageId: 0,
    prompt: '[角色创建]\n{"mode":"tower","world":"星海高塔"}\n[爬塔模式]\n[开始游戏]',
    config: { world: '星海高塔', card: '星火攻防' },
  });

  assert.equal(result.spec, 'mwg.tower-single-floor-start-result/v1');
  assert.equal(result.floorCountBefore, 1);
  assert.equal(result.floorCountAfter, 1);
  assert.equal(context.chat.length, floorCountBefore, 'silent initialization must not append a Tavern floor');
  assert.equal(createChatMessageCalls, 0, 'single-floor start must never use createChatMessages');
  assert.equal(modelCalls.filter(([kind]) => kind === 'unexpected-narrative').length, 0);
  assert.equal(modelCalls.filter(([kind]) => kind === 'structured').length, 2);
  const structuredConfig = modelCalls.find(([kind]) => kind === 'structured')[1];
  const repairedConfig = modelCalls.filter(([kind]) => kind === 'structured')[1][1];
  assert.equal(structuredConfig.should_silence, true);
  assert.equal(structuredConfig.max_chat_history, 0);
  assert.equal(structuredConfig.json_schema.name, 'mwg_tower_single_floor_initial_content');
  assert.deepEqual(structuredConfig.json_schema.value.required, ['narrative', 'player', 'opening']);
  assert.equal('battle' in structuredConfig.json_schema.value.properties, false);
  assert.match(structuredConfig.user_input, /CURRENT_START_STATE=/);
  assert.match(structuredConfig.user_input, /\[浅层 effects 精确语法\]/);
  assert.match(structuredConfig.user_input, /不存在通用 amount\/value\/target\/operation\/source 字段/);
  assert.match(structuredConfig.user_input, /\{apply_status:"状态ID",stacks\?:层数,to\?:目标\}/);
  assert.match(structuredConfig.user_input, /triggers 只含 apply\/stack\/tick\/remove\/hold\/threshold_execute/);
  assert.doesNotMatch(structuredConfig.user_input, /CURRENT_STAT_DATA=/);
  assert.doesNotMatch(structuredConfig.user_input, /stale_star_strike|旧模板星火斩/);
  assert.match(repairedConfig.user_input, /上一份结果未通过程序校验/);
  assert.match(repairedConfig.user_input, /battle\.statuses\[0\]\.triggers\.tick：状态定义不合法（具体原因：/);
  assert.match(repairedConfig.user_input, /battle\.cards\[0\]\.effects\[1\]\.to：/);
  assert.match(repairedConfig.user_input, /battle\.cards\[1\]\.effects\[0\]\.amount：/);
  assert.equal(mvuWrites.length, 1);
  assert.equal(chatVariableWrites.length, 1);
  assert.equal(variables.stat_data.battle.cards.reduce((sum, card) => sum + card.quantity, 0), 10);
  assert.equal(variables.stat_data.battle.cards.some(card => card.id.startsWith('stale_')), false);
  assert.ok(Number(variables.stat_data.run.schemaVersion) >= 1);
  assert.equal(variables.stat_data.run.opening.phase, 'ready');
  assert.equal(variables.stat_data.run.opening.content.title, '守门人的星火馈赠');
  assert.match(context.chat[0].mes, /只有连续越过三幕试炼/);
  assert.match(context.chat[0].mes, /<StatusPlaceHolderImpl\/>/);
  assert.ok(saveChatCalls >= 1, 'the rewritten greeting and MVU snapshot must be saved');
} finally {
  controller.deactivate();
  if (previousTavernHelper === undefined) delete globalThis.TavernHelper;
  else globalThis.TavernHelper = previousTavernHelper;
}

console.log('Tower single-floor start repairs invalid DSL in place, persists the deck/gift/map, and rewrites only the greeting floor.');
