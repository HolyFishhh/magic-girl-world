import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  TowerGenerationCancelledError,
  TowerGenerationQueue,
  TowerGenerationTimeoutError,
} = require(resolve('src/sillytavern-extension/towerGenerationQueue.ts'));
const {
  createGlobalTowerGenerationPorts,
  TOWER_GENERATION_COMPLETED_EVENT,
  TowerGenerationHost,
} = require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));

const tick = () => new Promise(resolvePromise => setTimeout(resolvePromise, 0));

// Production tower requests use Tavern Helper's raw prompt path so the normal
// roleplay preset and worldbook cannot override the background JSON contract.
{
  const calls = [];
  const ports = createGlobalTowerGenerationPorts({
    createChatMessages: async () => undefined,
    generate: async config => { calls.push(['narrative', config]); return '当前预设剧情'; },
    generateRaw: async config => { calls.push(['raw', config]); return '{}'; },
    stopGenerationById: () => true,
  }, () => ({
    chatId: 'raw-chat',
    eventSource: { emit: async () => undefined },
  }));
  await ports.generate({
    generation_id: 'raw-test',
    user_input: '只返回结构化节点',
    should_stream: false,
    should_silence: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'raw');
  assert.equal(calls[0][1].max_chat_history, 0);
  assert.equal(calls[0][1].ordered_prompts.at(-2), 'user_input');
  assert.match(calls[0][1].ordered_prompts[0].content, /后台结构化内容生成器/);
  assert.match(calls[0][1].ordered_prompts.at(-1).content, /最终输出契约/);
  await ports.generateNarrative({
    generation_id: 'story-test',
    user_input: '进入当前节点',
    should_stream: true,
    should_silence: true,
  });
  assert.equal(calls[1][0], 'narrative');
  assert.equal(calls[1][1].preset_name, 'in_use');
  assert.equal(calls[1][1].max_chat_history, 'all');
  assert.equal(calls[1][1].should_stream, true);
  assert.equal('ordered_prompts' in calls[1][1], false);
  assert.equal('json_schema' in calls[1][1], false);
}

// Same chat + node + request is one idempotent job, and the queue invokes only
// one executor at a time.
{
  let releaseFirst;
  const firstGate = new Promise(resolvePromise => { releaseFirst = resolvePromise; });
  const starts = [];
  const queue = new TowerGenerationQueue();
  const task = {
    chatId: 'chat-a',
    nodeId: 'node-1',
    requestId: 'request-1',
    execute: async () => {
      starts.push('first');
      await firstGate;
      return 'one';
    },
  };
  const first = queue.enqueue(task);
  const duplicate = queue.enqueue({ ...task, execute: async () => 'duplicate' });
  assert.equal(first, duplicate, 'dedupe must return the exact retained promise');
  const second = queue.enqueue({
    chatId: 'chat-a', nodeId: 'node-2', requestId: 'request-2',
    execute: async () => { starts.push('second'); return 'two'; },
  });
  await tick();
  assert.deepEqual(starts, ['first']);
  releaseFirst();
  assert.equal(await first, 'one');
  assert.equal(await second, 'two');
  assert.deepEqual(starts, ['first', 'second']);
  assert.equal(await queue.enqueue(task), 'one', 'completed request remains deduplicated');
}

// Current-node narrative is prioritized ahead of future-node lookahead while
// never preempting the model request already in flight.
{
  let releaseActive;
  const activeGate = new Promise(resolvePromise => { releaseActive = resolvePromise; });
  const starts = [];
  const queue = new TowerGenerationQueue();
  const active = queue.enqueue({
    chatId: 'priority-chat', nodeId: 'active', requestId: 'active',
    execute: async () => { starts.push('active'); await activeGate; return 'active'; },
  });
  const lookahead = queue.enqueue({
    chatId: 'priority-chat', nodeId: 'future', requestId: 'future', priority: 0,
    execute: async () => { starts.push('lookahead'); return 'lookahead'; },
  });
  const narrative = queue.enqueue({
    chatId: 'priority-chat', nodeId: 'story', requestId: 'story', priority: 100,
    execute: async () => { starts.push('narrative'); return 'narrative'; },
  });
  await tick();
  assert.deepEqual(starts, ['active']);
  releaseActive();
  assert.equal(await active, 'active');
  assert.equal(await narrative, 'narrative');
  assert.equal(await lookahead, 'lookahead');
  assert.deepEqual(starts, ['active', 'narrative', 'lookahead']);
}

// A route change can cancel one precise in-flight node without touching the
// remaining chat queue. Settled jobs cannot be reported as newly cancelled.
{
  const queue = new TowerGenerationQueue();
  let aborted = false;
  const key = { chatId: 'chat-route', nodeId: 'obsolete-branch', requestId: 'route-request' };
  const obsolete = queue.enqueue({
    ...key,
    execute: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
    }),
  });
  const outcome = obsolete.catch(error => error);
  await tick();
  assert.equal(queue.cancelRequest(key, '路线已改变'), true);
  assert.ok(await outcome instanceof TowerGenerationCancelledError);
  assert.equal(aborted, true);
  assert.equal(queue.getStatus(key).phase, 'cancelled');
  assert.equal(queue.cancelRequest(key, '重复取消'), false);

  const completedKey = { chatId: 'chat-route', nodeId: 'kept-branch', requestId: 'ready-request' };
  assert.equal(await queue.enqueue({ ...completedKey, execute: async () => 'ready' }), 'ready');
  assert.equal(queue.cancelRequest(completedKey, '已完成任务不能取消'), false);
}

