import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { TowerGenerationHost, createGlobalTowerGenerationPorts } = require('../src/sillytavern-extension/towerGenerationHost.ts');

// Real host -> real ports -> deferred Helper final. Streaming is delivery,
// not permission to publish partial content or add a third attempt.
for (const first of ['success', 'empty', 'error']) {
  const calls = [];
  let finish;
  const ports = createGlobalTowerGenerationPorts({
    generateRaw: async config => {
      calls.push(config);
      if (calls.length === 1 && first === 'empty') return '';
      if (calls.length === 1 && first === 'error') throw new Error('Gateway Timeout');
      return await new Promise(resolve => { finish = resolve; });
    },
  }, () => ({ chatId: 'stream-test', chatCompletionSettings: { chat_completion_source: 'custom', custom_model: 'unlisted' } }));
  const host = new TowerGenerationHost(ports);
  const request = { chatId: 'stream-test', nodeId: 'battle', requestId: first, prompt: 'unchanged story and rules', maxAttempts: 2,
    generation: { structured_delivery: 'text-json', json_schema: { name: 'mwg_tower_battle_result', value: { type: 'object' } } } };
  let settled = false;
  const pending = host.generateNode(request).then(result => { settled = true; return result; });
  for (let i = 0; !finish && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(typeof finish, 'function');
  assert.equal(settled, false, 'must wait for complete Helper final');
  assert.equal(calls.length, first === 'success' ? 1 : 2);
  for (const config of calls) {
    assert.equal(config.should_stream, true);
    assert.equal(config.should_silence, true);
    assert.equal(config.user_input, request.prompt);
    for (const key of ['json_schema', 'response_format', 'tools', 'tool_choice', 'deepseek_thinking_mode']) assert.equal(Object.hasOwn(config, key), false);
  }
  finish('{"complete":true}');
  const result = await pending;
  assert.equal(result.response, '{"complete":true}');
  assert.equal(result.additionalRequestsUsed ?? 0, calls.length - 1);
  assert.deepEqual(await host.generateNode(request), result);
  assert.equal(calls.length, first === 'success' ? 1 : 2);
}
console.log('PASS ordinary text nodes stream, wait for full final, preserve input, cap retries and reuse cached result.');
