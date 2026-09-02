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
const sourceMessage = structuredClone(sourceChat.at(-1));
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
  time: '压力测试 12:00',
  location: '镜像训练场',
};

const battle = layer.stat_data.battle;
battle.core = {
  ...(battle.core || {}),
  emoji: '🌟',
  hp: 72,
  max_hp: 90,
  lust: 18,
  max_lust: 100,
  card_removal_count: Number(battle.core?.card_removal_count) || 1,
};
if (!Array.isArray(battle.cards) || battle.cards.length === 0) {
  battle.cards = [
    {
      id: 'test_strike',
      name: '星辉连射',
      emoji: '✨',
      type: 'Attack',
      rarity: 'Rare',
      cost: 1,
      quantity: 5,
      description: '对敌方造成伤害。',
      effects: { damage: 8 },
    },
    {
      id: 'test_guard',
      name: '星幕守护',
      emoji: '🌌',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 1,
      quantity: 5,
      description: '获得格挡。',
      effects: { block: 7 },
    },
  ];
}
battle.statuses = [
  ...(Array.isArray(battle.statuses) ? battle.statuses : []),
  {
    id: 'shock',
    name: '感电',
    emoji: '⚡',
    type: 'debuff',
    description: '受到电流干扰。',
    maxStacks: 9,
    triggers: {},
  },
  {
    id: 'blind',
    name: '致盲',
    emoji: '🌫️',
    type: 'debuff',
    description: '视野受到干扰。',
    maxStacks: 9,
    triggers: {},
  },
];

function enemy(id, name, emoji, hp, action, statusEffects = [], abilities = []) {
  return {
    id,
    name,
    emoji,
    hp,
    max_hp: hp,
    lust: 0,
    max_lust: 100,
    description: `${name}是用于多敌人界面回归的训练投影。`,
    block: id === 'warden' ? 9 : 0,
    actions: [action],
    abilities,
    status_effects: statusEffects,
    lust_effect: {
      name: `${name}失控`,
      emoji: '💗',
      description: '失控后发动一次特色追击。',
      effects: { damage: 4 },
    },
    action_mode: 'sequence',
    action_config: { sequence: [action.name] },
  };
}

battle.enemies = [
  enemy(
    'vanguard',
    '星蚀前锋',
    '🦂',
    34,
    {
      name: '裂甲连刺',
      description: '连续突刺并削弱护甲。',
      weight: 1,
      effects: [{ damage: 4, hits: 3 }, { apply_status: 'shock', stacks: 2, to: 'opponent' }],
    },
    [{ id: 'shock', name: '感电', emoji: '⚡', stacks: 3, duration: 2 }],
  ),
  enemy(
    'warden',
    '棱镜守卫',
    '🛡️',
    48,
    {
      name: '折光壁垒',
      description: '为自身塑造护盾并积蓄反射。',
      weight: 1,
      effects: { block: 12 },
    },
    [],
    [
      {
        id: 'reflective_shell',
        name: '镜面核心',
        emoji: '🔷',
        description: '受到攻击时会积蓄反射能量。',
        trigger: { on: 'take_damage', effects: { block: 1 } },
      },
    ],
  ),
  enemy(
    'hexer',
    '暮色咒师',
    '🧙',
    29,
    {
      name: '双重蚀咒',
      description: '施加感电与致盲。',
      weight: 1,
      effects: [
        { apply_status: 'shock', stacks: 2, to: 'opponent' },
        { apply_status: 'blind', stacks: 1, to: 'opponent' },
      ],
    },
    [{ id: 'blind', name: '致盲', emoji: '🌫️', stacks: 1, duration: 3 }],
  ),
  enemy('artillery', '彗核炮台', '☄️', 40, {
    name: '彗核轰击',
    description: '蓄力后造成高额伤害。',
    weight: 1,
    effects: { damage: 17 },
  }),
  enemy('leech', '星髓汲取者', '🪼', 31, {
    name: '虹吸脉冲',
    description: '造成伤害并侵蚀心神。',
    weight: 1,
    effects: { damage: 6, lust: 8 },
  }),
];
delete battle.enemy;
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
const chatFile = `multi-enemy-ui-e2e-${timestamp}`;
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
      enemies: battle.enemies.map(value => value.name),
      modelCalls: 0,
    },
    null,
    2,
  ),
);
