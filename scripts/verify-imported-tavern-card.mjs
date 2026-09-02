import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createTavernApi, getCharacter, getSettings } from './lib/tavern-api.mjs';

const releaseConfig = JSON.parse(await readFile(new URL('../release.config.json', import.meta.url), 'utf8'));
const worldbookManifest = JSON.parse(await readFile(new URL('../worldbook_new/manifest.json', import.meta.url), 'utf8'));
const tavernUrl = process.argv[2] || process.env.TAVERN_URL || releaseConfig.defaultTavernUrl;
const api = await createTavernApi(tavernUrl);
const settings = await getSettings(api);
const avatar = process.argv[3] || settings.active_character;
assert.ok(avatar, 'SillyTavern has no active character to verify');
const character = await getCharacter(api, avatar);
const extensions = character?.data?.extensions || character?.extensions || {};
const worldbook = character?.data?.character_book || character?.character_book;
const regexes = extensions.regex_scripts || [];
const scripts = (extensions?.tavern_helper?.scripts || []).filter(entry => entry?.type === 'script');

assert.equal(
  extensions.magic_girl_world?.design_assistant_scope,
  'mwg.design-assistant-card/v1',
  'imported card must opt into the design assistant explicitly',
);

assert.equal(character?.name || character?.data?.name, releaseConfig.characterName);
assert.equal(character?.data?.character_version, releaseConfig.cardVersion);
assert.equal(
  character?.data?.creator_notes,
  '剧情模式可直接开始游玩；角色卡已内置世界书、MVU 变量框架与交互界面。爬塔模式需要另行安装 0.3.3 或更高版本的“魔法少女世界设计辅助器”扩展。',
);
assert.equal(worldbook?.name, `${releaseConfig.worldbookPrefix}${releaseConfig.cardVersion}`);
assert.equal(
  worldbook?.entries?.length || 0,
  Object.keys(worldbookManifest).length,
  'embedded worldbook entry count drifted from the source manifest',
);
assert.equal(regexes.length, 7, 'embedded character regex count drifted');
assert.equal(scripts.length, 2, 'embedded character script count drifted');
assert.equal(settings.active_character, avatar);
assert.ok(settings?.extension_settings?.character_allowed_regex?.includes(avatar));
assert.ok(settings?.extension_settings?.tavern_helper?.script?.enabled?.characters?.includes(releaseConfig.characterName));

console.log(JSON.stringify({
  name: character?.name || character?.data?.name,
  version: character?.data?.character_version,
  worldbook: worldbook?.name,
  entries: worldbook?.entries?.length || 0,
  regexes: regexes.length,
  scripts: scripts.map(entry => entry.name || entry.scriptName),
  active: settings.active_character,
  regexAllowed: true,
  scriptAllowed: true,
}, null, 2));
