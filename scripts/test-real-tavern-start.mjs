import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTavernApi, getCharacter, saveAndActivateCharacterChat } from './lib/tavern-api.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const [avatarUrl, scenario = 'latest'] = process.argv.slice(2);
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);

if (!avatarUrl?.endsWith('.png')) throw new Error('Usage: node scripts/test-real-tavern-start.mjs <avatar.png> [latest|historical]');
if (!['latest', 'historical'].includes(scenario)) throw new Error('Scenario must be latest or historical');

const api = await createTavernApi(tavernUrl);
const character = await getCharacter(api, avatarUrl);
const characterName = character?.name || character?.data?.name;
if (!characterName) throw new Error(`Character ${avatarUrl} has no name`);
const firstMessage = character?.data?.first_mes || character?.first_mes || '[开始游戏]';

const now = new Date();
const timestamp = now
  .toISOString()
  .replaceAll(':', '-')
  .replace(/\.\d{3}Z$/, 'Z');
const chatFile = `start-runtime-${scenario}-${timestamp}`;
const chat = [
  {
    chat_metadata: { integrity: randomUUID(), variables: {}, tainted: true },
    user_name: 'unused',
    character_name: 'unused',
  },
  {
    name: characterName,
    is_user: false,
    is_system: false,
    send_date: now.toISOString(),
    mes: firstMessage,
    extra: {},
  },
];
if (scenario === 'historical') {
  chat.push({
    name: '测试用户',
    is_user: true,
    is_system: false,
    send_date: now.toISOString(),
    mes: '后续消息：开始页应停止渲染。',
    extra: {},
  });
}

await saveAndActivateCharacterChat(api, { avatarUrl, characterName, chatFile, chat });

console.log(
  JSON.stringify(
    {
      avatarUrl,
      chatFile,
      scenario,
      expectedUi: {
        runtimeVersion: releaseConfig.cardVersion,
        messageIframes: scenario === 'latest' ? 1 : 0,
        root: scenario === 'latest' ? '.magical-girl-creator' : null,
        createButtonInitiallyDisabled: false,
        defaultMode: scenario === 'latest' ? 'story' : null,
        towerModeDisabled: false,
        optionalFields: ['角色名', '角色形象', '世界观', '身份', '开场时机', '卡牌体系', '额外要求'],
        towerDifficultyPercent: scenario === 'latest' ? 80 : null,
        presetCounts: scenario === 'latest' ? { worlds: 12, cards: 12 } : null,
        modelCalls: 0,
      },
    },
    null,
    2,
  ),
);
