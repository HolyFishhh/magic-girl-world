import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTavernApi } from './lib/tavern-api.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const tavernUrl = new URL(process.argv[2] || process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);
const cardPath = resolve(process.argv[3] || resolve(root, '魔法少女世界.png'));
const api = await createTavernApi(tavernUrl);
const card = await readFile(cardPath);
const form = new FormData();
form.append('file_type', 'png');
form.append('preserve_file_name', 'false');
form.append('avatar', new Blob([card], { type: 'image/png' }), basename(cardPath));

const importResponse = await api.request('/api/characters/import', {
  method: 'POST',
  body: form,
});
const responseText = await importResponse.text();
if (!importResponse.ok) throw new Error(`SillyTavern import failed: HTTP ${importResponse.status}\n${responseText}`);

const result = JSON.parse(responseText);
if (result.error || !result.file_name) throw new Error(`SillyTavern rejected the card: ${responseText}`);

const importedAvatar = `${result.file_name}.png`;
const settingsResponse = await api.request('/api/settings/get', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
if (!settingsResponse.ok) {
  throw new Error(`Card imported, but SillyTavern settings could not be read: HTTP ${settingsResponse.status}`);
}
const settingsEnvelope = await settingsResponse.json();
const settings = JSON.parse(settingsEnvelope.settings || '{}');
settings.extension_settings ||= {};
settings.extension_settings.character_allowed_regex ||= [];
if (!Array.isArray(settings.extension_settings.character_allowed_regex)) {
  throw new Error('Card imported, but extension_settings.character_allowed_regex is not an array');
}
settings.extension_settings.tavern_helper ||= {};
settings.extension_settings.tavern_helper.script ||= {};
settings.extension_settings.tavern_helper.script.enabled ||= {};
settings.extension_settings.tavern_helper.script.enabled.characters ||= [];
const enabledCharacterScripts = settings.extension_settings.tavern_helper.script.enabled.characters;
if (!Array.isArray(enabledCharacterScripts)) {
  throw new Error(
    'Card imported, but extension_settings.tavern_helper.script.enabled.characters is not an array',
  );
}

let settingsChanged = false;
if (!settings.extension_settings.character_allowed_regex.includes(importedAvatar)) {
  settings.extension_settings.character_allowed_regex.push(importedAvatar);
  settingsChanged = true;
}
if (!enabledCharacterScripts.includes(releaseConfig.characterName)) {
  enabledCharacterScripts.push(releaseConfig.characterName);
  settingsChanged = true;
}
if (settingsChanged) {
  const saveSettingsResponse = await api.request('/api/settings/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!saveSettingsResponse.ok) {
    throw new Error(`Card imported, but scoped regex permission could not be saved: HTTP ${saveSettingsResponse.status}`);
  }
}

console.log(`Imported character card as ${importedAvatar} at ${tavernUrl.origin}`);
console.log(`Enabled embedded character regexes for ${importedAvatar}`);
console.log(`Enabled Tavern Helper character scripts for ${releaseConfig.characterName}`);
