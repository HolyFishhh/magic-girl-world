import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { sha256 } = require('../src/shared/sha256.ts');
const { towerInitialStateDigest } = require('../src/sillytavern-extension/towerInitialCommit.ts');
const { createSchemaCapabilityCache } = require('../src/sillytavern-extension/schemaCapabilityCache.ts');
const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const examples = ['', 'abc', '魔法少女✨\u0000', ...[55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 4096, 1000000].map(n => 'a'.repeat(n))];
const stat = { battle: { cards: [{ id: 'strike', effects: { damage: 6 }, name: '星火' }] }, run: { seed: 18 } };
let nativeDigest, nativeFingerprint;
const settings = { chat_completion_source: 'custom', custom_model: 'fixture', custom_url: 'https://fixture.invalid' };
try {
  for (const crypto of [webcrypto, {}, undefined]) {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
    for (const text of examples) assert.equal(await sha256(text), createHash('sha256').update(text).digest('hex'));
    const digest = await towerInitialStateDigest(stat);
    const fingerprint = await createSchemaCapabilityCache(() => undefined).fingerprint(settings);
    nativeDigest ??= digest; nativeFingerprint ??= fingerprint;
    assert.equal(digest, nativeDigest, 'HTTP and HTTPS preserve the same saved-state receipt');
    assert.equal(fingerprint, nativeFingerprint, 'provider capability cache survives protocol changes');
  }
} finally {
  if (original) Object.defineProperty(globalThis, 'crypto', original); else delete globalThis.crypto;
}
console.log('PASS SHA-256: standard vectors, UTF-8, block boundaries, million-byte input; HTTP save receipts/cache match native crypto.');
