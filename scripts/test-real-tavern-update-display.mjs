import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createInitializedMvuLayer,
  createTavernApi,
  getCharacter,
  saveAndActivateCharacterChat,
} from './lib/tavern-api.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const [avatarUrl = `${releaseConfig.characterName}.png`] = process.argv.slice(2);
if (!avatarUrl.endsWith('.png')) {
  throw new Error('Usage: node scripts/test-real-tavern-update-display.mjs [avatar.png]');
}

const cards = [
  {
    id: 'resource_draw',
    name: '资源汲取',
    emoji: '🔹',
    type: 'Skill',
    rarity: 'Common',
    cost: 0,
    quantity: 3,
    description: '从周围空气中汲取轻微魔力，转化为可用的能量。',
    effects: { energy: 1 },
  },
  {
    id: 'energy_guard',
    name: '能量护盾',
    emoji: '🛡️',
    type: 'Skill',
    rarity: 'Common',
    cost: 1,
    quantity: 2,
    description: '展开由游离资源编织的半透明护盾。',
    effects: { block: 6 },
  },
  {
    id: 'energy_blast',
    name: '能量冲击',
    emoji: '🔸',
    type: 'Attack',
    rarity: 'Common',
    cost: 1,
    quantity: 3,
    description: '将汲取的资源凝为光束射向敌人。',
    effects: { damage: 7 },
  },
  {
    id: 'reserve_burst',
    name: '储备爆发',
    emoji: '💥',
    type: 'Attack',
    rarity: 'Uncommon',
    cost: 'energy',
    quantity: 1,
    description: '释放全部储备能量，绽放扇形冲击。',
    effects: { damage: 'spent_energy * 6' },
  },
  {
    id: 'charged_strike',
    name: '蓄能重击',
    emoji: '⚡',
    type: 'Attack',
    rarity: 'Uncommon',
    cost: 2,
    quantity: 2,
    description: '裹挟着储存资源砸向敌方，余波反哺自身。',
    effects: [{ damage: 12 }, { energy: 1 }],
  },
  {
    id: 'resource_cycle',
    name: '资源循环',
    emoji: '♻️',
    type: 'Skill',
    rarity: 'Uncommon',
    cost: 1,
    quantity: 1,
    description: '调动资源形成回流，抽取新的手牌。',
    effects: [{ draw: 1 }, { energy: 1 }],
  },
];

const artifact = {
  id: 'resource_sigil',
  name: '资源亲和徽记',
  rarity: 'Common',
  description: '公会认证的资源适性徽记，能让持有者在战斗之初就多一分余裕。',
  trigger: { on: 'battle_start', effects: { energy: 1 } },
};
const items = [
  {
    id: 'recovery_potion',
    name: '基础恢复药剂',
    count: 2,
    description: '异世界常见的草药合剂，能快速愈合小伤口。',
    effects: { heal: 8 },
  },
];
const playerLustEffect = {
  name: '欲望汲取',
  description: '敌方欲望满溢时，将溢出欲望转化为己方资源与生机。',
  effects: { energy: 1, heal: 4 },
};
const enemy = {
  name: '失控资源聚合体',
  emoji: '🌀',
  max_hp: 48,
  hp: 41,
  max_lust: 100,
  lust: 12,
  description: '被过量魔力吸引而来的不稳定聚合体。',
  actions: [{ name: '能量冲撞', weight: 1, description: '压缩能量后撞向敌方。', effects: { damage: 7 } }],
  abilities: [],
  status_effects: [],
  lust_effect: { name: '失控迸发', description: '满溢能量向敌方爆发。', effects: { damage: 6 } },
  action_mode: 'random',
  action_config: {},
};

function statData(withEnemy) {
  return {
    status: {
      time: '2027年02月21日 09:30',
      location: '起始之镇冒险者公会',
      profession: {
        name: '资源亲和者',
        ability: '汲取与储存环境中的魔力、体力乃至欲望等资源，并在需要时释放转化。',
      },
      permanent_status: [],
      temporary_status: [],
      outfit: {
        head: '',
        neck: '',
        hands: '',
        upper_body: '白色学园风制服上衣',
        lower_body: '深蓝色百褶短裙',
        underwear: '',
        legs: '',
        feet: '棕色制服鞋',
      },
      inventory: ['古旧羊皮纸卷轴'],
    },
    battle: {
      core: { emoji: '✨', hp: 100, max_hp: 100, lust: 0, max_lust: 100, card_removal_count: 1 },
      cards,
      artifacts: [artifact],
      items,
      statuses: [],
      player_abilities: [],
      player_status_effects: [],
      player_lust_effect: playerLustEffect,
      level: 1,
      exp: 0,
      enemy: withEnemy ? enemy : null,
    },
    factions: { player_alignment: '绝对中立', invasion: 0, relations: [] },
    npcs: {},
    reward: { card: [], artifact: [], item: [], limits: {} },
    run: null,
    run_result: null,
    run_upgrade: null,
  };
}

