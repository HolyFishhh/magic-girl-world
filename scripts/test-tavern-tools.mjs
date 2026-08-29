import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createInitializedMvuLayer,
  createTavernApi,
  editCharacterAttribute,
  getCharacter,
  getChat,
  getSettings,
  saveChat,
  saveSettings,
} from './lib/tavern-api.mjs';

const fixtureState = { battle: { enemy: { name: 'Fixture Enemy' } } };
const fixtureLayer = createInitializedMvuLayer(fixtureState, 'Fixture Worldbook');
assert.deepEqual(fixtureLayer.stat_data, fixtureState);
assert.notEqual(fixtureLayer.display_data, fixtureState);
assert.deepEqual(fixtureLayer.initialized_lorebooks, { 'Fixture Worldbook': [] });
assert.deepEqual(fixtureLayer.schema, {});

const originalFetch = globalThis.fetch;
const calls = [];
const responses = [
  {
    ok: true,
    status: 200,
    headers: {
      getSetCookie: () => ['session=abc; Path=/; HttpOnly', 'theme=dark; Path=/'],
      get: () => null,
    },
    json: async () => ({ token: 'csrf-test' }),
  },
  { ok: true, status: 200, json: async () => [{ mes: 'header' }] },
  { ok: true, status: 200, json: async () => ({ name: 'Test Character' }) },
  { ok: true, status: 200 },
  { ok: true, status: 200 },
  { ok: true, status: 200, json: async () => ({ settings: '{"active_character":"old.png"}' }) },
  { ok: true, status: 200 },
];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return responses.shift();
};

try {
  const api = await createTavernApi('http://127.0.0.1:8012/');
  const chat = await getChat(api, 'card.png', 'chat-file');
  const character = await getCharacter(api, 'card.png');
  await saveChat(api, { avatar_url: 'card.png', file_name: 'test', chat: [] });
  await editCharacterAttribute(api, {
    avatar_url: 'card.png',
    ch_name: 'Test Character',
    field: 'chat',
    value: 'test',
  });
  const settings = await getSettings(api);
  settings.active_character = 'card.png';
  await saveSettings(api, settings);
  assert.deepEqual(chat, [{ mes: 'header' }]);
  assert.deepEqual(character, { name: 'Test Character' });
  assert.equal(calls[0].url, 'http://127.0.0.1:8012/csrf-token');
  assert.equal(calls[1].url, 'http://127.0.0.1:8012/api/chats/get');
  assert.equal(calls[1].init.headers.get('X-CSRF-Token'), 'csrf-test');
  assert.equal(calls[1].init.headers.get('Cookie'), 'session=abc; theme=dark');
  assert.deepEqual(JSON.parse(calls[1].init.body), { avatar_url: 'card.png', file_name: 'chat-file' });
  assert.equal(calls[2].url, 'http://127.0.0.1:8012/api/characters/get');
  assert.equal(calls[3].url, 'http://127.0.0.1:8012/api/chats/save');
  assert.equal(calls[4].url, 'http://127.0.0.1:8012/api/characters/edit-attribute');
  assert.equal(calls[5].url, 'http://127.0.0.1:8012/api/settings/get');
  assert.equal(calls[6].url, 'http://127.0.0.1:8012/api/settings/save');
  assert.equal(JSON.parse(calls[6].init.body).active_character, 'card.png');
} finally {
  globalThis.fetch = originalFetch;
}

const [
  apiSource,
  importSource,
  snapshotSource,
  calibrationSource,
  startSource,
  readinessSource,
  battleRepairSource,
  webpackSource,
  devTavernSource,
] =
  await Promise.all([
    readFile(resolve('scripts/lib/tavern-api.mjs'), 'utf8'),
    readFile(resolve('scripts/import-tavern-card.mjs'), 'utf8'),
    readFile(resolve('scripts/test-real-tavern-corrupt-snapshot.mjs'), 'utf8'),
    readFile(resolve('scripts/calibrate-tavern-content.mjs'), 'utf8'),
    readFile(resolve('scripts/test-real-tavern-start.mjs'), 'utf8'),
    readFile(resolve('scripts/test-real-tavern-initial-readiness.mjs'), 'utf8'),
    readFile(resolve('scripts/test-real-tavern-battle-repair.mjs'), 'utf8'),
    readFile(resolve('webpack.config.ts'), 'utf8'),
    readFile(resolve('scripts/dev-tavern.mjs'), 'utf8'),
  ]);
for (const source of [importSource, snapshotSource, calibrationSource, startSource, readinessSource, battleRepairSource]) {
  assert.match(source, /from ['"].*lib\/tavern-api\.mjs['"]/);
  assert.doesNotMatch(source, /\/csrf-token|X-CSRF-Token|getSetCookie/);
}
assert.match(calibrationSource, /core\.analyzeContentDefinition\(/);
assert.match(calibrationSource, /core\.summarizeBuildBudget\(/);
assert.match(calibrationSource, /core\.assessEnemyBudget\(/);
assert.match(calibrationSource, /createContentPackFromMvuBattle\(/);
assert.doesNotMatch(calibrationSource, /core\.createContentPack\(/);
assert.doesNotMatch(calibrationSource, /relics:\s*battle\.artifacts|activeStatuses:\s*battle\.player_status_effects/);
assert.doesNotMatch(calibrationSource, /saveChat|\/api\/chats\/save/);
assert.doesNotMatch(calibrationSource, /TRIGGER_WEIGHTS|METRIC_KEYS|readLegacyMetric/);
assert.match(startSource, /saveAndActivateCharacterChat\(/);
assert.match(startSource, /scenario === 'historical'/);
assert.doesNotMatch(startSource, /saveChat\(|editCharacterAttribute\(|saveSettings\(/);
assert.match(readinessSource, /core\.assessInitialPlayerContent\(/);
assert.match(readinessSource, /createContentPackFromMvuBattle\(/);
assert.match(readinessSource, /saveAndActivateCharacterChat\(/);
assert.doesNotMatch(readinessSource, /saveChat\(|editCharacterAttribute\(|saveSettings\(/);
assert.match(battleRepairSource, /preflightBattleContent\(/);
assert.match(battleRepairSource, /saveAndActivateCharacterChat\(/);
assert.match(battleRepairSource, /mode = 'ordinary'/);
assert.match(battleRepairSource, /if \(mode !== 'run'\) return null/);
assert.doesNotMatch(battleRepairSource, /saveChat\(|editCharacterAttribute\(|saveSettings\(/);
assert.match(apiSource, /export async function saveAndActivateCharacterChat\(/);
assert.match(apiSource, /export function createInitializedMvuLayer\(/);
assert.match(apiSource, /await saveChat\(/);
assert.match(apiSource, /await editCharacterAttribute\(/);
assert.match(apiSource, /await saveSettings\(/);
assert.match(importSource, /tavern_helper\.script\.enabled\.characters/);
assert.match(importSource, /enabledCharacterScripts\.includes\(releaseConfig\.characterName\)/);
assert.match(importSource, /enabledCharacterScripts\.push\(releaseConfig\.characterName\)/);
assert.match(importSource, /settings\.active_character = importedAvatar/);
assert.match(importSource, /settings\.active_group = null/);
assert.match(webpackSource, /process\.argv\.includes\('--watch'\)/);
assert.match(webpackSource, /new Server\(port/);
assert.match(webpackSource, /io\.emit\('iframe_updated'\)/);
assert.match(devTavernSource, /'--watch'/);
assert.match(devTavernSource, /websocket listener/);

console.log('One Tavern HTTP boundary serves import, snapshot, calibration, start, readiness, and battle-repair fixtures.');
