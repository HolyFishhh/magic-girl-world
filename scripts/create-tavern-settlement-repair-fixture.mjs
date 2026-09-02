import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createTavernApi, getCharacter, getChat, saveAndActivateCharacterChat } from './lib/tavern-api.mjs';

const releaseConfig = JSON.parse(await readFile(new URL('../release.config.json', import.meta.url), 'utf8'));
const [avatarUrl, sourceChatFile] = process.argv.slice(2);
if (!avatarUrl?.endsWith('.png') || !sourceChatFile) {
  throw new Error('Usage: node scripts/create-tavern-settlement-repair-fixture.mjs <avatar.png> <source-chat>');
}

const api = await createTavernApi(new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl));
const [sourceChat, character] = await Promise.all([
  getChat(api, avatarUrl, sourceChatFile),
  getCharacter(api, avatarUrl),
]);
if (!Array.isArray(sourceChat) || sourceChat.length < 2) throw new Error('Source chat is unavailable');
const characterName = character?.name || character?.data?.name;
if (!characterName) throw new Error('Target character is unavailable');

const chat = structuredClone(sourceChat);
const message = [...chat].reverse().find(entry => entry && !entry.is_user && Array.isArray(entry.variables));
if (!message) throw new Error('Source chat has no assistant message with MVU variables');
const swipeId = Math.max(0, Math.floor(Number(message.swipe_id) || 0));
const variables = message.variables[swipeId] || message.variables[0];
const stat = variables?.stat_data;
if (!stat?.battle) throw new Error('Source chat has no stat_data.battle');

stat.battle.cards = (Array.isArray(stat.battle.cards) ? stat.battle.cards : [])
  .filter(card => card?.id !== 'eclipse_scar' && card?.id !== 'reload_eclipse_scar');
stat.reward = {
  card: [{ id: 'stale-card' }],
  artifact: [{ id: 'stale-artifact' }],
  item: [{ id: 'stale-item' }],
  limits: { cards: 1, items: 1 },
  request: {
    marker: '[MVU_BATTLE_SETTLEMENT]',
    result: 'defeat',
    penalty: true,
    enemy: { names: ['星蚀前锋', '棱镜守卫', '暮色咒师', '彗核炮台', '星髓汲取者'] },
  },
};

message.mes = String(message.mes || '')
  .replace(/\s*\[MWG_REPAIR_REQUEST_BEGIN\][\s\S]*?\[MWG_REPAIR_REQUEST_END\]\s*/g, '\n')
  .replace(/\s*<UpdateVariable>[\s\S]*?<\/UpdateVariable>\s*/gi, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
if (Array.isArray(message.swipes)) message.swipes[swipeId] = message.mes;

if (chat[0]?.chat_metadata) {
  chat[0].chat_metadata.integrity = randomUUID();
  chat[0].chat_metadata.tainted = true;
}
const timestamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const chatFile = `settlement-repair-fixture-${releaseConfig.cardVersion}-${timestamp}`;
await saveAndActivateCharacterChat(api, { avatarUrl, characterName, chatFile, chat });
console.log(JSON.stringify({ avatarUrl, sourceChatFile, chatFile, messageId: chat.indexOf(message) - 1 }, null, 2));
