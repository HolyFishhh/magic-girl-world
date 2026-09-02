import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/sillytavern-extension/mvuRequestPolicy.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });
const { applyMvuRequestPolicy, MVU_MAX_OUTPUT_TOKENS } = module.exports;

const deepSeekPayload = {
  model: 'deepseek-v4-flash',
  include_reasoning: true,
  thinking: { type: 'enabled' },
  reasoning_effort: 'high',
  max_tokens: 65535,
  messages: [{ role: 'system', content: 'keep' }],
};
assert.equal(applyMvuRequestPolicy(deepSeekPayload), true);
assert.equal(deepSeekPayload.include_reasoning, true);
assert.equal(JSON.stringify(deepSeekPayload.thinking), JSON.stringify({ type: 'enabled' }));
assert.equal(deepSeekPayload.reasoning_effort, 'high');
assert.equal(deepSeekPayload.max_tokens, MVU_MAX_OUTPUT_TOKENS);
assert.deepEqual(deepSeekPayload.messages, [{ role: 'system', content: 'keep' }]);
assert.equal(applyMvuRequestPolicy(deepSeekPayload), false, 'policy must be idempotent');

const ordinaryPayload = { model: 'ordinary-model', include_reasoning: false, max_tokens: 4096, messages: [] };
assert.equal(applyMvuRequestPolicy(ordinaryPayload), true);
assert.deepEqual(ordinaryPayload, { model: 'ordinary-model', include_reasoning: true, max_tokens: 20000, messages: [] });
assert.equal(applyMvuRequestPolicy(ordinaryPayload), false, 'expanded MVU output policy must be idempotent');
assert.equal(applyMvuRequestPolicy(null), false);

console.log('MVU second-stage request policy tests passed.');
