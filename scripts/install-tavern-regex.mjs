import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const settingsPath = process.argv[2] ? resolve(process.argv[2]) : null;
const payloadPath = resolve(root, 'dist/tavern/fish-interface.json');

if (!settingsPath) {
  throw new Error('Usage: npm run install:tavern-regex -- <path-to-SillyTavern-settings.json>');
}

const [settingsText, payloadText] = await Promise.all([
  readFile(settingsPath, 'utf8'),
  readFile(payloadPath, 'utf8'),
]);
const settings = JSON.parse(settingsText.replace(/^\uFEFF/, ''));
const payload = JSON.parse(payloadText);

settings.extension_settings ||= {};
settings.extension_settings.regex ||= [];
if (!Array.isArray(settings.extension_settings.regex)) {
  throw new Error('SillyTavern extension_settings.regex is not an array');
}

const matches = settings.extension_settings.regex
  .map((entry, index) => ({ entry, index }))
  .filter(({ entry }) => entry?.scriptName === payload.scriptName);
if (matches.length > 1) {
  throw new Error(`Found ${matches.length} global regexes named "${payload.scriptName}"; refusing an ambiguous update`);
}

if (matches.length === 1) {
  const { entry, index } = matches[0];
  settings.extension_settings.regex[index] = { ...payload, id: entry.id || payload.id };
} else {
  settings.extension_settings.regex.push(payload);
}

await writeFile(settingsPath, `${JSON.stringify(settings, null, 4)}\n`, 'utf8');
console.log(`${matches.length ? 'Updated' : 'Installed'} Tavern regex in ${settingsPath}`);
