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
  TowerGenerationHostError,
} = require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));

const tick = () => new Promise(resolvePromise => setTimeout(resolvePromise, 0));

// Public metadata separates Helper attempts from node-envelope retries and
// contract repairs, without retaining any content or serializing exceptions.
{
  let currentChat = 'diagnostics-chat';
  const replies = ['', '{"final":true}', '   '];
  const lifecycle = [];
  const host = new TowerGenerationHost({
    currentChatId: () => currentChat, createChatMessages: async () => assert.fail('no chat write'),
    generate: async () => replies.shift(), generateNarrative: async () => '',
    stopGenerationById: () => true, emitInternalEvent: async () => assert.fail('no publication'),
  }, { onAttemptLifecycle: event => lifecycle.push({
    phase: event.phase, attempt: event.attempt, outcome: event.outcome,
    generationId: event.generationId,
  }) });
  const request = { chatId: currentChat, nodeId: 'node', requestId: 'diagnostics', prompt: 'PRIVATE_PROMPT',
    generation: { json_schema: { name: 'mwg_tower_event_result', value: { type: 'object' } } }, maxAttempts: 2 };
  const delivered = await host.generateNode(request);
  assert.equal(delivered.additionalRequestsUsed,1,'actual empty retry is reported to the controller budget');
  await assert.rejects(host.generateNode({ ...request, requestId: 'repair', maxAttempts: 1,
    userExtra: { mwg_tower_batch_structure_repair: true } }), /结构修正，第 1 次请求，文本长度 3/);
  await assert.rejects(host.generateNarrative({ ...request, requestId: 'story', maxAttempts: 1 }), /剧情模型/);
  const diagnostics = host.getDiagnostics();
  assert.deepEqual(diagnostics.map(d => [d.stage, d.attempt, d.outcome, d.finalCharacters, d.emptyJsonFallbackRequested]), [
    ['structured', 1, 'empty_final', 0, false], ['structured', 2, 'returned', 14, true],
    ['structure-repair', 1, 'empty_final', 3, false], ['narrative', 1, 'empty_final', 0, false],
  ]);
  assert.deepEqual(lifecycle.slice(0, 4).map(event => [event.phase, event.attempt, event.outcome]), [
    ['transport_invoked', 1, undefined], ['settled', 1, 'empty_final'],
    ['transport_invoked', 2, undefined], ['settled', 2, 'returned'],
  ], 'diagnostics distinguish queue retry from Helper handoff and settled promise');
  assert.ok(lifecycle.every(event => !JSON.stringify(event).includes('PRIVATE_PROMPT')));
  assert.ok(diagnostics.every(d => d.finishedAt >= d.startedAt));
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_PROMPT|actual_final|json_schema/);
  diagnostics[0].outcome = 'corrupted';
  assert.equal(host.getDiagnostics()[0].outcome, 'empty_final', 'snapshots cannot mutate history');
  assert.deepEqual(await host.generateNode(request),delivered,'cached result preserves spent budget without a new invocation');
  assert.equal(host.getDiagnostics().length, 4, 'deduplicated responses do not count as new requests');
  currentChat = 'other-chat';
  assert.deepEqual(host.getDiagnostics(), [], 'old-chat diagnostics never leak through current-chat API');
  host.activateChat(currentChat);
  currentChat = 'diagnostics-chat';
  assert.deepEqual(host.getDiagnostics(), [], 'switch releases the old chat history');
}
{
  const { TowerGenerationDiagnostics } = require(resolve('src/sillytavern-extension/towerGenerationDiagnostics.ts'));
  let time = 1;
  const diagnostics = new TowerGenerationDiagnostics(() => time++);
  for (let index = 0; index < 70; index++) {
    const pending = diagnostics.begin({ chatId: 'chat', nodeId: 'node', requestId: String(index) }, 'structured', 1, String(index), false);
    pending.failed({ name: 'TypeError', message: 'Bearer PRIVATE_TOKEN', status: 503, body: 'PRIVATE_BODY' });
  }
  const entries = diagnostics.snapshot('chat');
  assert.equal(entries.length, 64);
  assert.equal(entries[0].requestId, '6');
  assert.equal(entries[0].errorType, 'TypeError');
  assert.equal(entries[0].httpStatus, 503);
  assert.doesNotMatch(JSON.stringify(entries), /PRIVATE|Bearer|message|body/);
  const pending = diagnostics.begin({ chatId: 'chat', nodeId: 'node', requestId: 'cancel' }, 'structured', 1, 'cancel', false);
  pending.failed({ code: 'timeout' }, true);
  pending.returned('late result');
  assert.equal(diagnostics.snapshot('chat').at(-1).outcome, 'timeout', 'late returns cannot overwrite an abort');
  const hostile = diagnostics.begin({ chatId: 'chat', nodeId: 'node', requestId: 'hostile' }, 'structured', 1, 'hostile', false);
  assert.doesNotThrow(() => hostile.failed(new Proxy({}, { get() { throw new Error('getter'); } })));
}

