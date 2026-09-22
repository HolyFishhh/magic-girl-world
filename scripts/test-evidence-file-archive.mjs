import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { EvidenceFileStore, validEvidenceReference } = require('../src/sillytavern-extension/evidenceFileStore.ts');
const { TowerGenerationEvidence } = require('../src/sillytavern-extension/towerGenerationEvidence.ts');
const data = new Map(); let reads = 0, fail = false, corrupt = false;
const ports = {
  async upload(name, bytes) { if (fail) throw Error('offline'); data.set(name, new Uint8Array(bytes)); },
  async download(name) { reads++; const bytes = data.get(name); if (!bytes) throw Error('missing'); const value = new Uint8Array(bytes); if (corrupt) value[0] ^= 1; return value; },
};
const make = () => new TowerGenerationEvidence(new EvidenceFileStore(ports));
const evidence = make(); evidence.retainChat('volume');
const expected = [];
for (let index = 0; index < 32; index++) {
  const record = { chatId: 'volume', nodeId: 'node', requestId: `r${index}`, stage: 'outcome', recordedAt: index + 1,
    beforeMvuData: { text: 'x'.repeat(250000), n: index }, afterMvuData: { text: 'y'.repeat(250000), n: index + 1 } };
  expected.push(record); evidence.append(record);
}
const beforeBytes = Buffer.byteLength(JSON.stringify(evidence.metadataSnapshot('volume')));
let saves = 0; await evidence.archive('volume', () => saves++);
assert.equal(evidence.status('volume').error, ''); assert.equal(evidence.status('volume').pending, 0);
const persisted = JSON.parse(JSON.stringify(evidence.metadataSnapshot('volume')));
const afterBytes = Buffer.byteLength(JSON.stringify(persisted));
assert.ok(afterBytes < 32 * 1024, `${afterBytes} index bytes`);
assert.ok(afterBytes < beforeBytes / 100, 'metadata shrinks by more than 99% without truncation');
assert.ok(saves > 0);
const restored = make(); restored.retainChat('volume', persisted);
const beforeListReads = reads; const page = await restored.recent('volume', 5);
assert.equal(reads, beforeListReads, 'listing current index never reads record bodies');
assert.equal(page.records.length, 5); assert.equal(page.records[0].text, undefined);
assert.deepEqual(await restored.loadRecord('volume', page.records[0].key), expected.at(-1));
assert.deepEqual((await restored.snapshot('volume')).records, expected);

// Complete history remains accessible beyond the former 128-record eviction.
const paged = make(); paged.retainChat('paged'); const ordered = [];
for (let index = 0; index < 210; index++) {
  const record = { chatId: 'paged', nodeId: 'node', requestId: `r${Math.floor(index / 3)}`, stage: ['request', 'response', 'outcome'][index % 3], prompt: `完整内容 ${index}`, recordedAt: index };
  ordered.push(record); paged.append(record);
}
await paged.archive('paged', () => {});
const pagedIndex = paged.metadataSnapshot('paged');
assert.ok(pagedIndex.entries.length <= 64); assert.ok(pagedIndex.older);
const resumed = make(); resumed.retainChat('paged', JSON.parse(JSON.stringify(pagedIndex)));
assert.deepEqual((await resumed.snapshot('paged')).records, ordered);
assert.equal((await resumed.recent('paged', 210)).records.length, 210);

// UTF-8 chunk boundaries, corrupted files and cross-chat references.
const files = new EvidenceFileStore(ports), raw = '黑暗仪式👩‍🦰'.repeat(100000);
const reference = await files.write('utf8', { raw });
assert.ok(reference.parts.length > 1);
assert.equal((await new EvidenceFileStore(ports).read('utf8', reference)).raw, raw);
await assert.rejects(new EvidenceFileStore(ports).read('foreign', reference), /不属于当前聊天/);
assert.equal(validEvidenceReference({ ...reference, parts: [{ sha256: '../../settings', bytes: 1 }] }), false);
corrupt = true;
await assert.rejects(new EvidenceFileStore(ports).read('utf8', reference), /损坏/);
corrupt = false;

