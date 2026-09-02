import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const {
  assessPersistedTowerMvuRestore,
  readPersistedMessageVariableSnapshot,
  readLatestPersistedMessageVariableSnapshot,
  readLatestPersistedMessageVariables,
  touchCurrentTowerChatActivity,
  touchTowerChatActivity,
} = require(resolve('src/sillytavern-extension/towerChatActivity.ts'));

const restoredVariables = {
  stat_data: {
    game_mode: 'tower',
    run: { phase: 'won', stateRevision: 100 },
  },
};
const restoredContext = {
  chat: [
    { is_user: false },
    { is_user: true, variables: { 0: { stat_data: { game_mode: 'story' } } } },
    {
      is_user: false,
      swipe_id: 1,
      variables: {
        0: { stat_data: { game_mode: 'story' } },
        1: restoredVariables,
      },
    },
  ],
};
assert.deepEqual(
  readLatestPersistedMessageVariables(restoredContext),
  restoredVariables,
  'restored chats must select the active swipe variable snapshot',
);
assert.deepEqual(
  readLatestPersistedMessageVariableSnapshot(restoredContext),
  { variables: restoredVariables, messageId: 2 },
  'recovery must bind persisted variables to the message that supplied them',
);
assert.deepEqual(
  readPersistedMessageVariableSnapshot(restoredContext, 2),
  { variables: restoredVariables, messageId: 2 },
  'exact-floor recovery must only expose the active swipe on that exact assistant floor',
);
assert.equal(
  readPersistedMessageVariableSnapshot(restoredContext, 0),
  null,
  'an exact-floor read must not inherit variables from an earlier assistant floor',
);
assert.deepEqual(
  readLatestPersistedMessageVariables({
    chat: [
      { variables: [{ stat_data: { game_mode: 'tower', run: { stateRevision: 7 } } }] },
      { is_user: true },
    ],
  }),
  { stat_data: { game_mode: 'tower', run: { stateRevision: 7 } } },
  'recovery must scan backward when the latest user floor has no variables',
);
assert.equal(readLatestPersistedMessageVariables({ chat: [] }), null);

const { createRunState } = require(resolve('src/game-core/runState.ts'));
const persistedTower = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    run: { ...createRunState({ seed: 20260831 }), stateRevision: 12 },
  },
};
assert.equal(
  assessPersistedTowerMvuRestore(persistedTower, null).action,
  'restore',
  'missing MVU memory must be restored from a valid persisted tower snapshot',
);
assert.equal(
  assessPersistedTowerMvuRestore(persistedTower, {
    stat_data: { game_mode: 'story', game_mode_lock: null, run: null, battle: { cards: [] } },
  }).action,
  'restore',
  'the unlocked initvar story object is only a loading placeholder',
);
assert.equal(
  assessPersistedTowerMvuRestore(persistedTower, {
    stat_data: { game_mode: 'story', game_mode_lock: { schemaVersion: 1, mode: 'story' }, run: null },
  }).reason,
  'current-story-locked',
  'an explicitly locked story chat must never be changed into tower mode',
);
assert.equal(
  assessPersistedTowerMvuRestore(persistedTower, {
    stat_data: {
      game_mode: 'tower',
      game_mode_lock: { schemaVersion: 1, mode: 'tower' },
      run: { ...createRunState({ seed: 20260831 }), stateRevision: 13 },
    },
  }).reason,
  'current-tower-current',
  'an older persisted revision must never overwrite newer MVU memory',
);
assert.equal(
  assessPersistedTowerMvuRestore({
    stat_data: { game_mode: 'tower', game_mode_lock: { schemaVersion: 1, mode: 'tower' }, run: {} },
  }, null).reason,
  'persisted-run-invalid',
  'corrupt message variables must not enter MVU memory',
);

let saves = 0;
const context = {
  chat: [{
    mes: '同一楼层继续游玩',
    send_date: '2026-08-30T00:00:00.000Z',
    swipe_id: 0,
    swipe_info: [{ send_date: '2026-08-30T00:00:00.000Z' }],
  }],
  async saveChat() { saves += 1; },
};
const result = await touchTowerChatActivity(context, Date.UTC(2026, 7, 31, 16, 30, 0));
assert.equal(result.touched, true);
assert.equal(result.messageId, 0);
assert.equal(context.chat.length, 1, 'touching activity must not create a Tavern floor');
assert.equal(context.chat[0].mes, '同一楼层继续游玩');
assert.equal(context.chat[0].send_date, '2026-08-31T16:30:00.000Z');
assert.equal(context.chat[0].swipe_info[0].send_date, context.chat[0].send_date);
assert.equal(saves, 1, 'the official SillyTavern save path must persist the new recent-chat timestamp');

const unavailable = await touchTowerChatActivity({ chat: [] }, Date.now());
assert.deepEqual(unavailable, { touched: false, messageId: null, timestamp: null });

let currentContext = {
  chatId: 'old-chat',
  chat: [{ send_date: '2026-08-30T00:00:00.000Z' }],
  async saveChat() { throw new Error('stale chat must never be saved'); },
};
const staleContext = currentContext;
currentContext = {
  chatId: 'tower-chat',
  chat: [{
    mes: '当前爬塔终局',
    send_date: '2026-08-30T01:00:00.000Z',
    swipe_id: 0,
    swipe_info: [{ send_date: '2026-08-30T01:00:00.000Z' }],
  }],
  async saveChat() { saves += 1; },
};
const currentResult = await touchCurrentTowerChatActivity(
  () => currentContext,
  'tower-chat',
  Date.UTC(2026, 7, 31, 17, 0, 0),
);
assert.equal(currentResult.touched, true);
assert.equal(staleContext.chat[0].send_date, '2026-08-30T00:00:00.000Z', 'captured stale chat must remain untouched');
assert.equal(currentContext.chat[0].send_date, '2026-08-31T17:00:00.000Z', 'the live chat must receive the activity timestamp');

const wrongChatResult = await touchCurrentTowerChatActivity(
  () => currentContext,
  'another-chat',
  Date.now(),
);
assert.deepEqual(wrongChatResult, { touched: false, messageId: null, timestamp: null });

console.log('Single-floor tower progress refreshes the existing chat timestamp without creating messages.');
