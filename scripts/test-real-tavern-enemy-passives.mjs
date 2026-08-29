import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createInitializedMvuLayer,
  createTavernApi,
  getCharacter,
  getSettings,
  saveAndActivateCharacterChat,
} from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const { preflightBattleContent } = require(resolve(root, 'src/fish/core/battleContentPreflight.ts'));
const { convertMvuEnemy } = require(resolve(root, 'src/fish/core/mvuBattleAdapter.ts'));
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);
const api = await createTavernApi(tavernUrl);
const settings = await getSettings(api);
const avatarUrl = process.argv[2] || settings.active_character;
if (!avatarUrl?.endsWith('.png')) throw new Error('No active character card is available for the passive fixture');

const splitChild = {
  id: 'armor_larva',
  name: '碎甲幼体',
  emoji: '🪲',
  description: '甲壳破碎后孵化出的独立幼体，会自行行动并重新结壳。',
  max_hp: 16,
  hp: 16,
  max_lust: 100,
  lust: 0,
  actions: [
    { name: '幼体扑咬', description: '幼体向玩家发起扑咬。', weight: 2, effects: { damage: 4 } },
    { name: '蜷缩结壳', description: '幼体蜷缩身体保护自身。', weight: 1, effects: { block: 4 } },
  ],
  abilities: [
    {
      id: 'larva_shell',
      name: '再生甲壳',
      emoji: '🟤',
      source: '碎甲幼体',
      description: '每回合开始时，幼体生成一层薄甲。',
      trigger: { on: 'turn_start', effects: { block: 2 } },
    },
  ],
  status_effects: [],
  lust_effect: {
    name: '躁动啃噬',
    description: '幼体在欲望满溢时躁动地连续啃噬玩家。',
    effects: { damage: 5 },
  },
  action_mode: 'probability',
  action_config: { probability: { 幼体扑咬: 2, 蜷缩结壳: 1 } },
  count: 2,
  capacity: 6,
};

