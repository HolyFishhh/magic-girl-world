import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  createTavernApi,
  getCharacter,
  getChat,
  getSettings,
  saveAndActivateCharacterChat,
} from './lib/tavern-api.mjs';

const releaseConfig = JSON.parse(await readFile(new URL('../release.config.json', import.meta.url), 'utf8'));
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);
const api = await createTavernApi(tavernUrl);
const settings = await getSettings(api);
const avatarUrl = process.argv[2] || settings.active_character;
if (!avatarUrl?.endsWith('.png')) throw new Error('No active character card is available');

const character = await getCharacter(api, avatarUrl);
const characterName = character?.name || character?.data?.name;
const sourceChatFile = process.argv[3] || character?.chat || character?.data?.chat;
if (!characterName || !sourceChatFile) throw new Error('The active character has no reusable chat');

const sourceChat = await getChat(api, avatarUrl, sourceChatFile);
// A completed story response legitimately has no MVU variables of its own.
// Find the newest reusable battle floor instead of assuming the final chat
// entry is always a variable-bearing assistant message.
const reusableMessage = [...sourceChat].reverse().find(message => {
  const layers = Array.isArray(message?.variables) ? message.variables : [message?.variables];
  const selected = layers[message?.swipe_id || 0] || layers.at(-1);
  return Boolean(selected?.stat_data?.battle);
});
const sourceMessage = structuredClone(reusableMessage);
const sourceLayers = Array.isArray(sourceMessage?.variables)
  ? sourceMessage.variables
  : [sourceMessage?.variables];
const sourceLayer = sourceLayers[sourceMessage?.swipe_id || 0] || sourceLayers.at(-1);
if (!sourceLayer?.stat_data?.battle) throw new Error('The source chat has no reusable battle variables');

const layer = structuredClone(sourceLayer);
delete layer.__magic_girl_world;
layer.stat_data.game_mode = 'story';
layer.stat_data.game_mode_lock = { schemaVersion: 1, mode: 'story' };
layer.stat_data.run = null;
layer.stat_data.reward = { card: [], artifact: [], item: [], limits: {} };
layer.stat_data.status = {
  ...(layer.stat_data.status || {}),
  time: '战报回归测试 12:00',
  location: '终结记录训练场',
};

const battle = layer.stat_data.battle;
battle.core = {
  ...(battle.core || {}),
  emoji: '🌟',
  hp: 80,
  max_hp: 80,
  lust: 0,
  max_lust: 100,
  card_removal_count: Number(battle.core?.card_removal_count) || 1,
};
battle.cards = [
  {
    id: 'fixture_final_light',
    name: '最后之光',
    emoji: '☄️',
    type: 'Attack',
    rarity: 'Rare',
    cost: 1,
    quantity: 5,
    description: '用于确认击败敌人的最后一张牌会进入完整战报。',
    effects: { damage: 99 },
  },
];
battle.artifacts = [];
battle.items = [];
battle.player_abilities = [];
battle.statuses = [];
battle.player_status_effects = [];
// The source chat can carry an unfinished status reference in its lust effect.
// A UI fixture must be self-contained so an unrelated historical status cannot
// prevent the battle runtime from mounting before the terminal-card test runs.
battle.player_lust_effect = {
  name: '测试静默',
  description: '本次界面回归不触发额外效果。',
  effects: { block: 0 },
};
battle.enemies = [];
battle.enemy = {
  id: 'fixture_one_hp_target',
  name: '一息靶机',
  emoji: '🎯',
  hp: 1,
  max_hp: 1,
  lust: 0,
  max_lust: 100,
  block: 0,
  description: '只剩一口气的训练靶，用于验证终结卡牌是否被写入战斗摘要。',
  actions: [
    {
      id: 'fixture_wait',
      name: '等待终结',
      weight: 1,
      description: '靶机保持不动。',
      effects: { block: 0 },
    },
  ],
  abilities: [],
  status_effects: [],
  lust_effect: {
    name: '无效反馈',
    description: '训练靶发出无害的提示音。',
    effects: { block: 0 },
  },
  action_mode: 'sequence',
  action_config: { sequence: ['等待终结'] },
};
layer.display_data = structuredClone(layer.stat_data);

const messageText = '<BATTLE_START>\n\n<StatusPlaceHolderImpl/>';
sourceMessage.name = characterName;
sourceMessage.is_user = false;
sourceMessage.is_system = false;
sourceMessage.mes = messageText;
sourceMessage.swipes = [messageText];
sourceMessage.swipe_id = 0;
sourceMessage.variables = [layer];
sourceMessage.extra = { ...(sourceMessage.extra || {}) };
if (Array.isArray(sourceMessage.swipe_info)) sourceMessage.swipe_info = [sourceMessage.swipe_info[0] || {}];

const metadataMessage = structuredClone(sourceChat[0]);
metadataMessage.chat_metadata = {
  ...(metadataMessage.chat_metadata || {}),
  integrity: randomUUID(),
  tainted: true,
};
const timestamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const chatFile = `lethal-card-ui-e2e-${timestamp}`;
await saveAndActivateCharacterChat(api, {
  avatarUrl,
  characterName,
  chatFile,
  chat: [metadataMessage, sourceMessage],
});

console.log(
  JSON.stringify(
    {
      avatarUrl,
      characterName,
      sourceChatFile,
      chatFile,
      card: battle.cards[0].name,
      enemy: battle.enemy.name,
      modelCalls: 0,
    },
    null,
    2,
  ),
);
