import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTavernApi, getCharacter, getChat, saveAndActivateCharacterChat } from './lib/tavern-api.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const [sourceAvatar, sourceChatFile, targetAvatar = `${releaseConfig.characterName}.png`] = process.argv.slice(2);

if (!sourceAvatar?.endsWith('.png') || !sourceChatFile || !targetAvatar?.endsWith('.png')) {
  throw new Error(
    'Usage: node scripts/create-tavern-battle-fixture.mjs <source-avatar.png> <source-chat-file> [target-avatar.png]',
  );
}

const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);
const api = await createTavernApi(tavernUrl);
const [sourceChat, targetCharacter] = await Promise.all([
  getChat(api, sourceAvatar, sourceChatFile),
  getCharacter(api, targetAvatar),
]);
if (!Array.isArray(sourceChat) || sourceChat.length < 2) {
  throw new Error(`Source chat ${sourceChatFile} was not found or is empty`);
}

const targetCharacterName = targetCharacter?.name || targetCharacter?.data?.name;
if (!targetCharacterName) throw new Error(`Character ${targetAvatar} has no name`);
const targetWorldbookName =
  targetCharacter?.data?.character_book?.name || targetCharacter?.character_book?.name || null;

let chat = structuredClone(sourceChat);
const sourceCharacterNames = new Set(
  chat.filter(message => message && !message.is_user && message.name).map(message => message.name),
);
for (const message of chat) {
  if (!message || typeof message !== 'object') continue;
  if (!message.is_user && sourceCharacterNames.has(message.name)) message.name = targetCharacterName;
  if (message.character_name) message.character_name = targetCharacterName;

  // A copied MVU snapshot must already acknowledge the target card's embedded
  // lorebook. Otherwise MVU treats the fixture as an uninitialized chat and
  // writes a fresh default layer over the restorable battle session.
  if (targetWorldbookName) {
    const layers = Array.isArray(message.variables) ? message.variables : [message.variables];
    for (const layer of layers) {
      if (!layer || typeof layer !== 'object' || !layer.initialized_lorebooks) continue;
      const initialized = layer.initialized_lorebooks;
      for (const worldbookName of Object.keys(initialized)) {
        if (worldbookName.startsWith(releaseConfig.worldbookPrefix)) delete initialized[worldbookName];
      }
      initialized[targetWorldbookName] = [];
    }
  }
}

const metadata = chat[0]?.chat_metadata;
if (metadata && typeof metadata === 'object') {
  metadata.integrity = randomUUID();
  metadata.tainted = true;
}

const battleMessageIndex = [...chat]
  .map((message, index) => ({ message, index }))
  .reverse()
  .find(({ message }) => {
    const layers = Array.isArray(message?.variables) ? message.variables : [message?.variables];
    return layers.some(layer => layer?.stat_data?.battle?.enemy);
  })?.index;
if (!Number.isInteger(battleMessageIndex)) {
  throw new Error(`Source chat ${sourceChatFile} has no message containing a battle enemy`);
}

if (process.env.BATTLE_FIXTURE_COMPACT === '1') {
  const metadataMessage = structuredClone(chat[0]);
  const battleMessage = structuredClone(chat[battleMessageIndex]);
  const sourceSwipeId = Math.max(0, Math.floor(Number(battleMessage.swipe_id) || 0));
  const variableLayers = Array.isArray(battleMessage.variables) ? battleMessage.variables : [battleMessage.variables];
  const activeBattleLayer =
    variableLayers[sourceSwipeId] ||
    [...variableLayers]
      .reverse()
      .find(layer => layer?.__magic_girl_world?.battle_session?.state || layer?.stat_data?.battle?.enemy);
  if (!activeBattleLayer) throw new Error('The source battle fixture has no active battle variable layer');
  const fixtureText = `战斗 UI 验收夹具 ${releaseConfig.cardVersion}\n\n<BATTLE_START>\n\n<StatusPlaceHolderImpl/>`;
  battleMessage.mes = fixtureText;
  battleMessage.swipes = [fixtureText];
  battleMessage.swipe_id = 0;
  battleMessage.variables = [structuredClone(activeBattleLayer)];
  if (Array.isArray(battleMessage.swipe_info)) {
    battleMessage.swipe_info = [
      structuredClone(battleMessage.swipe_info[sourceSwipeId] || battleMessage.swipe_info[0]),
    ];
  }
  if (metadataMessage?.chat_metadata) metadataMessage.chat_metadata.lastInContextMessageId = 0;
  chat = [metadataMessage, battleMessage];
}

