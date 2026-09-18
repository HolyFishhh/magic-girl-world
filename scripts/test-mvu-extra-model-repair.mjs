import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const originalMessage =
  '剧情正文\n\n<CHARACTER_INIT_PENDING>\n\n<CONTENT_PENDING>\n\n<BATTLE_PENDING>\n\n<UpdateVariable>old</UpdateVariable>\n\n<StatusPlaceHolderImpl/>\n\n<BATTLE_START>';
let message = originalMessage;
let selectedSwipe = 0;
let replaceCalls = 0;
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
const freshChatVariables = () => ({ preset: { mode: 'story' }, user_owned: { counter: 17 } });
let chatVariables = freshChatVariables();
let emitted = '';
let emitCalls = 0;
let globalExtraAnalysis = false;
let createdMessages = 0;
let lastRefresh = '';
let emitMode = 'new-block';
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
  getChatMessages: () => [{ message, swipe_id: selectedSwipe }],
  getVariables: options =>
    options?.type === 'global'
      ? { extra_analysis: globalExtraAnalysis }
      : options?.type === 'chat'
        ? structuredClone(chatVariables)
        : structuredClone(options?.type === 'message' && options?.message_id === 2 ? baselineVariables : variables),
  updateVariablesWith: updater => {
    variables = updater(structuredClone(variables));
  },
  insertOrAssignVariables: value => Object.assign(variables, value),
  replaceVariables: (value, options) => {
    replaceCalls += 1;
    if (options?.type === 'chat') chatVariables = structuredClone(value);
    else variables = structuredClone(value);
  },
  setChatMessages: async (updates, options) => {
    if (typeof updates[0]?.message === 'string') message = updates[0].message;
    lastRefresh = options?.refresh || '';
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
    emitCalls += 1;
    assert.match(message, /\[战斗内容修复\]/);
    assert.doesNotMatch(message, /<(?:CHARACTER_INIT_PENDING|CONTENT_PENDING|BATTLE_PENDING|BATTLE_START)>/);
    assert.match(message, /<UpdateVariable>old<\/UpdateVariable>/);
    if (emitMode === 'dropped-first' && emitCalls === 1) return;
    globalExtraAnalysis = true;
    // Tavern Helper's event emitter resolves before the async extra-model
    // handler finishes. The repair helper must wait for the later writeback.
    setTimeout(() => {
      if (emitMode === 'existing-ready') {
        variables = structuredClone(originalVariables);
        globalExtraAnalysis = false;
        return;
      }
      if (emitMode === 'bare-block') {
        message = message.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/, '').trimEnd();
        message += "\n\n<Analysis>Update.</Analysis>\n_.set('battle.core.emoji', '🪓');";
        globalExtraAnalysis = false;
        return;
      }
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
      globalExtraAnalysis = false;
    }, 20);
  },
  createChatMessages: () => {
    createdMessages += 1;
  },
});

const { retryCurrentMessageWithExtraModel } = require(resolve('src/runtime/mvuExtraModelRepair.ts'));
let validated = false;
let successEvidence = null;
await retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards(MISSING_VALUE)', {
  validateVariables: repaired => {
    validated = true;
    assert.equal(repaired.stat_data.battle.core.emoji, '🪓');
    assert.equal(repaired.stat_data.battle.player_lust_effect.name, '反面教材');
  },
  onEvidence: evidence => { successEvidence = evidence; },
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
assert.deepEqual(chatVariables, freshChatVariables(), 'message repair must preserve the separate chat dictionary');
assert.equal(successEvidence?.outcome, 'success');
assert.equal(successEvidence?.originalMessage, originalMessage);
assert.match(successEvidence?.response || '', /<UpdateVariable>fixed<\/UpdateVariable>/);

