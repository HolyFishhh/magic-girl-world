import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  createTavernApi,
  getCharacter,
  getChat,
  saveAndActivateCharacterChat,
} from './lib/tavern-api.mjs';

const releaseConfig = JSON.parse(await readFile(new URL('../release.config.json', import.meta.url), 'utf8'));
const [sourceAvatar, sourceChatFile, targetAvatar] = process.argv.slice(2);
if (!sourceAvatar?.endsWith('.png') || !sourceChatFile || !targetAvatar?.endsWith('.png')) {
  throw new Error('Usage: node scripts/copy-tavern-chat-fixture.mjs <source-avatar.png> <source-chat> <target-avatar.png>');
}

const api = await createTavernApi(new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl));
const [sourceChat, targetCharacter] = await Promise.all([
  getChat(api, sourceAvatar, sourceChatFile),
  getCharacter(api, targetAvatar),
]);
const targetCharacterName = targetCharacter?.name || targetCharacter?.data?.name;
const targetWorldbookName = targetCharacter?.data?.character_book?.name;
if (!Array.isArray(sourceChat) || !targetCharacterName || !targetWorldbookName) {
  throw new Error('The source chat or target character is unavailable');
}

const chat = structuredClone(sourceChat);
// SillyTavern orders the welcome-page recent-chat list by the last message
// timestamp, not by the copied file's filesystem time. Stamp the cloned tail
// so a newly created fixture is immediately reachable from the real UI.
const copiedAt = new Date().toISOString();
const copiedTail = [...chat].reverse().find(message => message && typeof message === 'object');
if (copiedTail) {
  copiedTail.send_date = copiedAt;
  copiedTail.gen_started = copiedAt;
  copiedTail.gen_finished = copiedAt;
}
const sourceCharacterNames = new Set(
  chat.filter(message => message && !message.is_user && message.name).map(message => message.name),
);
for (const message of chat) {
  if (!message || typeof message !== 'object') continue;
  if (!message.is_user && sourceCharacterNames.has(message.name)) message.name = targetCharacterName;
  if (message.character_name) message.character_name = targetCharacterName;
  const layers = Array.isArray(message.variables) ? message.variables : [message.variables];
  for (const layer of layers) {
    if (!layer?.initialized_lorebooks || typeof layer.initialized_lorebooks !== 'object') continue;
    for (const name of Object.keys(layer.initialized_lorebooks)) {
      if (name.startsWith(releaseConfig.worldbookPrefix)) delete layer.initialized_lorebooks[name];
    }
    layer.initialized_lorebooks[targetWorldbookName] = [];
  }
}
if (chat[0]?.chat_metadata) {
  chat[0].chat_metadata.integrity = randomUUID();
  chat[0].chat_metadata.tainted = true;
}

const timestamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const chatFile = `copied-ui-fixture-${timestamp}`;
await saveAndActivateCharacterChat(api, {
  avatarUrl: targetAvatar,
  characterName: targetCharacterName,
  chatFile,
  chat,
});
console.log(JSON.stringify({ sourceAvatar, sourceChatFile, targetAvatar, chatFile, messages: chat.length - 1 }, null, 2));
