import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { verifyTowerInitialPersistence } = require(resolve('src/sillytavern-extension/initialPersistence.ts'));
const { TOWER_INITIAL_PUBLICATION_KEY } = require(resolve('src/sillytavern-extension/towerInitialCommit.ts'));
const root = { stat_data: { battle: { cards: [{ id: 'one', quantity: 3 }] } }, mwg_tower_initial_commit: { generationId: 'g1' } };
const expected = { chatId: 'exact-chat', messageId: 0, swipeId: 1, message: '正文', variables: root, requireChatCache: true };
const context = { chatId: 'exact-chat', characterId: 0, characters: [{ avatar: 'char.png', chat: 'exact-chat' }], getRequestHeaders: () => ({ 'X-CSRF-Token': 'fixture-only' }) };
const records = () => [{ chat_metadata: { variables: structuredClone(root) } }, { mes: '正文', is_user: false, swipe_id: 1, variables: [{ other: true }, structuredClone(root)] }];
let requests = 0;
const responder = payload => async (url, options) => {
  requests++;
  assert.equal(url, '/api/chats/get'); assert.equal(options.cache, 'no-store');
  assert.deepEqual(JSON.parse(options.body), { avatar_url: 'char.png', file_name: 'exact-chat' });
  return { ok: true, json: async () => payload };
};
await verifyTowerInitialPersistence(context, expected, responder(records()));
const publication = { spec:'mwg.tower-initial-publication/v1', chatId:'exact-chat',messageId:0,swipeId:1,generationId:'g1',stateDigest:'a'.repeat(64) };
await assert.rejects(verifyTowerInitialPersistence(context, {...expected, publication}, responder(records())), /磁盘读回/);
const publishedRecords = records(); publishedRecords[0].chat_metadata[TOWER_INITIAL_PUBLICATION_KEY] = publication;
await verifyTowerInitialPersistence(context, {...expected, publication}, responder(publishedRecords));
await assert.rejects(verifyTowerInitialPersistence(context, {...expected, publication:{...publication,swipeId:0}}, responder(publishedRecords)), /磁盘读回/);
await verifyTowerInitialPersistence(context, { ...expected, requireChatCache: false }, responder(records().slice(1)));
for (const mutate of [
  r => { r[1].mes = '旧正文'; }, r => { r[1].variables[1] = {}; },
  r => { r[1].swipe_id = 0; }, r => { r[0].chat_metadata.variables = {}; },
  r => { r[1].variables[1].mwg_tower_initial_commit.generationId = 'old'; },
]) { const data = records(); mutate(data); await assert.rejects(verifyTowerInitialPersistence(context, expected, responder(data)), /磁盘读回/); }
await assert.rejects(verifyTowerInitialPersistence(context, expected, async () => ({ ok: false, status: 503 })), /HTTP 503/);
await assert.rejects(verifyTowerInitialPersistence(context, expected, async () => { throw new Error('offline'); }), /offline.*不会重新生成/);
await assert.rejects(verifyTowerInitialPersistence(context, expected, async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } })), /invalid JSON.*不会重新生成/);
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let fireTimeout;
let cleared = 0;
try {
  globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 15_000); fireTimeout = callback; return 17; };
  globalThis.clearTimeout = id => { assert.equal(id, 17); cleared++; };
  await assert.rejects(verifyTowerInitialPersistence(context, expected, async (_url, options) => {
    fireTimeout(); assert.equal(options.signal.aborted, true); throw new Error('aborted');
  }), /读回超时.*不会重新生成/);
  assert.equal(cleared, 1, 'timeout is cleared even after a failed read');
} finally { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; }
const beforeInvalid = requests;
await assert.rejects(verifyTowerInitialPersistence({ ...context, chatId: 'other' }, expected, responder(records())), /宿主/);
await assert.rejects(verifyTowerInitialPersistence({ ...context, characters: [{ avatar: 'other.png', chat: 'different' }] }, expected, responder(records())), /保存目标/);
assert.equal(requests, beforeInvalid, 'invalid scope is rejected without requesting another save');
console.log('Initial persistence verifies exact saved story, selected swipe, complete variable root and chat cache; swallowed host-save failures cannot pass readback.');
