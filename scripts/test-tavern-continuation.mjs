import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { TavernContinuationError, TavernContinuationHost } = require(resolve('src/runtime/tavernContinuation.ts'));
const { TavernBattleEndHost } = require(resolve('src/fish/core/battleEndHost.ts'));

function continuationPorts(overrides = {}) {
  return {
    createChatMessages: async () => undefined,
    triggerGeneration: async () => undefined,
    ...overrides,
  };
}

const calls = [];
const exactPrompt = '公式 A || B\n{"effects":{"damage":"X + 2"}}';
const successHost = new TavernContinuationHost(
  continuationPorts({
    createChatMessages: async (messages, options) => calls.push(['create', messages, options]),
    triggerGeneration: async () => calls.push(['trigger']),
  }),
);
await successHost.continueWithPrompt({ prompt: `  ${exactPrompt}  ` });
assert.deepEqual(calls, [
  ['create', [{ role: 'user', message: exactPrompt }], { refresh: 'affected' }],
  ['trigger'],
]);

const sendLifecycle = [];
const sendFailureHost = new TavernContinuationHost(
  continuationPorts({
    createChatMessages: async () => {
      sendLifecycle.push('create');
      throw new Error('create failed');
    },
  }),
);
await assert.rejects(
  sendFailureHost.continueWithPrompt({
    prompt: 'retry',
    prepare: () => {
      sendLifecycle.push('prepare');
      return { previous: 7 };
    },
    rollbackBeforeSend: prepared => sendLifecycle.push(`rollback:${prepared.previous}`),
  }),
  error =>
    error instanceof TavernContinuationError &&
    error.stage === 'send' &&
    error.messageSent === false &&
    error.cause?.message === 'create failed',
);
assert.deepEqual(sendLifecycle, ['prepare', 'create', 'rollback:7']);

