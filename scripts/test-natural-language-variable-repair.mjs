import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { requestNaturalLanguageVariableRepair } = require(resolve('src/runtime/naturalLanguageCardRepair.ts'));
const { PersistentMvuRepairHost } = require(resolve('src/sillytavern-extension/persistentMvuRepairHost.ts'));

const original = {
  stat_data: {
    status: { time: '第一天', location: '旧城区' },
    battle: { core: {}, cards: [], enemy: {} },
    run: { phase: 'in_node', currentNodeId: 'n1' },
  },
  user_owned: { untouched: true },
};
const backgroundGeneration = { id: 'tower-task:running', phase: 'applying', completedNodes: 1 };
let variables = structuredClone(original);
let message = '当前剧情\n<UpdateVariable>existing</UpdateVariable>';
let stopCalls = 0;

Object.assign(globalThis, {
  getCurrentMessageId: () => 1,
  getLastMessageId: () => 1,
  getChatMessages: () => [{ message, swipe_id: 0 }],
  getVariables: options => structuredClone(options?.type === 'message' && options.message_id === 0 ? original : variables),
  updateVariablesWith: updater => { variables = updater(structuredClone(variables)); },
  insertOrAssignVariables: value => { variables = { ...variables, ...structuredClone(value) }; },
  replaceVariables: value => { variables = structuredClone(value); },
  setChatMessages: async updates => { if (typeof updates[0]?.message === 'string') message = updates[0].message; },
  getAllEnabledScriptButtons: () => ({ mvu: [{ button_id: 'mvu-extra', button_name: '重试额外模型解析' }] }),
  getScriptTrees: () => [],
  stopGenerationById: () => { stopCalls += 1; },
  eventEmit: async () => {
    // Simulate the failing MVU build: it applies a command patch but does not
    // append a second UpdateVariable wrapper to the visible assistant reply.
    variables = structuredClone(original);
    variables.stat_data.status.time = '第二天';
  },
});

await assert.rejects(
  requestNaturalLanguageVariableRepair('把时间改为第二天'),
  /需要持久化结构化修复端点/,
);
assert.equal(variables.stat_data.status.time, '第一天');
assert.deepEqual(variables.stat_data.battle, original.stat_data.battle);
assert.deepEqual(variables.stat_data.run, original.stat_data.run);
assert.deepEqual(variables.user_owned, original.user_owned);
assert.deepEqual(backgroundGeneration, { id: 'tower-task:running', phase: 'applying', completedNodes: 1 });
assert.equal(stopCalls, 0, 'an unavailable variable repair must not stop an unrelated tower generation');
assert.match(message, /<UpdateVariable>existing<\/UpdateVariable>/);

const providerState = { message: '结构化变量修复', variables: structuredClone(original), replaceCalls: 0 };
const providerHelper = {
  getLastMessageId: () => 1,
  getChatMessages: () => [{ message: providerState.message, swipe_id: 0 }],
  getVariables: () => structuredClone(providerState.variables),
  setChatMessages: async updates => {
    if (typeof updates[0]?.message === 'string') providerState.message = updates[0].message;
    if (updates[0]?.data !== undefined) providerState.variables = structuredClone(updates[0].data);
  },
  replaceVariables: () => { providerState.replaceCalls += 1; },
};
const providerHost = new PersistentMvuRepairHost({
  now: () => 123,
  generate: async () => ({ operations: [{ op: 'set', path: ['status', 'location'], value: '新城区' }] }),
});
globalThis.MagicGirlWorld = {
  requestMvuExtraRepair: request => {
    return providerHost.request(providerHelper, 'natural-variable-repair', request, () => true);
  },
};
await requestNaturalLanguageVariableRepair('把地点改为新城区');
assert.equal(providerState.variables.stat_data.status.location, '新城区');
assert.equal(providerState.variables.stat_data.status.time, '第一天');
assert.equal(providerState.replaceCalls, 0);
assert.match(providerState.message, /Apply player variable patch/);
delete globalThis.MagicGirlWorld;

console.log('Natural-language variable repair refuses unattributable native writes and leaves tower work untouched.');