const battle = {
  core: { emoji: '🧙', hp: 72, max_hp: 80, lust: 8, max_lust: 100, card_removal_count: 1 },
  cards: [
    {
      id: 'split_fixture_finisher', name: '裂壳终结', emoji: '💥', type: 'Attack', rarity: 'Rare',
      cost: 0, quantity: 1, innate: true,
      description: '击破当前目标，使其死亡被动在正式结算流程中生成独立分裂体。',
      effects: { damage: 120 },
    },
    {
      id: 'split_fixture_focus', name: '定点星矢', emoji: '🎯', type: 'Attack', rarity: 'Common',
      cost: 0, quantity: 1, innate: true,
      description: '攻击当前选中的一个敌人。',
      effects: { damage: 3, targets: { mode: 'active' } },
    },
    {
      id: 'split_fixture_random', name: '游移星火', emoji: '🌠', type: 'Attack', rarity: 'Uncommon',
      cost: 0, quantity: 1, innate: true,
      description: '在存活敌人中随机选择一个目标。',
      effects: { damage: 3, targets: { mode: 'random' } },
    },
    {
      id: 'split_fixture_sweep', name: '星环震荡', emoji: '🌀', type: 'Attack', rarity: 'Rare',
      cost: 0, quantity: 1, innate: true,
      description: '对全部存活敌人同时造成伤害。',
      effects: { damage: 2, targets: { mode: 'all' } },
    },
    { id: 'probe_strike', name: '试探斩击', emoji: '⚔️', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
    { id: 'probe_guard', name: '稳固防御', emoji: '🛡️', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
  ],
  artifacts: [
    { id: 'observer_lens', name: '观察透镜', emoji: '🔎', rarity: 'Common', trigger: 'battle_start', effects: { block: 3 } },
  ],
  items: [{ id: 'field_tonic', name: '战地药剂', emoji: '🧪', count: 1, effects: { heal: 8 } }],
  statuses: [],
  player_abilities: [],
  player_status_effects: [],
  player_lust_effect: {
    name: '魔力震荡',
    description: '敌方欲望满溢时，玩家引爆积蓄的魔力。',
    effects: { damage: 7 },
  },
  level: 1,
  exp: 0,
  enemy: {
    id: 'carapace_beast',
    name: '裂甲母兽',
    emoji: '🪲',
    description: '拥有会自我修复的厚重甲壳，死亡后会孵化出新的幼体。',
    max_hp: 38,
    hp: 38,
    max_lust: 100,
    lust: 0,
    actions: [
      { name: '重角冲撞', description: '母兽用重角撞向玩家。', weight: 2, effects: { damage: 7 } },
      { name: '甲壳收束', description: '母兽收紧甲片保护自身。', weight: 1, effects: { block: 6 } },
    ],
    abilities: [
      {
        id: 'first_attack_shell',
        name: '应击甲壳',
        emoji: '🛡️',
        source: '裂甲母兽',
        description: '每回合首次受到攻击伤害后获得护甲。',
        trigger: {
          on: 'take_damage',
          scope: 'turn',
          ordinal: 'first',
          damage_type: 'attack',
          effects: { block: 4 },
        },
      },
      {
        id: 'split_on_defeat',
        name: '死亡孵化',
        emoji: '🥚',
        source: '裂甲母兽',
        description: '死亡并退场前，孵化两个拥有独立生命、行动与被动的幼体。',
        trigger: { on: 'defeated', effects: { spawn_enemy: splitChild } },
      },
    ],
    status_effects: [],
    lust_effect: {
      name: '狂躁冲锋',
      description: '母兽在欲望满溢时失控冲向玩家。',
      effects: { damage: 30 },
    },
    action_mode: 'probability',
    action_config: { probability: { 重角冲撞: 2, 甲壳收束: 1 } },
  },
};

const preflight = preflightBattleContent(battle);
assert.equal(preflight.ok, true, JSON.stringify(preflight.issues));
const converted = convertMvuEnemy(battle.enemy, () => 0);
assert.ok(converted);
assert.equal(converted.abilities.length, 2);
assert.deepEqual(converted.abilities.map(ability => ability.trigger), ['take_damage', 'defeated']);
assert.equal(converted.abilities[0].eventQuery?.scope, 'turn');
assert.equal(converted.abilities[0].eventQuery?.ordinal, 'first');
assert.equal(converted.abilities[0].eventQuery?.filter?.damageKind, 'attack');
assert.equal(converted.abilities[1].effectProgram.steps[0].op, 'spawn_enemy');

const character = await getCharacter(api, avatarUrl);
const characterName = character?.name || character?.data?.name;
if (!characterName) throw new Error(`Character ${avatarUrl} has no name`);
const now = new Date();
const timestamp = now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const chatFile = `enemy-passives-${timestamp}`;
const statData = {
  status: {
    time: '被动机制回归',
    location: '星空试炼场',
    profession: { name: '机制测试者', ability: '观察敌方被动、事件筛选与分裂流程。' },
    permanent_status: [], temporary_status: [], inventory: [],
    clothing: { head: '', neck: '', hands: '', upper_body: '', lower_body: '', underwear: '', legs: '', feet: '' },
  },
  battle,
  factions: { player_alignment: '绝对中立', invasion: 0, relations: [] },
  npcs: {},
  reward: { card: [], artifact: [], item: [], limits: {} },
  run: null, run_result: null, run_upgrade: null,
};
const variables = createInitializedMvuLayer(
  statData,
  `${releaseConfig.worldbookPrefix}${releaseConfig.cardVersion}`,
);
const chat = [
  {
    chat_metadata: { integrity: randomUUID(), variables: {}, tainted: true },
    user_name: 'unused', character_name: 'unused',
  },
  {
    name: characterName,
    is_user: false,
    is_system: false,
    send_date: now.toISOString(),
    mes: '敌方多被动与死亡分裂真实酒馆回归场景。\n<BATTLE_START>',
    extra: {},
    variables: [variables],
  },
];
await saveAndActivateCharacterChat(api, { avatarUrl, characterName, chatFile, chat });

console.log(JSON.stringify({
  ok: true,
  version: releaseConfig.cardVersion,
  avatarUrl,
  chatFile,
  enemy: battle.enemy.name,
  passives: battle.enemy.abilities.map(ability => ability.name),
  split: { enemy: splitChild.name, count: splitChild.count, passive: splitChild.abilities[0].name },
  preflightWarnings: preflight.warnings,
}, null, 2));
