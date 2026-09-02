import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const clone = value => structuredClone(value);
let helperUpdateCalls = 0;
let helperUpdateOptions = null;
let authoritative = {
  stat_data: {
    game_mode: 'tower',
    run: { act: 3, floor: 15, stateRevision: 99 },
  },
};
let latestAuthoritative = {
  stat_data: {
    game_mode: 'story',
    reward: { card: [{ id: 'latest-reward' }] },
  },
};

Object.assign(globalThis, {
  getVariables() {
    return { stat_data: { run: { act: 1, floor: 10, stateRevision: 21 } } };
  },
  replaceVariables() {},
  updateVariablesWith(updater, options) {
    helperUpdateCalls += 1;
    helperUpdateOptions = options;
    return updater({ stat_data: { run: { act: 1, floor: 10, stateRevision: 21 } } });
  },
  insertOrAssignVariables() {},
  getCurrentMessageId() {
    return 4;
  },
  getLastMessageId() {
    return 4;
  },
  MagicGirlWorld: {
    spec: 'mwg.tavern-runtime/v1',
    getMessageVariables(messageId) {
      assert.equal(messageId, 4);
      return clone(authoritative);
    },
    async updateMessageVariablesWith(messageId, updater) {
      if (messageId === 'latest') {
        latestAuthoritative = await updater(clone(latestAuthoritative));
        return clone(latestAuthoritative);
      }
      assert.equal(messageId, 4);
      authoritative = await updater(clone(authoritative));
      return clone(authoritative);
    },
    async replaceMessageVariables(messageId, variables) {
      assert.equal(messageId, 4);
      authoritative = clone(variables);
      return clone(authoritative);
    },
  },
});

const variables = require(resolve('src/runtime/messageVariables.ts'));
assert.equal(variables.getCurrentMessageVariables().stat_data.run.act, 3);

await variables.updateCurrentMessageVariablesWith(current => {
  current.__magic_girl_world = { battle_session: { nodeId: 'act-3-boss' } };
  return current;
});
assert.equal(authoritative.stat_data.run.act, 3, 'a session patch must keep the authoritative third-act state');
assert.equal(authoritative.stat_data.run.stateRevision, 99);
assert.equal(authoritative.__magic_girl_world.battle_session.nodeId, 'act-3-boss');
assert.equal(helperUpdateCalls, 0, 'the stale Tavern Helper cache must not own persistent runtime writes');

await variables.replaceCurrentMessageVariables({
  stat_data: { game_mode: 'tower', run: { act: 3, floor: 16, stateRevision: 100 } },
});
assert.equal(authoritative.stat_data.run.floor, 16);

await variables.updateLatestMessageVariablesWith(current => {
  current.stat_data.reward.card = [];
  return current;
});
assert.deepEqual(latestAuthoritative.stat_data.reward.card, []);
assert.equal(authoritative.stat_data.run.floor, 16, 'latest-message transport must not mutate the iframe owner');

delete globalThis.MagicGirlWorld;
await variables.updateCurrentMessageVariablesWith(current => current);
assert.equal(helperUpdateCalls, 1, 'older cards without the shared host retain the established fallback');

await variables.updateLatestMessageVariablesWith(current => current);
assert.equal(helperUpdateCalls, 2);
assert.deepEqual(
  helperUpdateOptions,
  { type: 'message', message_id: 'latest' },
  'older Tavern Helper installations still receive an explicit latest-message scope',
);

console.log('Message-variable reads and writes prefer the authoritative MVU bridge over a stale helper cache.');
