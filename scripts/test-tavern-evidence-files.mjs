// Synthetic evidence only. Never writes a chat, character, settings or MVU state.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createTavernApi } from './lib/tavern-api.mjs';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { EvidenceFileStore, createTavernEvidenceFilePorts } = require('../src/sillytavern-extension/evidenceFileStore.ts');
const { TowerGenerationEvidence } = require('../src/sillytavern-extension/towerGenerationEvidence.ts');
const api = await createTavernApi('http://127.0.0.1:8012');
const originalFetch = globalThis.fetch, created = new Set();
let result;
globalThis.fetch = async (input, init) => {
  if (typeof input !== 'string' || !input.startsWith('/')) return originalFetch(input, init);
  if (input === '/api/files/upload') {
    const { name } = JSON.parse(init.body);
    assert.match(name, /^mwg-evidence-[a-f0-9]{64}\.txt$/);
    const before = await api.request(`/user/files/${name}`);
    assert.ok(before.ok || before.status === 404);
    const response = await api.request(input, init);
    if (response.ok && before.status === 404) created.add(name);
    return response;
  }
  return api.request(input, init);
};
const chatId = `isolated-evidence-${randomUUID()}`;
try {
  const files = new EvidenceFileStore(createTavernEvidenceFilePorts(() => ({})));
  const evidence = new TowerGenerationEvidence(files); evidence.retainChat(chatId);
  const record = { chatId, requestId: 'synthetic', nodeId: 'fixture', stage: 'response', recordedAt: 1,
    response: '仅供隔离验证：黑暗仪式。'.repeat(2000) };
  evidence.append(record); await evidence.archive(chatId, () => {});
  assert.equal(evidence.status(chatId).error, ''); assert.equal(evidence.status(chatId).pending, 0);
  const index = JSON.parse(JSON.stringify(evidence.metadataSnapshot(chatId)));
  const restored = new TowerGenerationEvidence(new EvidenceFileStore(createTavernEvidenceFilePorts(() => ({}))));
  restored.retainChat(chatId, index);
  assert.deepEqual((await restored.snapshot(chatId)).records, [record]);
  result = { passed: true, chatId, files: [...created], indexBytes: Buffer.byteLength(JSON.stringify(index)), payloadCharacters: record.response.length, playerDataWritten: false };
} finally {
  globalThis.fetch = originalFetch;
  for (const name of created) {
    assert.match(name, /^mwg-evidence-[a-f0-9]{64}\.txt$/);
    const current = await api.request(`/user/files/${name}`);
    assert.ok(current.ok);
    const bytes = Buffer.from(await current.arrayBuffer());
    assert.equal(`mwg-evidence-${createHash('sha256').update(bytes).digest('hex')}.txt`, name);
    assert.equal(JSON.parse(bytes).chatId, chatId);
    const response = await api.request('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: `user/files/${name}` }) });
    assert.equal(response.ok, true, 'remove only the verified synthetic file created by this test');
  }
}
writeFileSync('tmp/tavern-evidence-files-result.json', JSON.stringify({ ...result, syntheticFilesRemoved: true }, null, 2));
console.log('PASS local Tavern upload, authenticated static read, SHA-256 verification, fresh restore, exact export and synthetic-file cleanup');
