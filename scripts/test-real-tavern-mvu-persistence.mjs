// A real HTTP/disk serialization probe, NOT browser/MVU-script or gameplay acceptance.
// Creates one isolated named chat without changing the selected character/chat.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createTavernApi, getSettings, getCharacter, getChat, saveChat } from './lib/tavern-api.mjs';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { ensureRunStateInStat } = require(resolve('src/runtime/runStateAdapter.ts'));
const { validateRunState } = require(resolve('src/game-core/runState.ts'));
const { TOWER_INITIAL_COMMIT_KEY, towerInitialStateDigest, readTowerInitialCommitReceipt, towerInitialStateKey } = require(resolve('src/sillytavern-extension/towerInitialCommit.ts'));
const { verifyTowerInitialPersistence } = require(resolve('src/sillytavern-extension/initialPersistence.ts'));
const api = await createTavernApi(process.env.TAVERN_URL || 'http://127.0.0.1:8012/');
const settings = await getSettings(api);
const avatar = settings.active_character;
assert.ok(avatar, 'an existing selected test character is required');
const character = await getCharacter(api, avatar);
assert.equal(character?.data?.extensions?.magic_girl_world?.design_assistant_scope, 'mwg.design-assistant-card/v1');
const currentChat = character.chat;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const activeChatBefore = currentChat ? hash(await getChat(api, avatar, currentChat)) : null;
const chatFile = `__codex_mvu_receipt_probe_${randomUUID()}`;
const stat = {
  game_mode: 'tower', game_mode_lock: { schemaVersion: 1, mode: 'tower' },
  status: { time: '序列化测试', location: '独立测试存档', profession: { name: '测试夹具', ability: '仅验证保存读回，不计为模型开局' } },
  battle: {
    core: { emoji: '🧪', hp: 37, max_hp: 60, lust: 9, max_lust: 100,
      resources: [{ id: 'probe_resource', name: '测试资源', emoji: '🔋', current: 2, max: 5, refresh: 'retain' }] },
    cards: [{ id: 'probe_card', name: '序列化测试卡', type: 'Attack', rarity: 'Common', cost: 1, quantity: 3, effects: { damage: 5 } }],
    statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [], level: 1, exp: 0,
  },
};
ensureRunStateInStat(stat, 170117);
stat.run.opening = {
  phase: 'ready', requestId: 'probe_opening', basedOnRevision: stat.run.stateRevision, attempts: 1,
  content: { title: '序列化测试', narrative: '此存档只测试保存读回。', choices: [1, 2, 3].map(n => ({ id: `probe_${n}`, label: `测试 ${n}`, outcome: { gold: n } })) },
  narrativePhase: 'ready', narrativeRequestId: 'probe_narrative',
};
assert.equal(validateRunState(stat.run).ok, true);
const lorebook = character.data.extensions.world;
assert.ok(typeof lorebook === 'string' && lorebook, 'fixture must acknowledge the selected character worldbook');
// The pinned MVU snapshot selector requires both stat_data AND schema. Without
// this technical root field, browser load treats the fixture as uninitialized.
const root = { stat_data: stat, schema: {}, initialized_lorebooks: { [lorebook]: [] }, display_data: {}, delta_data: {} };
root[TOWER_INITIAL_COMMIT_KEY] = {
  spec: 'mwg.tower-initial-commit/v1', chatId: chatFile, messageId: 0, generationId: 'probe_generation',
  narrative: '此存档用于验证保存读回，不代表真实模型或浏览器验收。', openingRequestId: 'probe_opening',
  runSeed: stat.run.seed, revision: stat.run.stateRevision, cardQuantity: 3,
  stateDigest: await towerInitialStateDigest(stat),
};
const message = { name: character.name, is_user: false, is_system: false, mes: root[TOWER_INITIAL_COMMIT_KEY].narrative,
  send_date: new Date().toISOString(), swipe_id: 0, variables: [root], extra: {} };
await saveChat(api, { ch_name: character.name, avatar_url: avatar, file_name: chatFile, chat: [
  { user_name: 'Codex persistence probe', character_name: character.name, chat_metadata: { mwg_test_only: true, variables: root } }, message,
] });
const readback = await getChat(await createTavernApi(api.tavernUrl), avatar, chatFile);
const saved = readback.find(entry => entry?.variables)?.variables?.[0];
assert.equal(towerInitialStateKey(saved), towerInitialStateKey(root), 'real save/get roundtrip preserves the entire variable root');
const receipt = readTowerInitialCommitReceipt(saved, chatFile, 0);
assert.equal(await towerInitialStateDigest(saved.stat_data), receipt.stateDigest);
await verifyTowerInitialPersistence({
  chatId: chatFile, characterId: 0, characters: [{ avatar, chat: chatFile }], getRequestHeaders: () => ({}),
}, { chatId: chatFile, messageId: 0, swipeId: 0, message: message.mes, variables: root, requireChatCache: true },
  (route, options) => api.request(route, options));
assert.equal((await getSettings(api)).active_character, avatar);
assert.equal((await getCharacter(api, avatar)).chat, currentChat);
if (currentChat) assert.equal(hash(await getChat(api, avatar, currentChat)), activeChatBefore, 'the selected chat was never overwritten');
const evidence = {
  spec: 'mwg.tavern-message-json-roundtrip/v1', checkedAt: new Date().toISOString(),
  avatar, fixtureChat: chatFile, selectedChatUnchanged: true,
  variableRootExact: true, receiptDigestVerified: true, productionReadbackVerifier: true, currentResources: 2, cardQuantity: 3,
  scope: 'Real Tavern HTTP save/get through a fresh CSRF session; NOT browser reload or execution of the installed MVU script; no model calls.',
};
await mkdir(resolve('tmp/real-tavern-persistence'), { recursive: true });
const evidencePath = resolve('tmp/real-tavern-persistence', `${chatFile}.json`);
await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
