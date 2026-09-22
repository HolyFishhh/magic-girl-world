import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { redactDiagnosticText, redactDiagnosticValue } = require('../src/runtime/diagnosticRedaction.ts');
const input = '{"api_key":"quoted-secret","nested":{"authorization":"Basic abc123","password":"with \\"quote\\" and spaces","access_token":"nested-token"},"story":"黑暗仪式增加伤害"}';
const redacted = redactDiagnosticText(input);
for (const secret of ['quoted-secret', 'abc123', 'with', 'nested-token']) assert.ok(!redacted.includes(secret));
assert.equal(JSON.parse(redacted).story, '黑暗仪式增加伤害');
assert.deepEqual(JSON.parse(redactDiagnosticText('{"api\\u005fkey":"unicode-secret"}')), { api_key: '[已隐藏]' });
assert.deepEqual(JSON.parse(redactDiagnosticText('{"token":12345,"nested":{"password":{"value":"secret"}}}')), { token: '[已隐藏]', nested: { password: '[已隐藏]' } });
assert.equal(redactDiagnosticText('{ "text": "普通剧情", "damage": 2 }'), '{ "text": "普通剧情", "damage": 2 }');
for (const raw of ['api_key=plain-secret', 'authorization: Basic abc123', 'password="two word secret"', 'Bearer abc123', 'https://example.test/?token=abc123', 'sk-synthetic-secret']) {
  const result = redactDiagnosticText(raw);
  assert.ok(!/plain-secret|abc123|two word|synthetic-secret/.test(result));
}
const data = { items: [{ token: { nested: 'secret' }, text: 'normal' }] };
assert.deepEqual(redactDiagnosticValue(data), { items: [{ token: '[已隐藏]', text: 'normal' }] });
assert.equal(data.items[0].token.nested, 'secret', 'redaction never mutates source');
assert.equal(redactDiagnosticText('正常剧情\n黑暗仪式：伤害+2'), '正常剧情\n黑暗仪式：伤害+2');
console.log('PASS diagnostic redaction: quoted/escaped/nested JSON, transport secrets, and source preservation');
