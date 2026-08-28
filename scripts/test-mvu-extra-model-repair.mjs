import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const originalMessage =
  '剧情正文\n\n<CHARACTER_INIT_PENDING>\n\n<CONTENT_PENDING>\n\n<BATTLE_PENDING>\n\n<UpdateVariable>old</UpdateVariable>\n\n<StatusPlaceHolderImpl/>\n\n<BATTLE_START>';
let message = originalMessage;
const baselineVariables = {
  stat_data: {
    status: { time: '00年04月07日 14:00', location: '王都外环' },
    battle: { core: {}, cards: [], enemy: {} },
  },
  display_data: {},
  delta_data: {},
  schema: {},
};
const originalVariables = {
  stat_data: {
    status: { time: '00年04月07日 14:20', location: '王都外环·试炼斗技场' },
    battle: {
      core: { emoji: '🪓', hp: 80, max_hp: 80, lust: 0, max_lust: 100, card_removal_count: 1 },
      cards: [{ id: 'strike_axe', effects: { damage: 6 } }],
      artifacts: [{ id: 'executioner_axe' }],
      player_lust_effect: { apply_status: 'mark_of_execution', stacks: 5, to: 'opponent' },
      enemy: { name: '深渊巨魔', lust_effect: { damage: 8 } },
    },
  },
  display_data: {},
  delta_data: {},
  schema: {},
};
let variables = structuredClone(originalVariables);
let chatVariables = structuredClone(originalVariables);
let emitted = '';
let createdMessages = 0;
const mvuScriptId = 'mvu-script-id';

function getStringHash(value, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

Object.assign(globalThis, {
  getCurrentMessageId: () => 3,
  getLastMessageId: () => 3,
  getChatMessages: () => [{ message }],
  getVariables: options =>
    structuredClone(options?.type === 'message' && options?.message_id === 2 ? baselineVariables : variables),
  updateVariablesWith: updater => {
    variables = updater(structuredClone(variables));
  },
  insertOrAssignVariables: value => Object.assign(variables, value),
  replaceVariables: (value, options) => {
    if (options?.type === 'chat') chatVariables = structuredClone(value);
    else variables = structuredClone(value);
  },
  setChatMessages: async updates => {
    if (typeof updates[0]?.message === 'string') message = updates[0].message;
  },
  getAllEnabledScriptButtons: () => ({
    character_script: [{ button_id: 'button:character:请求修复', button_name: '请求修复' }],
    [mvuScriptId]: [{ button_id: 'button:mvu:重新处理变量', button_name: '重新处理变量' }],
  }),
  getScriptTrees: ({ type }) =>
    type === 'character'
      ? [
          {
            type: 'script',
            id: mvuScriptId,
            enabled: true,
            button: {
              enabled: true,
              buttons: [
                { name: '重新处理变量', visible: true },
                { name: '重试额外模型解析', visible: false },
              ],
            },
          },
        ]
      : [],
  eventEmit: async event => {
    emitted = event;
    assert.match(message, /\[战斗内容修复\]/);
    assert.doesNotMatch(message, /<(?:CHARACTER_INIT_PENDING|CONTENT_PENDING|BATTLE_PENDING|BATTLE_START)>/);
    assert.match(message, /<UpdateVariable>old<\/UpdateVariable>/);
    message = message
      .replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/, '')
      .replace(/<BATTLE_START>/g, '')
      .trimEnd();
    // MVU retry deletes this floor's variables, rebases from the preceding floor,
    // then applies only the repair commands returned by the second model.
    variables = structuredClone(baselineVariables);
    variables.stat_data.status.time = '00年04月07日 14:20';
    variables.stat_data.status.location = '王都外环·试炼斗技场';
    variables.stat_data.battle.player_lust_effect = {
      name: '反面教材',
      emoji: '😤',
      effects: { damage: 8, draw: 1 },
    };
    variables.stat_data.battle.enemy.lust_effect = {
      name: '灼热冲撞',
      emoji: '🔥',
      effects: { damage: 8, lust: 5 },
    };
    message += '\n\n<UpdateVariable>fixed</UpdateVariable>\n\n<StatusPlaceHolderImpl/>';
  },
  createChatMessages: () => {
    createdMessages += 1;
  },
});

const { retryCurrentMessageWithExtraModel } = require(resolve('src/runtime/mvuExtraModelRepair.ts'));
let validated = false;
await retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards(MISSING_VALUE)', {
  validateVariables: repaired => {
    validated = true;
    assert.equal(repaired.stat_data.battle.core.emoji, '🪓');
    assert.equal(repaired.stat_data.battle.player_lust_effect.name, '反面教材');
  },
});
assert.equal(emitted, `${mvuScriptId}_${getStringHash('重试额外模型解析')}`);
assert.equal(validated, true, 'the complete merged snapshot must be validated before commit');
assert.equal(createdMessages, 0, 'in-place MVU repair must not create a user or assistant floor');
assert.doesNotMatch(message, /MWG_REPAIR_REQUEST|\[战斗内容修复\]/);
assert.doesNotMatch(message, /<UpdateVariable>old<\/UpdateVariable>/);
assert.match(message, /<UpdateVariable>fixed<\/UpdateVariable>/);
assert.equal((message.match(/<UpdateVariable>/g) || []).length, 1, 'only the repaired update block may remain');
assert.match(message, /<CHARACTER_INIT_PENDING>/);
assert.match(message, /<CONTENT_PENDING>/);
assert.match(message, /<BATTLE_PENDING>/);
assert.match(message, /<StatusPlaceHolderImpl\/>\s*<BATTLE_START>$/);
assert.equal(variables.stat_data.battle.core.emoji, '🪓');
assert.deepEqual(variables.stat_data.battle.cards, [{ id: 'strike_axe', effects: { damage: 6 } }]);
assert.deepEqual(variables.stat_data.battle.artifacts, [{ id: 'executioner_axe' }]);
assert.deepEqual(variables.stat_data.battle.player_lust_effect, {
  name: '反面教材',
  emoji: '😤',
  effects: { damage: 8, draw: 1 },
});
assert.deepEqual(variables.stat_data.battle.enemy.lust_effect, {
  name: '灼热冲撞',
  emoji: '🔥',
  effects: { damage: 8, lust: 5 },
});
assert.deepEqual(chatVariables, variables, 'latest chat variables must retain the repaired complete floor');

message = originalMessage;
variables = structuredClone(originalVariables);
chatVariables = structuredClone(originalVariables);
await assert.rejects(
  retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards[0].effects(INVALID_VALUE)', {
    validateVariables: () => {
      throw new Error('修复后仍非法');
    },
  }),
  /修复后仍非法/,
);
assert.equal(message, originalMessage, 'failed post-repair validation must restore the untouched floor');
assert.deepEqual(variables, originalVariables, 'failed validation must restore message variables');
assert.deepEqual(chatVariables, originalVariables, 'failed validation must restore chat variables');

console.log('MVU repair isolates anchors, keeps one validated block, and rolls back invalid retries.');