// Empty finals may change transport on the existing next attempt, never add a
// nested request or manufacture content from a non-text/reasoning envelope.
for (const first of ['', ' \n', { reasoning_content: 'not final content' }, new Error('network')]) {
  const calls = [];
  const request = { chatId: 'empty-chat', nodeId: 'event', requestId: 'empty-retry', prompt: 'same complete prompt',
    generation: { json_schema: { name: 'mwg_tower_event_result', value: { type: 'object' } } }, maxAttempts: 2 };
  const original = structuredClone(request);
  const host = new TowerGenerationHost({
    currentChatId: () => 'empty-chat', createChatMessages: async () => assert.fail('no chat write'),
    generate: async config => {
      calls.push(config);
      if (calls.length === 1) { if (first instanceof Error) throw first; return first; }
      return '{"actual_final":true}';
    },
    stopGenerationById: () => true, emitInternalEvent: async () => assert.fail('no unvalidated publication'),
  });
  const generatedResult = await host.generateNode(request);
  assert.equal(generatedResult.response, '{"actual_final":true}');
  assert.equal(generatedResult.emptyJsonFallbackUsed,typeof first === 'string' ? true : undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].empty_json_fallback, false);
  assert.equal(calls[1].empty_json_fallback, typeof first === 'string');
  assert.deepEqual(calls[0].json_schema, calls[1].json_schema);
  assert.equal(calls[0].user_input, calls[1].user_input);
  assert.notEqual(calls[0].generation_id, calls[1].generation_id);
  assert.deepEqual(request, original, 'request not mutated by retry');
  assert.deepEqual(await host.generateNode(request),generatedResult,'cached result retains successful transport provenance');
  assert.equal(calls.length, 2, 'successful retry remains deduplicated');
}
for (const repairFlag of [undefined,'mwg_tower_structure_repair','mwg_tower_batch_structure_repair','mwg_tower_opening_structure_repair']) {
  for(const hasSchema of [false,true]) {
    const calls=[];
    const host=new TowerGenerationHost({
      currentChatId:()=> 'repair-provenance',createChatMessages:async()=>assert.fail('no write'),
      generate:async config=>{calls.push(config);return '{}';},stopGenerationById:()=>true,
      emitInternalEvent:async()=>assert.fail('no unvalidated publication'),
    });
    const request={chatId:'repair-provenance',nodeId:'event',requestId:'one',prompt:'unchanged repair facts',
      maxAttempts:1,continueEmptyFinalRecovery:true,
      ...(hasSchema?{generation:{json_schema:{name:'mwg_tower_event_result',value:{type:'object'}}}}:{}),
      ...(repairFlag?{userExtra:{[repairFlag]:true}}:{}),
    };
    const result=await host.generateNode(request);
    const expected=Boolean(repairFlag)&&hasSchema;
    assert.equal(calls.length,1,'continuation consumes the existing single repair request');
    assert.equal(calls[0].empty_json_fallback,expected);
    assert.equal(result.emptyJsonFallbackUsed,expected?true:undefined);
    assert.equal(calls[0].user_input,request.prompt);
    assert.equal(Object.hasOwn(calls[0],'continueEmptyFinalRecovery'),false,'private provenance never reaches Helper');
    assert.deepEqual(await host.generateNode(request),result);assert.equal(calls.length,1);
  }
}
for (const maxAttempts of [1, 2]) {
  const calls = [];
  const host = new TowerGenerationHost({
    currentChatId: () => 'empty-chat', createChatMessages: async () => assert.fail('no chat write'),
    generate: async config => { calls.push(config); return ''; },
    stopGenerationById: () => true, emitInternalEvent: async () => assert.fail('no completion'),
  });
  await assert.rejects(host.generateNode({ chatId: 'empty-chat', nodeId: 'node', requestId: 'empty', prompt: 'complete',
    generation: { json_schema: { name: 'mwg_tower_event_result', value: { type: 'object' } } }, maxAttempts,
  }), error => error instanceof TowerGenerationHostError && error.code === 'invalid_response');
  assert.equal(calls.length, maxAttempts, 'no added retry after exhaustion');
  assert.deepEqual(host.exportPendingArchiveRecords('empty-chat'), [], 'empty results cannot enter archive');
}

