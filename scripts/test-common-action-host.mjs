import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { TavernCommonActionHost, TavernCommonContinuationError } = require(resolve('src/common/commonActionHost.ts'));

function createPorts(overrides = {}) {
  return {
    updateVariablesWith: async updater => updater({ stat_data: {} }),
    createChatMessages: async () => undefined,
    triggerSlash: async () => '',
    ...overrides,
  };
}

const calls = [];
const exactPrompt = '保留公式 A || B，并保留 JSON {"effects":{"damage":"X+2"}}';
const successHost = new TavernCommonActionHost(
  createPorts({
    createChatMessages: async (messages, options) => calls.push(['create', messages, options]),
    triggerSlash: async command => calls.push(['slash', command]),
  }),
);
await successHost.continueWithPrompt({ prompt: `  ${exactPrompt}  ` });
assert.deepEqual(calls, [
  ['create', [{ role: 'user', message: exactPrompt }], { refresh: 'affected' }],
  ['slash', '/trigger'],
]);

const lifecycle = [];
const sendFailureHost = new TavernCommonActionHost(
  createPorts({
    createChatMessages: async () => {
      lifecycle.push('create');
      throw new Error('create failed');
    },
    triggerSlash: async () => {
      lifecycle.push('unexpected trigger');
      return '';
    },
  }),
);
await assert.rejects(
  sendFailureHost.continueWithPrompt({
    prompt: 'retry',
    prepare: () => {
      lifecycle.push('prepare');
      return { previous: 7 };
    },
    rollbackBeforeSend: prepared => lifecycle.push(`rollback:${prepared.previous}`),
  }),
  error =>
    error instanceof TavernCommonContinuationError &&
    error.stage === 'send' &&
    error.messageSent === false &&
    error.cause?.message === 'create failed',
);
assert.deepEqual(lifecycle, ['prepare', 'create', 'rollback:7']);

let triggerRollback = false;
const triggerFailureHost = new TavernCommonActionHost(
  createPorts({
    triggerSlash: async () => {
      throw new Error('generation failed');
    },
  }),
);
await assert.rejects(
  triggerFailureHost.continueWithPrompt({
    prompt: 'continue',
    prepare: () => 'prepared',
    rollbackBeforeSend: () => {
      triggerRollback = true;
    },
  }),
  error =>
    error instanceof TavernCommonContinuationError &&
    error.stage === 'trigger' &&
    error.messageSent === true &&
    error.cause?.message === 'generation failed',
);
assert.equal(triggerRollback, false, 'created user messages make prepared MUV state authoritative');

const rollbackFailureHost = new TavernCommonActionHost(
  createPorts({
    createChatMessages: async () => {
      throw new Error('create failed');
    },
  }),
);
await assert.rejects(
  rollbackFailureHost.continueWithPrompt({
    prompt: 'retry',
    prepare: () => 'prepared',
    rollbackBeforeSend: () => {
      throw new Error('rollback failed');
    },
  }),
  error =>
    error instanceof TavernCommonContinuationError &&
    error.cause instanceof AggregateError &&
    error.cause.errors.map(item => item.message).join(',') === 'create failed,rollback failed',
);

let releaseCreate;
const pendingCreate = new Promise(resolvePromise => {
  releaseCreate = resolvePromise;
});
const concurrentHost = new TavernCommonActionHost(createPorts({ createChatMessages: () => pendingCreate }));
const firstContinuation = concurrentHost.continueWithPrompt({ prompt: 'first' });
await assert.rejects(concurrentHost.continueWithPrompt({ prompt: 'second' }), /已有行动正在发送/);
releaseCreate();
await firstContinuation;

await assert.rejects(successHost.continueWithPrompt({ prompt: '   ' }), /行动提示不能为空/);

console.log('Common action host creates exact user messages and preserves transaction boundaries.');