const failed = make(); failed.retainChat('failed');
const retained = { chatId: 'failed', nodeId: 'node', requestId: 'failure', stage: 'response', response: '必须保留原文', recordedAt: 1 };
failed.append(retained); fail = true; await failed.archive('failed', () => {});
assert.match(failed.status('failed').error, /offline/);
assert.deepEqual(failed.metadataSnapshot('failed').entries[0].inline, retained);
const retry = make(); retry.retainChat('failed', failed.metadataSnapshot('failed'));
fail = false; await retry.archive('failed', () => {}, true);
assert.equal(retry.status('failed').error, ''); assert.equal(retry.status('failed').pending, 0);
assert.deepEqual((await retry.snapshot('failed')).records, [retained]);

let release; const slow = new TowerGenerationEvidence(new EvidenceFileStore({ ...ports, upload: async (name, bytes) => { await new Promise(resolve => { release = resolve; }); return ports.upload(name, bytes); } }));
slow.retainChat('old'); slow.append({ ...retained, chatId: 'old' });
let staleSaves = 0; const pending = slow.archive('old', () => staleSaves++);
while (!release) await new Promise(resolve => setImmediate(resolve));
slow.retainChat('new'); release(); await pending;
assert.equal(staleSaves, 0); assert.equal(slow.status('new').total, 0);
assert.equal(await slow.snapshot('old'), null);

const invalid = { spec: 'unsupported', chatId: 'invalid', records: ['keep'] };
const damaged = make(); damaged.retainChat('invalid', invalid); damaged.append({ ...retained, chatId: 'invalid' });
assert.deepEqual(damaged.metadataSnapshot('invalid'), invalid);
await assert.rejects(damaged.snapshot('invalid'), /保留原数据/);
// The currently installed full format is only replaced after verified archiving.
const inline = make(); inline.retainChat('failed', { spec: 'mwg.tower-generation-evidence/v1', chatId: 'failed', retention: { droppedRecords: 2 }, records: [retained] });
assert.deepEqual((await inline.snapshot('failed')).records, [retained]);
await inline.archive('failed', () => {});
assert.equal(inline.metadataSnapshot('failed').droppedRecords, 2);

// Corrupt headers must not become a new writable empty history or bypass the
// aggregate export budget by declaring a smaller size than the indexed records.
const wrongSequence = structuredClone(persisted); wrongSequence.entries[0].sequence = 999;
const badSequence = make(); badSequence.retainChat('volume', wrongSequence);
badSequence.append({ ...retained, chatId: 'volume' });
assert.deepEqual(badSequence.metadataSnapshot('volume'), wrongSequence);
await assert.rejects(badSequence.snapshot('volume'), /保留原数据/);
const wrongBytes = structuredClone(persisted); wrongBytes.totalBytes = 0;
const badBytes = make(); badBytes.retainChat('volume', wrongBytes);
await assert.rejects(badBytes.snapshot('volume'), /总长度/);
const oversized = structuredClone(persisted); oversized.totalBytes = 65 * 1024 * 1024;
const budgeted = make(); budgeted.retainChat('volume', oversized);
await assert.rejects(budgeted.snapshot('volume'), /逐条下载/);
assert.deepEqual(await budgeted.loadRecord('volume', 'tower:1'), expected[0], 'individual originals remain readable when aggregate export exceeds its budget');

const report = { beforeBytes, afterBytes, reduction: 1 - afterBytes / beforeBytes, recordsRoundTripped: 32, pagedRecordsRoundTripped: 210, chunkedUnicodeCharacters: raw.length };
writeFileSync('tmp/evidence-file-archive-result.json', JSON.stringify(report, null, 2));
console.log('PASS evidence archive volume, exact save/restore/export, pagination, lazy list, Unicode, failures, integrity and chat isolation', JSON.stringify(report));