{
  let chatId = 'fallback-before-switch';
  let rejectFallback;
  const generatedIds = [];
  const stoppedIds = [];
  const host = new TowerGenerationHost({
    currentChatId: () => chatId, createChatMessages: async () => assert.fail('no stale chat write'),
    generate: config => {
      generatedIds.push(config.generation_id);
      if (generatedIds.length === 1) return Promise.resolve('');
      assert.equal(config.empty_json_fallback, true);
      return new Promise((_resolve, reject) => { rejectFallback = reject; });
    },
    stopGenerationById: id => { stoppedIds.push(id); rejectFallback?.(new TowerGenerationCancelledError()); return true; },
    emitInternalEvent: async () => assert.fail('no stale publication'),
  });
  const pending = host.generateNode({ chatId, nodeId: 'event', requestId: 'switch-on-fallback', prompt: 'same facts',
    generation: { json_schema: { name: 'mwg_tower_event_result', value: { type: 'object' } } },
  }).catch(error => error);
  await tick();
  assert.equal(generatedIds.length, 2);
  chatId = 'fallback-after-switch';
  host.activateChat(chatId);
  assert.ok(await pending instanceof TowerGenerationCancelledError);
  assert.deepEqual(stoppedIds, [generatedIds[1]], 'cancel the exact fallback generation, not the completed first request');
  assert.equal(host.getDiagnostics().at(-1)?.outcome, undefined, 'current-chat read hides cancelled old-chat records');
  assert.deepEqual(host.exportPendingArchiveRecords('fallback-before-switch'), []);
}

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
    chatCompletionSettings: { chat_completion_source: 'deepseek' },
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
  assert.match(calls[0][1].ordered_prompts[0].content, /MWG_TOWER_STRUCTURED_REQUEST:raw-test/);
  assert.match(calls[0][1].ordered_prompts[1].content, /后台结构化内容生成器/);
  assert.match(calls[0][1].ordered_prompts.at(-1).content, /最终输出契约/);
  assert.equal('include_reasoning' in calls[0][1], false);
  assert.equal('reasoning_effort' in calls[0][1], false);
  assert.equal('enable_thinking' in calls[0][1], false);
  assert.equal('thinking' in calls[0][1], false);
  assert.equal('temperature' in calls[0][1], false);
  await ports.generate({ generation_id: 'empty-second', user_input: 'same contract',
    should_stream: false, should_silence: true, empty_json_fallback: true,
    json_schema: { name: 'mwg_tower_event_result', value: { type: 'object' } },
  });
  assert.equal(calls[1][0], 'raw');
  assert.equal(calls[1][1].ordered_prompts[0].content, 'MWG_TOWER_STRUCTURED_REQUEST:empty-second');
  assert.equal('json_schema' in calls[1][1], false, 'Helper must never receive the schema option to re-inject later');
  assert.match(calls[1][1].ordered_prompts.at(-1).content, /^JSON schema for the response:/);
  assert.equal('empty_json_fallback' in calls[1][1], false, 'private transport option not forwarded to Helper');
  calls.splice(1, 1);
  await ports.generateNarrative({
    generation_id: 'story-test',
    user_input: '进入当前节点',
    should_stream: true,
    should_silence: true,
  });
  assert.equal(calls[1][0], 'narrative');
  assert.equal(calls[1][1].preset_name, 'in_use');
  assert.equal(calls[1][1].user_input, '[MWG_TOWER_NARRATIVE_REQUEST]\n进入当前节点');
  assert.equal(calls[1][1].max_chat_history, 'all');
  assert.equal(calls[1][1].should_stream, true);
  assert.equal('ordered_prompts' in calls[1][1], false);
  assert.equal('json_schema' in calls[1][1], false);
}

// Same chat + node + request is one idempotent job, and the queue invokes only
// one executor at a time.
// Reproduce Helper's actual late optionsInjector, including custom API
// conservatism. An event-time delete would fail this regression.
for (const schemaName of ['mwg_tower_event_result', 'mwg_initial_draft'])
for (const [provider, customApi, fallbackExpected] of [
  ['deepseek', undefined, true], ['openai', undefined, false],
  ['custom', undefined, false], [undefined, undefined, false],
  ['deepseek', { source: 'openai' }, false], ['deepseek', { source: 'deepseek' }, false],
]) {
  let emitted;
  const ports = createGlobalTowerGenerationPorts({
    generateRaw: async config => {
      const prompts = config.ordered_prompts.map(entry => entry === 'user_input'
        ? { role: 'user', content: config.user_input } : entry);
      emitted = { messages: prompts };
      // Generic extension listeners run first, then Helper's late injector.
      if (config.json_schema) emitted.json_schema = config.json_schema;
      assert.equal('empty_json_fallback' in config, false);
      return '{}';
    },
  }, () => ({ chatCompletionSettings: { chat_completion_source: provider } }));
  const schema = { name: schemaName, value: { type: 'object', properties: { spec: { const: 'result' } }, required: ['spec'], additionalProperties: false } };
  const config = { generation_id: 'late-injector', user_input: 'same complete gameplay contract',
    should_stream: false, should_silence: true, json_schema: schema, empty_json_fallback: true,
    ...(customApi ? { custom_api: customApi } : {}),
  };
  const before = structuredClone(config);
  await ports.generate(config);
  assert.deepEqual(config, before);
  assert.equal('json_schema' in emitted, !fallbackExpected);
  const schemaMessages = emitted.messages.filter(message => message.content?.startsWith('JSON schema for the response:'));
  assert.equal(schemaMessages.length, fallbackExpected ? 1 : 0);
  if (fallbackExpected) assert.deepEqual(JSON.parse(schemaMessages[0].content.split('\n').slice(1).join('\n')), schema.value);
}

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
  const queue = new TowerGenerationQueue({ onStatus: status => statuses.push(status) });
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
  const retryStatus = statuses.find(status => status.phase === 'retrying');
  assert.equal(retryStatus.retryReason.kind, 'timeout');
  assert.equal(retryStatus.retryReason.retryable, true);

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