const terminalResult = process.env.BATTLE_FIXTURE_RESULT;
if (terminalResult && ['active', 'victory', 'defeat', 'terminated'].includes(terminalResult)) {
  const battleMessage = chat.at(-1);
  const layers = Array.isArray(battleMessage?.variables) ? battleMessage.variables : [battleMessage?.variables];
  const variableLayer = [...layers].reverse().find(layer => layer?.__magic_girl_world?.battle_session?.state);
  const state = variableLayer?.__magic_girl_world?.battle_session?.state;
  if (!state) throw new Error('The source battle fixture has no restorable battle session');
  if (terminalResult === 'active') {
    state.phase = 'player_turn';
    state.isGameOver = false;
    state.battleResult = 'ongoing';
    state.battleNarrative = '';
    if (state.player) {
      state.player.currentHp = Math.max(1, Number(state.player.currentHp) || Number(state.player.maxHp) || 1);
      state.player.energy = Math.max(1, Number(state.player.energy) || Number(state.player.maxEnergy) || 3);
    }
    if (state.enemy)
      state.enemy.currentHp = Math.max(1, Number(state.enemy.maxHp) || Number(state.enemy.currentHp) || 1);
  } else {
    state.phase = 'game_over';
    state.isGameOver = true;
    state.battleResult = terminalResult;
    state.battleNarrative =
      terminalResult === 'victory'
        ? '敌人倒下，战场恢复平静。'
        : terminalResult === 'defeat'
          ? '玩家失去继续战斗的能力。'
          : '双方暂时脱离战斗。';
    if (terminalResult === 'victory' && state.enemy) state.enemy.currentHp = 0;
    if (terminalResult === 'defeat' && state.player) state.player.currentHp = 0;
    state.battleHistory = [
      { turn: 1, type: 'action', message: '玩家使用攻击牌', actor: 'player', actionName: '灰爪撕咬' },
      { turn: 1, type: 'action', message: '敌人发动攻击', actor: 'enemy', actionName: '粉晶辉击' },
      { turn: 1, type: 'action', message: '遗物触发', source: { type: 'relic', name: '狼鬃指环' } },
      { turn: 2, type: 'action', message: '玩家使用攻击牌', actor: 'player', actionName: '灰爪撕咬' },
      { turn: 2, type: 'action', message: '玩家使用防御牌', actor: 'player', actionName: '契约护盾' },
      { turn: 2, type: 'action', message: '敌人发动能力', actor: 'enemy', actionName: '爱之魔光' },
    ];
  }
}

const timestamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replace(/\.\d{3}Z$/, 'Z');
const chatFile = `battle-ui-fixture-${releaseConfig.cardVersion}-${timestamp}`;
await saveAndActivateCharacterChat(api, {
  avatarUrl: targetAvatar,
  characterName: targetCharacterName,
  chatFile,
  chat,
});

console.log(
  JSON.stringify(
    {
      sourceAvatar,
      sourceChatFile,
      targetAvatar,
      targetCharacterName,
      targetWorldbookName,
      chatFile,
      messages: chat.length - 1,
      battleMessageId: process.env.BATTLE_FIXTURE_COMPACT === '1' ? 0 : battleMessageIndex - 1,
      compact: process.env.BATTLE_FIXTURE_COMPACT === '1',
      terminalResult: terminalResult || null,
      modelCalls: 0,
    },
    null,
    2,
  ),
);