let triggerRollback = false;
const triggerFailureHost = new TavernContinuationHost(
  continuationPorts({
    triggerGeneration: async () => {
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
    error instanceof TavernContinuationError &&
    error.stage === 'trigger' &&
    error.messageSent === true &&
    error.cause?.message === 'generation failed',
);
assert.equal(triggerRollback, false);

let releaseCreate;
const pendingCreate = new Promise(resolvePromise => {
  releaseCreate = resolvePromise;
});
const concurrentHost = new TavernContinuationHost(
  continuationPorts({ createChatMessages: () => pendingCreate }),
);
const firstContinuation = concurrentHost.continueWithPrompt({ prompt: 'first' });
assert.equal(concurrentHost.isBusy(), true);
await assert.rejects(concurrentHost.continueWithPrompt({ prompt: 'second' }), /已有行动正在发送/);
releaseCreate();
await firstContinuation;
assert.equal(concurrentHost.isBusy(), false);
await assert.rejects(successHost.continueWithPrompt({ prompt: '  ' }), /行动提示不能为空/);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function battleState() {
  return {
    currentTurn: 4,
    battleRequest: { route: { nodeId: 'node-1' } },
    player: { currentHp: 37, currentLust: 8, items: [{ id: 'potion', count: 1 }] },
  };
}

function battlePorts(box, lifecycle, overrides = {}) {
  return {
    getState: battleState,
    clearBattleSession: async () => {
      lifecycle.push('clear');
      delete box.value.mwg?.battle_session;
    },
    reloadBattleState: async () => {
      lifecycle.push('reload-state');
      return true;
    },
    readVariables: () => clone(box.value),
    replaceVariables: async variables => {
      lifecycle.push('replace');
      box.value = clone(variables);
    },
    settleBattle: async input => {
      lifecycle.push(`settle:${input.result}`);
      box.value.stat_data.settled = input.player.currentHp;
    },
    reloadPage: () => lifecycle.push('reload-page'),
    ...overrides,
  };
}

const initialVariables = { stat_data: { battle: { enemy: { name: '测试敌人' } } }, mwg: { battle_session: { turn: 4 } } };
const rollbackBox = { value: clone(initialVariables) };
const rollbackLifecycle = [];
const rollbackContinuation = new TavernContinuationHost(
  continuationPorts({
    createChatMessages: async () => {
      rollbackLifecycle.push('create');
      throw new Error('message failed');
    },
  }),
);
const rollbackBattleHost = new TavernBattleEndHost(
  rollbackContinuation,
  battlePorts(rollbackBox, rollbackLifecycle),
);
await assert.rejects(
  rollbackBattleHost.confirmBattleEnd('victory', '胜利 || {"reward":1}'),
  error => error instanceof TavernContinuationError && error.stage === 'send' && !error.messageSent,
);
assert.deepEqual(rollbackBox.value, initialVariables, 'a failed message creation must restore the complete source floor');
assert.deepEqual(rollbackLifecycle, ['clear', 'settle:victory', 'create', 'replace', 'reload-state']);

const prepareBox = { value: clone(initialVariables) };
const prepareLifecycle = [];
const prepareBattleHost = new TavernBattleEndHost(
  new TavernContinuationHost(continuationPorts()),
  battlePorts(prepareBox, prepareLifecycle, {
    settleBattle: async () => {
      prepareLifecycle.push('settle-failed');
      prepareBox.value.stat_data.partial = true;
      throw new Error('settlement failed');
    },
  }),
);
await assert.rejects(prepareBattleHost.confirmBattleEnd('defeat', '失败'), /settlement failed/);
assert.deepEqual(prepareBox.value, initialVariables, 'a partial settlement must restore the complete source floor');
assert.deepEqual(prepareLifecycle, ['clear', 'settle-failed', 'replace', 'reload-state']);

const committedBox = { value: clone(initialVariables) };
const committedLifecycle = [];
const committedContinuation = new TavernContinuationHost(
  continuationPorts({
    createChatMessages: async messages => committedLifecycle.push(`create:${messages[0].message}`),
    triggerGeneration: async () => {
      committedLifecycle.push('trigger-failed');
      throw new Error('generation failed');
    },
  }),
);
const committedBattleHost = new TavernBattleEndHost(
  committedContinuation,
  battlePorts(committedBox, committedLifecycle),
);
await assert.rejects(
  committedBattleHost.confirmBattleEnd('terminated', '事件终止 || {"keep":true}'),
  error => error instanceof TavernContinuationError && error.stage === 'trigger' && error.messageSent,
);
assert.equal(committedBox.value.stat_data.settled, 37);
assert.equal(committedBox.value.mwg?.battle_session, undefined);
assert.doesNotMatch(committedLifecycle.join(','), /replace|reload-state/);

// Tower confirmation is an in-place transaction: it never creates or
// triggers a chat floor, and duplicate UI callbacks cannot settle twice.
const towerBox = { value: clone(initialVariables) };
const towerLifecycle = [];
let towerContinuationCalls = 0;
const towerBattleHost = new TavernBattleEndHost(
  new TavernContinuationHost(
    continuationPorts({
      createChatMessages: async () => {
        towerContinuationCalls += 1;
      },
      triggerGeneration: async () => {
        towerContinuationCalls += 1;
      },
    }),
  ),
  battlePorts(towerBox, towerLifecycle, {
    openCommonView: () => towerLifecycle.push('open-common'),
  }),
);
await towerBattleHost.confirmTowerBattleEnd('victory');
await towerBattleHost.confirmTowerBattleEnd('victory');
assert.equal(towerContinuationCalls, 0);
assert.deepEqual(towerLifecycle, ['clear', 'settle:victory', 'open-common']);

function presentationState(route) {
  return {
    currentTurn: 2,
    battleRequest: { route },
    player: {
      currentHp: 12,
      maxHp: 20,
      currentLust: 4,
      maxLust: 100,
      energy: 0,
      items: [],
      statusEffects: [],
      hand: [],
      drawPile: [],
      discardPile: [],
    },
    enemy: null,
  };
}

async function captureBattleEndPrompt(route) {
  let dialog = null;
  const host = new TavernBattleEndHost(
    new TavernContinuationHost(continuationPorts()),
    battlePorts({ value: clone(initialVariables) }, [], { getState: () => presentationState(route) }),
    {
      hasBattleEndDialog: () => false,
      showBattleEndDialog: request => {
        dialog = request;
      },
      addLog: () => undefined,
    },
  );
  await host.presentBattleEnd('defeat');
  return dialog.battleSummary;
}

for (const prompt of [await captureBattleEndPrompt(null), await captureBattleEndPrompt({ nodeId: 'node-1' })]) {
  assert.match(prompt, /^请根据以下按回合战斗摘要/);
  assert.match(prompt, /必须覆盖摘要中的每个回合/);
  assert.doesNotMatch(prompt, /\[战斗后续\]|\[战斗结算\]|\[战败惩罚\]|\[剧情模型要求\]/);
}

const continuationBox = { value: clone(initialVariables) };
const continuationPromptCalls = [];
let continuationDialog = null;
const continuationInputHost = new TavernBattleEndHost(
  new TavernContinuationHost(
    continuationPorts({
      createChatMessages: async messages => continuationPromptCalls.push(messages[0].message),
    }),
  ),
  battlePorts(continuationBox, [], { getState: () => presentationState(null) }),
  {
    hasBattleEndDialog: () => false,
    showBattleEndDialog: request => {
      continuationDialog = request;
    },
    addLog: () => undefined,
  },
);
await continuationInputHost.presentBattleEnd('defeat');
await continuationDialog.onConfirm('先检查敌人遗留的武器，再安抚受伤的同伴。');
assert.equal(continuationPromptCalls.length, 1);
assert.match(
  continuationPromptCalls[0],
  /【玩家指定的战后行动】先检查敌人遗留的武器，再安抚受伤的同伴。/,
);

console.log('All Tavern continuations preserve exact prompts and battle-exit transaction semantics.');