message = `${originalMessage}\n\n[MWG_REPAIR_REQUEST_BEGIN]\nstale\n[MWG_REPAIR_REQUEST_END]`;
variables = structuredClone(originalVariables);
chatVariables = freshChatVariables();
emitMode = 'dropped-first';
emitCalls = 0;
await retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards(DECK_TOO_SMALL)', {
  eventReadyGraceMs: 1,
  eventStartTimeoutMs: 30,
  resultTimeoutMs: 1_000,
  validateVariables: repaired => assert.equal(repaired.stat_data.battle.core.emoji, '🪓'),
});
assert.equal(emitCalls, 2, 'a chat-listener race may retry the dropped MVU event exactly once');
assert.doesNotMatch(message, /MWG_REPAIR_REQUEST|stale/, 'successful repair must remove stale request markers');

message = `${originalMessage}\n\n[MWG_REPAIR_REQUEST_BEGIN]\nstale\n[MWG_REPAIR_REQUEST_END]`;
variables = structuredClone(originalVariables);
chatVariables = freshChatVariables();
emitMode = 'bare-block';
emitCalls = 0;
await assert.rejects(
  retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards(DECK_TOO_SMALL)', {
    eventReadyGraceMs: 1,
    eventStartTimeoutMs: 30,
    resultTimeoutMs: 1_000,
    validateVariables: () => {
      throw new Error('still invalid');
    },
  }),
  error => error?.name === 'ExtraModelCandidateRejectedError'
    && /缺少完整的 <UpdateVariable>/.test(error.message)
    && typeof error.mvuRepairEvidence?.response === 'string'
    && error.mvuRepairEvidence.bareCommandObserved === true,
);
assert.equal(message, originalMessage, 'a rejected bare response must restore prose without the stale repair request');

message = originalMessage;
variables = structuredClone(baselineVariables);
chatVariables = freshChatVariables();
emitMode = 'existing-ready';
await retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards(DECK_TOO_SMALL)', {
  acceptCurrentVariablesWhenValid: true,
  resultTimeoutMs: 1_000,
  validateVariables: repaired => {
    assert.equal(repaired.stat_data.battle.core.emoji, '🪓');
  },
});
assert.equal(message, originalMessage, 'joining an in-flight valid write must keep the existing update block');
assert.deepEqual(variables, originalVariables, 'the valid in-flight variable snapshot must be retained');
assert.deepEqual(chatVariables, freshChatVariables(), 'joining a first-pass result must preserve chat variables');

message = originalMessage;
variables = structuredClone(originalVariables);
chatVariables = freshChatVariables();
emitMode = 'new-block';
await assert.rejects(
  retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards[0].effects(INVALID_VALUE)', {
    refreshOnFailure: 'none',
    validateVariables: () => {
      throw new Error('修复后仍非法');
    },
  }),
  /修复后仍非法/,
);
assert.equal(message, originalMessage, 'failed post-repair validation must restore the untouched floor');
assert.deepEqual(variables, originalVariables, 'failed validation must restore message variables');
assert.deepEqual(chatVariables, freshChatVariables(), 'failed validation must leave chat variables untouched');
assert.equal(lastRefresh, 'none', 'bounded follow-up repairs must keep the owning iframe alive after rollback');

// A tower writer can advance the same latest floor while a repair validation
// fails. The repair must not restore its old full root over that newer state.
message = originalMessage;
variables = structuredClone(originalVariables);
const writesBeforeConcurrentTower = replaceCalls;
const towerOwnedVariables = {
  stat_data: { run: { floor: 11, revision: 23, node: 'act-1-floor-12-col-1', phase: 'generating' } },
  user_owned: { towerRequest: 'tower_18_1_18p9ku7' },
};
await assert.rejects(retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=concurrent', {
  eventReadyGraceMs: 1,
  resultTimeoutMs: 1_000,
  eventEmitter: async () => {
    variables = structuredClone(baselineVariables);
    variables.stat_data.battle.repair_candidate = true;
    message += '\n<UpdateVariable>repair candidate</UpdateVariable>';
  },
  validateVariables: () => {
    variables = structuredClone(towerOwnedVariables);
    message = '塔任务正在写入当前楼层';
    throw new Error('修复候选无效');
  },
}), /修复候选无效/);
assert.equal(replaceCalls, writesBeforeConcurrentTower, 'failed repair must not overwrite a concurrent tower write');
assert.deepEqual(variables, towerOwnedVariables);
assert.equal(message, '塔任务正在写入当前楼层');

