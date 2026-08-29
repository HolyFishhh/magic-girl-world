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
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);
const api = await createTavernApi(tavernUrl);
const settings = await getSettings(api);
const avatarUrl = process.argv[2] || settings.active_character;
if (!avatarUrl?.endsWith('.png')) throw new Error('No active character card is available for the summon fixture');

const guardian = {
  id: 'selector_guardian',
  name: '星辉守卫',
  emoji: '🛡️',
  description: '最先入场的有生命守卫，会优先援护召唤者。',
  max_hp: 14,
  block: 2,
  resources: {
    charge: { id: 'charge', name: '充能', emoji: '⚡', current: 1, max: 6, refresh: 'retain' },
  },
  actions: [
    { id: 'guardian_bash', name: '守卫冲击', emoji: '💥', weight: 1, effects: { damage: 3 } },
  ],
  abilities: [
    {
      id: 'guardian_departure',
      name: '离场回响',
      emoji: '✨',
      description: '离场时为召唤者留下护盾。',
      trigger: { on: 'defeated', effects: { summoner_effects: { block: 2 } } },
    },
  ],
};

const orb = {
  id: 'selector_orb',
  name: '无形星核',
  emoji: '🔮',
  description: '没有生命，不会受伤，也不会替召唤者承受攻击。',
  has_hp: false,
  actions: [
    {
      id: 'orb_pulse',
      name: '固定脉冲',
      emoji: '🌀',
      weight: 1,
      fixed: true,
      effects: [
        { damage: 2 },
        { summoner_effects: { energy: 1 } },
      ],
    },
  ],
};

const striker = {
  id: 'selector_striker',
  name: '逐光兽',
  emoji: '🐺',
  description: '拥有独立行动的有生命召唤物。',
  max_hp: 9,
  actions: [
    { id: 'striker_bite', name: '追光撕咬', emoji: '🦷', weight: 1, effects: { damage: 4 } },
  ],
};

const selector = (pick, count) => ({ owner: 'self', pick, ...(count ? { count } : {}) });
const battle = {
  core: { emoji: '🧙', hp: 76, max_hp: 80, lust: 5, max_lust: 100, card_removal_count: 1 },
  cards: [
    {
      id: 'copy_chosen_summon', name: '镜像契约', emoji: '🪞', type: 'Skill', rarity: 'Rare',
      cost: 0, quantity: 1, innate: true,
      description: '选择一个召唤物，复制其当前能力、状态、资源与强化。',
      effects: { copy_summon: { selector: selector('choose'), to: 'self' } },
    },
    {
      id: 'dismiss_chosen_summon', name: '召回契约', emoji: '↩️', type: 'Skill', rarity: 'Uncommon',
      cost: 0, quantity: 1, innate: true,
      description: '选择一个召唤物离场，并触发它的离场能力。',
      effects: { dismiss_summon: { selector: selector('choose') } },
    },
    {
      id: 'activate_random_summons', name: '群星号令', emoji: '🌠', type: 'Skill', rarity: 'Uncommon',
      cost: 0, quantity: 1, innate: true,
      description: '随机选择两个召唤物立即行动。',
      effects: [
        { activate_summon: { selector: selector('random_n', 2) } },
        { damage: 1 },
      ],
    },
    {
      id: 'heal_right_summon', name: '右列修复', emoji: '🩹', type: 'Skill', rarity: 'Common',
      cost: 0, quantity: 1, innate: true,
      description: '恢复最右侧有生命召唤物的生命。',
      effects: { heal_summon: { selector: selector('right'), amount: 3 } },
    },
    {
      id: 'enhance_left_summon', name: '左列增幅', emoji: '📈', type: 'Skill', rarity: 'Uncommon',
      cost: 0, quantity: 1, innate: true,
      description: '强化最左侧召唤物行动与能力中的伤害数值。',
      effects: { modify_summon_effect: { selector: selector('left'), stat: 'damage', add: 2 } },
    },
  ],
  artifacts: [
    {
      id: 'expanded_circle', name: '扩展召唤环', emoji: '⭕', rarity: 'Rare',
      description: '召唤容量增加一点。',
      trigger: { on: 'passive', effects: { modify: 'summon_capacity', add: 1 } },
    },
    {
      id: 'selector_fixture_roster', name: '回归测试契约', emoji: '📜', rarity: 'Common',
      description: '战斗开始时部署三种不同召唤物，并为最左侧召唤物准备可复制状态。',
      trigger: {
        on: 'battle_start',
        effects: [
          { spawn_summon: { ...guardian, capacity: 3 } },
          { spawn_summon: { ...orb, capacity: 3 } },
          { spawn_summon: { ...striker, capacity: 3 } },
          { apply_summon_status: { selector: selector('left'), id: 'summon_focus', stacks: 2 } },
          { summon_resource: { selector: selector('left'), id: 'charge', amount: 2 } },
          { modify_summon_effect: { selector: selector('left'), stat: 'damage', add: 2 } },
        ],
      },
    },
  ],
  items: [],
  statuses: [
    {
      id: 'summon_focus', name: '召唤聚焦', emoji: '🎯', type: 'buff',
      description: '该召唤物造成的伤害随层数提高。',
      triggers: { hold: { modify: 'damage', add: 'stacks' } },
      maxStacks: 9,
    },
  ],
  player_abilities: [],
  player_status_effects: [],
  player_lust_effect: {
    name: '契约超载', description: '欲望满溢时，所有召唤物立刻行动一次。',
    effects: { activate_summon: { selector: selector('all') } },
  },
  level: 1,
  exp: 0,
  enemy: {
    id: 'selector_dummy', name: '星尘训练偶', emoji: '🎯',
    description: '用于真实酒馆召唤选择器回归验证的耐久训练偶。',
    max_hp: 160, hp: 160, max_lust: 100, lust: 0,
    actions: [
      { name: '缓慢拍击', weight: 1, description: '以固定节奏发动单体攻击。', effects: { damage: 3 } },
    ],
    abilities: [], status_effects: [],
    lust_effect: { name: '训练超载', description: '训练偶过热后发动足以扭转战局的重击。', effects: { damage: 30 } },
    action_mode: 'random', action_config: {},
  },
};