// Activating another chat cancels the old chat while the same node/request IDs
// remain independent in the new chat.
{
  const queue = new TowerGenerationQueue();
  let oldAborted = false;
  const old = queue.enqueue({
    chatId: 'chat-old', nodeId: 'shared-node', requestId: 'shared-request',
    execute: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        oldAborted = true;
        reject(signal.reason);
      }, { once: true });
    }),
  });
  const oldOutcome = old.catch(error => error);
  await tick();
  const fresh = queue.enqueue({
    chatId: 'chat-new', nodeId: 'shared-node', requestId: 'shared-request',
    execute: async () => 'fresh',
  });
  const oldError = await oldOutcome;
  assert.ok(oldError instanceof TowerGenerationCancelledError);
  assert.equal(oldAborted, true);
  assert.equal(await fresh, 'fresh');
}

// Timeout aborts the attempt and retries only up to the configured finite cap.
{
  const statuses = [];
  let attempts = 0;
  const queue = new TowerGenerationQueue({ onStatus: status => statuses.push(status.phase) });
  const value = await queue.enqueue({
    chatId: 'chat-timeout', nodeId: 'node', requestId: 'retry-success',
    timeoutMs: 15,
    maxAttempts: 2,
    execute: ({ signal }) => {
      attempts += 1;
      if (attempts === 2) return Promise.resolve('recovered');
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });
  assert.equal(value, 'recovered');
  assert.equal(attempts, 2);
  assert.ok(statuses.includes('retrying'));

  const exhaustedQueue = new TowerGenerationQueue();
  let exhaustedAttempts = 0;
  await assert.rejects(
    exhaustedQueue.enqueue({
      chatId: 'chat-timeout', nodeId: 'node', requestId: 'retry-failed',
      timeoutMs: 10,
      maxAttempts: 2,
      execute: ({ signal }) => {
        exhaustedAttempts += 1;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    }),
    error => error instanceof TowerGenerationTimeoutError,
  );
  assert.equal(exhaustedAttempts, 2);
}

// Production requests may explicitly disable a queue-level watchdog. Route
// changes and chat switches still cancel through AbortController instead.
{
  const queue = new TowerGenerationQueue({ timeoutMs: 10 });
  const value = await queue.enqueue({
    chatId: 'chat-no-timeout', nodeId: 'slow-node', requestId: 'slow-request',
    timeoutMs: null,
    execute: async () => {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
      return 'completed-without-hard-timeout';
    },
  });
  assert.equal(value, 'completed-without-hard-timeout');
}

// Active play performs only a silent generation. The hidden user/assistant
// pair is deferred until a terminal/explicit-exit coordinator archives the
// run; this focused test invokes the low-level archive primitive directly.
{
  const calls = [];
  const ports = {
    currentChatId: () => 'chat-host',
    createChatMessages: async (messages, options) => calls.push(['create', messages, options]),
    generate: async config => {
      calls.push(['generate', config]);
      return '节点已经预生成';
    },
    stopGenerationById: id => { calls.push(['stop', id]); return true; },
    emitInternalEvent: async (name, payload) => calls.push(['event', name, payload]),
  };
  const host = new TowerGenerationHost(ports);
  const request = {
    chatId: 'chat-host',
    nodeId: 'event-7',
    requestId: 'prefetch-2',
    prompt: '生成下一个事件',
  };
  const result = await host.generateNode(request);
  assert.equal(result.response, '节点已经预生成');
  assert.deepEqual(calls.map(call => call[0]), ['generate']);
  assert.equal(calls[0][1].user_input, '生成下一个事件');
  assert.equal(calls[0][1].should_stream, false);
  assert.equal(calls[0][1].should_silence, true);

  const beforeMvuData = { stat_data: { marker: 'before' } };
  const afterMvuData = { stat_data: { marker: 'after' } };
  assert.deepEqual(host.listPendingArchiveKeys('chat-host'), [
    { chatId: 'chat-host', nodeId: 'event-7', requestId: 'prefetch-2' },
  ]);
  const archiveRecords = host.exportPendingArchiveRecords('chat-host');
  assert.equal(archiveRecords.length, 1);
  assert.equal(archiveRecords[0].spec, 'mwg.tower-archive-record/v1');
  assert.equal(archiveRecords[0].prompt, '生成下一个事件');
  assert.equal(archiveRecords[0].response, '节点已经预生成');

  const restoredCalls = [];
  const restoredHost = new TowerGenerationHost({
    ...ports,
    createChatMessages: async (messages, options) => restoredCalls.push(['create', messages, options]),
  });
  assert.equal(restoredHost.restorePendingArchiveRecords(archiveRecords, 'chat-host'), 1);
  assert.equal(restoredHost.restorePendingArchiveRecords(archiveRecords, 'chat-host'), 0, 'restore is idempotent');
  assert.equal(restoredHost.restorePendingArchiveRecords(archiveRecords, 'another-chat'), 0, 'chat scope is strict');
  assert.deepEqual(restoredHost.listPendingArchiveKeys('chat-host'), [
    { chatId: 'chat-host', nodeId: 'event-7', requestId: 'prefetch-2' },
  ]);
  await restoredHost.persistNode(request, { beforeMvuData, afterMvuData });
  assert.equal(restoredCalls.length, 1);
  assert.deepEqual(restoredHost.exportPendingArchiveRecords('chat-host'), []);

  await host.persistNode(request, { beforeMvuData, afterMvuData });
  assert.deepEqual(calls.map(call => call[0]), ['generate', 'create']);
  assert.equal(calls[1][1].length, 2);
  assert.equal(calls[1][1][0].role, 'user');
  assert.equal(calls[1][1][0].is_hidden, true);
  assert.equal(calls[1][1][0].message, '生成下一个事件');
  assert.deepEqual(calls[1][1][0].data, beforeMvuData);
  assert.equal(calls[1][1][1].role, 'assistant');
  assert.equal(calls[1][1][1].is_hidden, true);
  assert.equal(calls[1][1][1].message, '节点已经预生成');
  assert.deepEqual(calls[1][1][1].data, afterMvuData);
  assert.deepEqual(calls[1][2], { insert_before: 'end', refresh: 'none' });
  await host.persistNode(request, { beforeMvuData, afterMvuData });
  assert.equal(calls.filter(call => call[0] === 'create').length, 1, 'persistence is idempotent');
  assert.deepEqual(host.listPendingArchiveKeys('chat-host'), []);

  const completion = {
    spec: 'mwg.tower-generation/v1',
    ...request,
    response: result.response,
    generationId: result.generationId,
    completedAt: 123456,
  };
  await host.dispatchCompletion(request, completion);
  assert.equal(calls.at(-1)[0], 'event');
  assert.equal(calls.at(-1)[1], TOWER_GENERATION_COMPLETED_EVENT);
  assert.equal(calls.at(-1)[2].completedAt, 123456);
}

// A terminal run archives every pending request/response pair in one ordered
// Tavern Helper mutation, rather than refreshing iframe ownership per node.
{
  const calls = [];
  const host = new TowerGenerationHost({
    currentChatId: () => 'chat-batch',
    createChatMessages: async (messages, options) => calls.push(['create', messages, options]),
    generate: async config => `结果:${config.user_input}`,
    stopGenerationById: () => true,
    emitInternalEvent: async () => undefined,
  });
  const requests = [
    { chatId: 'chat-batch', nodeId: 'node-1', requestId: 'request-1', prompt: '生成节点一' },
    { chatId: 'chat-batch', nodeId: 'node-2', requestId: 'request-2', prompt: '生成节点二' },
  ];
  for (const request of requests) await host.generateNode(request);
  const snapshots = requests.map((key, index) => ({
    key,
    snapshots: {
      beforeMvuData: { stat_data: { index, phase: 'before' } },
      afterMvuData: { stat_data: { index, phase: 'after' } },
    },
  }));
  assert.equal(await host.persistNodes(snapshots), 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].map(message => message.message), [
    '生成节点一', '结果:生成节点一', '生成节点二', '结果:生成节点二',
  ]);
  assert.ok(calls[0][1].every(message => message.is_hidden === true));
  assert.deepEqual(calls[0][2], { insert_before: 'end', refresh: 'none' });
  assert.equal(await host.persistNodes(snapshots), 0, 'batch archive is idempotent');
}

// A model timeout is already a complete bounded attempt. The host must stop the
// exact generation once and surface the failure for manual retry instead of
// silently keeping the single-lane queue occupied for several more windows.
{
  let generateCalls = 0;
  let stopCalls = 0;
  const host = new TowerGenerationHost({
    currentChatId: () => 'chat-timeout-host',
    createChatMessages: async () => undefined,
    generate: () => {
      generateCalls += 1;
      return new Promise(() => undefined);
    },
    stopGenerationById: () => {
      stopCalls += 1;
      return true;
    },
    emitInternalEvent: async () => undefined,
  });
  await assert.rejects(host.generateNode({
    chatId: 'chat-timeout-host',
    nodeId: 'slow-node',
    requestId: 'slow-request',
    prompt: '生成缓慢节点',
    timeoutMs: 15,
    maxAttempts: 3,
  }), error => error instanceof TowerGenerationTimeoutError);
  assert.equal(generateCalls, 1);
  assert.equal(stopCalls, 1);
}

// A chat switch aborts Tavern Helper's exact generation ID and never commits a
// stale assistant message or completion event.
{
  let chatId = 'chat-before-switch';
  const calls = [];
  let rejectGeneration;
  const host = new TowerGenerationHost({
    currentChatId: () => chatId,
    createChatMessages: async (messages, options) => calls.push(['create', messages, options]),
    generate: config => {
      calls.push(['generate', config]);
      return new Promise((_resolve, reject) => { rejectGeneration = reject; });
    },
    stopGenerationById: id => {
      calls.push(['stop', id]);
      rejectGeneration?.(new TowerGenerationCancelledError());
      return true;
    },
    emitInternalEvent: async (name, payload) => calls.push(['event', name, payload]),
  });
  const pending = host.generateNode({
    chatId,
    nodeId: 'enemy-1',
    requestId: 'prefetch-1',
    prompt: '生成敌人',
  });
  const outcome = pending.catch(error => error);
  await tick();
  chatId = 'chat-after-switch';
  host.activateChat(chatId);
  assert.ok(await outcome instanceof TowerGenerationCancelledError);
  assert.deepEqual(calls.map(call => call[0]), ['generate', 'stop']);
}

const hostSource = await readFile(resolve('src/sillytavern-extension/towerGenerationHost.ts'), 'utf8');
assert.doesNotMatch(hostSource, /triggerSlash|['"]\/(?:send|trigger)\b/i);

console.log('Tower generation queue and silent pseudo-same-floor host tests passed.');