// A validation-successful candidate must also lose its commit right when the
// tower advances the same variable root immediately before the final write.
message = originalMessage;
variables = structuredClone(originalVariables);
const writesBeforeSuccessfulConcurrentTower = replaceCalls;
const towerCommittedVariables = {
  stat_data: { run: { floor: 11, revision: 23, node: 'act-1-floor-12-col-1', phase: 'ready' } },
  user_owned: { towerRequest: 'tower_18_1_18p9ku7', preserved: true },
};
await assert.rejects(retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=successful-concurrent', {
  eventReadyGraceMs: 1,
  resultTimeoutMs: 1_000,
  eventEmitter: async () => {
    variables = structuredClone(baselineVariables);
    variables.stat_data.battle.repair_candidate = true;
    message += '\n<UpdateVariable>repair candidate</UpdateVariable>';
  },
  validateVariables: () => {
    variables = structuredClone(towerCommittedVariables);
    message = '塔任务已写入当前楼层';
  },
}), /修复提交前变量已被后台任务更新/);
assert.equal(replaceCalls, writesBeforeSuccessfulConcurrentTower, 'successful repair candidate must not overwrite tower data');
assert.deepEqual(variables, towerCommittedVariables);
assert.equal(message, '塔任务已写入当前楼层');

// Tavern Helper 4.9.3 may omit its old top-level eventEmit helper. The repair
// transaction must use SillyTavern's official eventSource without weakening
// any of the message or variable checks.
const legacyEventEmit = globalThis.eventEmit;
delete globalThis.eventEmit;
globalThis.SillyTavern = {
  getContext: () => ({
    eventSource: { emit: legacyEventEmit },
  }),
};
message = originalMessage;
variables = structuredClone(originalVariables);
chatVariables = freshChatVariables();
emitMode = 'new-block';
emitCalls = 0;
await retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards(DECK_TOO_SMALL)', {
  resultTimeoutMs: 1_000,
  validateVariables: repaired => assert.equal(repaired.stat_data.battle.core.emoji, '🪓'),
});
assert.equal(emitCalls, 1, 'official SillyTavern eventSource must replace the missing Tavern Helper eventEmit');

delete globalThis.SillyTavern;
message = originalMessage;
await assert.rejects(
  retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards(DECK_TOO_SMALL)'),
  /SillyTavern 事件接口缺失: eventSource\.emit/,
  'only the absence of both event surfaces may stop an MVU retry',
);
globalThis.eventEmit = legacyEventEmit;

// The legacy fallback also pins the selected reply, even though message_id
// and chat remain identical. Its own commit/rollback must not touch the new one.
message = originalMessage;
variables = structuredClone(originalVariables);
selectedSwipe = 0;
const writesBeforeSwipe = replaceCalls;
const newReply = { stat_data: { owner: 'new selected reply' }, user_owned: { keep: true } };
await assert.rejects(retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=scope', {
  eventReadyGraceMs: 1, resultTimeoutMs: 1_000,
  eventEmitter: async () => {
    selectedSwipe = 1;
    message = 'new selected prose';
    variables = structuredClone(newReply);
  },
}), /聊天已切换|回复已变化/);
assert.equal(replaceCalls, writesBeforeSwipe);
assert.deepEqual(variables, newReply);
assert.equal(message, 'new selected prose');

console.log('MVU repair isolates anchors, keeps one validated block, and rolls back invalid retries.');