const preflight = preflightBattleContent(battle);
assert.equal(preflight.ok, true, JSON.stringify(preflight.issues));

const character = await getCharacter(api, avatarUrl);
const characterName = character?.name || character?.data?.name;
if (!characterName) throw new Error(`Character ${avatarUrl} has no name`);
const now = new Date();
const timestamp = now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const chatFile = `summon-selectors-${timestamp}`;
const statData = {
  status: {
    time: '召唤机制回归', location: '星空训练场',
    profession: { name: '契约测试者', ability: '验证召唤选择、复制、移除、强化与援护流程。' },
    permanent_status: [], temporary_status: [], inventory: [],
    clothing: { head: '', neck: '', hands: '', upper_body: '', lower_body: '', underwear: '', legs: '', feet: '' },
  },
  battle,
  factions: { player_alignment: '绝对中立', invasion: 0, relations: [] },
  npcs: {}, reward: { card: [], artifact: [], item: [], limits: {} },
  run: null, run_result: null, run_upgrade: null,
};
const variables = createInitializedMvuLayer(statData, `${releaseConfig.worldbookPrefix}${releaseConfig.cardVersion}`);
const chat = [
  {
    chat_metadata: { integrity: randomUUID(), variables: {}, tainted: true },
    user_name: 'unused', character_name: 'unused',
  },
  {
    name: characterName, is_user: false, is_system: false, send_date: now.toISOString(),
    mes: '召唤选择器、复制与离场真实酒馆回归场景。\n\n<BATTLE_START>',
    extra: {}, variables: [variables],
  },
];
await saveAndActivateCharacterChat(api, { avatarUrl, characterName, chatFile, chat });

console.log(JSON.stringify({
  ok: true,
  version: releaseConfig.cardVersion,
  avatarUrl,
  chatFile,
  summons: [guardian.name, orb.name, striker.name],
  cards: battle.cards.map(card => card.name),
  preflightWarnings: preflight.warnings,
}, null, 2));