const updateBlock = `<UpdateVariable>
<Analysis>Update.</Analysis>
_.set('status.time', '2027年02月21日 09:30');
_.set('status.location', '起始之镇冒险者公会');
_.set('status.profession', {"name":"资源亲和者","ability":"汲取与储存环境中的魔力、体力乃至欲望等资源，并在需要时释放转化。"});
_.set('status.outfit', {"head":"","neck":"","hands":"","upper_body":"白色学园风制服上衣","lower_body":"深蓝色百褶短裙","underwear":"","legs":"","feet":"棕色制服鞋"});
_.set('status.inventory', ["古旧羊皮纸卷轴"]);
_.set('battle.core', {"emoji":"✨","hp":100,"max_hp":100,"lust":0,"max_lust":100,"card_removal_count":1});
_.set('battle.cards', ${JSON.stringify(cards)});
_.set('battle.artifacts', ${JSON.stringify([artifact])});
_.set('battle.items', ${JSON.stringify(items)});
_.set('battle.player_lust_effect', ${JSON.stringify(playerLustEffect)});
</UpdateVariable>`;
const battleUpdateBlock = `<UpdateVariable>
<Analysis>Update.</Analysis>
_.set('status.time', '2027年02月21日 09:40');
_.set('status.location', '起始之镇冒险者公会训练场');
_.set('battle.enemy', ${JSON.stringify(enemy)});
</UpdateVariable>`;

const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);
const api = await createTavernApi(tavernUrl);
const character = await getCharacter(api, avatarUrl);
const characterName = character?.name || character?.data?.name;
if (!characterName) throw new Error(`Character ${avatarUrl} has no name`);

const now = new Date();
const timestamp = now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const chatFile = `update-display-${releaseConfig.cardVersion}-${timestamp}`;
const worldbookName = `${releaseConfig.worldbookPrefix}${releaseConfig.cardVersion}`;
const layer = withEnemy => createInitializedMvuLayer(statData(withEnemy), worldbookName);
const chat = [
  {
    chat_metadata: { integrity: randomUUID(), variables: {}, tainted: true },
    user_name: '测试用户',
    character_name: characterName,
  },
  {
    name: '测试用户',
    is_user: true,
    is_system: false,
    send_date: now.toISOString(),
    mes: '建立一名资源亲和者，并整理初始卡组。',
    extra: {},
  },
  {
    name: characterName,
    is_user: false,
    is_system: false,
    send_date: now.toISOString(),
    mes: `公会的水晶亮起柔和光芒，初始能力与随身物品已经准备完成。\n${updateBlock}\n<StatusPlaceHolderImpl/>`,
    extra: {},
    variables: [layer(false)],
  },
  {
    name: '测试用户',
    is_user: true,
    is_system: false,
    send_date: now.toISOString(),
    mes: '走进训练场，迎战被惊动的聚合体。',
    extra: {},
  },
  {
    name: characterName,
    is_user: false,
    is_system: false,
    send_date: now.toISOString(),
    mes: `散落的魔力在训练场中央聚成旋涡，战斗随即爆发。\n${battleUpdateBlock}\n<BATTLE_START>\n<StatusPlaceHolderImpl/>`,
    extra: {},
    variables: [layer(true)],
  },
];

await saveAndActivateCharacterChat(api, { avatarUrl, characterName, chatFile, chat });

console.log(
  JSON.stringify(
    {
      avatarUrl,
      characterName,
      chatFile,
      ordinaryAssistantMessageId: 1,
      battleAssistantMessageId: 3,
      expectedUpdateCommandCounts: { ordinary: 10, battle: 3 },
      expectedViews: { ordinary: ['update', 'common'], battle: ['update', 'fish'] },
      modelCalls: 0,
    },
    null,
    2,
  ),
);
