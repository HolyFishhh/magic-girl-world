import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

let message = '剧情正文\n\n<UpdateVariable>old</UpdateVariable>\n\n<BATTLE_START>';
let variables = { stat_data: { battle: { cards: [] } }, schema: {} };
let emitted = '';
let createdMessages = 0;

Object.assign(globalThis, {
  getCurrentMessageId: () => 3,
  getLastMessageId: () => 3,
  getChatMessages: () => [{ message }],
  getVariables: () => structuredClone(variables),
  updateVariablesWith: updater => {
    variables = updater(structuredClone(variables));
  },
  insertOrAssignVariables: value => Object.assign(variables, value),
  replaceVariables: value => {
    variables = structuredClone(value);
  },
  setChatMessages: async updates => {
    if (typeof updates[0]?.message === 'string') message = updates[0].message;
  },
  getButtonEvent: name => `button:${name}`,
  eventEmit: async event => {
    emitted = event;
    assert.match(message, /\[战斗内容修复\]/);
    message = message.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/, '').trimEnd();
    variables.stat_data.battle.cards = [{ id: 'fixed' }];
    message += '\n\n<UpdateVariable>fixed</UpdateVariable>';
  },
  createChatMessages: () => {
    createdMessages += 1;
  },
});

const { retryCurrentMessageWithExtraModel } = require(resolve('src/runtime/mvuExtraModelRepair.ts'));
await retryCurrentMessageWithExtraModel('[战斗内容修复]\n问题=battle.cards(MISSING_VALUE)');
assert.equal(emitted, 'button:重试额外模型解析');
assert.equal(createdMessages, 0, 'in-place MVU repair must not create a user or assistant floor');
assert.doesNotMatch(message, /MWG_REPAIR_REQUEST|\[战斗内容修复\]/);
assert.match(message, /<UpdateVariable>fixed<\/UpdateVariable>/);
assert.deepEqual(variables.stat_data.battle.cards, [{ id: 'fixed' }]);

console.log('MVU repair retries the extra model on the current assistant floor without creating chat messages.');
