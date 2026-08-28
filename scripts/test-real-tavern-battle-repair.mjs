import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createInitializedMvuLayer,
  createTavernApi,
  getCharacter,
  saveAndActivateCharacterChat,
} from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const core = require(resolve(root, 'src/game-core/index.ts'));
const { preflightBattleContent } = require(resolve(root, 'src/fish/core/battleContentPreflight.ts'));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const [scenario = 'invalid', avatarUrl, mode = 'ordinary'] = process.argv.slice(2);
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);

if (!['invalid', 'valid', 'recovery', 'scry', 'seek', 'effects', 'status', 'triggers', 'loop', 'model-shape'].includes(scenario))
  throw new Error('Scenario must be invalid, valid, recovery, scry, seek, effects, status, triggers, loop, or model-shape');
if (!['ordinary', 'run'].includes(mode)) throw new Error('Mode must be ordinary or run');
if (!avatarUrl?.endsWith('.png')) {
  throw new Error(
    'Usage: node scripts/test-real-tavern-battle-repair.mjs <scenario> <avatar.png> [ordinary|run]',
  );
}

function createBattle(scenarioName) {
  if (scenarioName === 'model-shape') {
    return {
      core: { emoji: '🧙', hp: 100, max_hp: 100, lust: 0, max_lust: 100, card_removal_count: 1 },
      cards: [
        { id: 'combo_strike', name: '连击拳', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7, apply_status: 'combo_flow', stacks: 1 } },
        { id: 'combo_guard', name: '连击架', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
        { id: 'combo_power', name: '蓄势专注', type: 'Power', rarity: 'Uncommon', cost: 1, quantity: 1, effects: { apply_status: 'combo_flow', stacks: 2 } },
      ],
      artifacts: [{ id: 'combo_ring', name: '连击扳指', rarity: 'Uncommon', trigger: 'attack_played', effects: { block: 1 } }],
      items: [{ id: 'tonic', name: '恢复剂', count: 1, effects: { heal: 10 } }],
      statuses: {
        combo_flow: {
          id: 'combo_flow',
          name: '连击心流',
          emoji: 'F',
          type: 'buff',
          stacks_change: 'keep',
          triggers: { apply: { effects: { lust: 1 } }, tick: { effects: { block: 1 } } },
        },
      },
      player_abilities: [{ id: 'combo_awareness', name: '连段意识', trigger: 'card_played', when: 'self.status.combo_flow.stacks >= 5', effects: { draw: 1 } }],
      player_status_effects: [],
      player_lust_effect: { damage: 6 },
      level: 1,
      exp: 0,
      enemy: {
        name: '回归测试敌人',
        emoji: 'E',
        max_hp: 42,
        hp: 42,
        max_lust: 100,
        lust: 0,
        actions: [{ name: '测试攻击', weight: 1, effects: { damage: 6 } }],
        abilities: [],
        status_effects: [],
        lust_effect: { damage: 4 },
        action_mode: 'probability',
        action_config: { probability: { 测试攻击: 1 } },
      },
    };
  }
  const validLike = scenarioName !== 'invalid';
  const enemy = {
    name:
      scenarioName === 'recovery'
        ? '回收训练体'
        : scenarioName === 'scry'
          ? '星见训练体'
          : scenarioName === 'seek'
            ? '星轨训练体'
            : scenarioName === 'effects'
              ? '效果链训练体'
              : scenarioName === 'status'
                ? '状态周期训练体'
                : scenarioName === 'triggers'
                  ? '触发链训练体'
                  : scenarioName === 'loop'
                    ? '闭环训练体'
          : validLike
            ? '镜影训练体'
            : '错乱镜影',
    emoji: 'M',
    max_hp: 36,
    hp: 36,
    max_lust: 100,
    lust: 0,
    description: '用于验证战斗场景修复边界的隔离敌人。',
    actions:
      validLike
        ? [
            { name: '裂光', weight: 2, effects: { damage: 6 } },
            { name: '镜壳', weight: 1, effects: { block: 5 } },
          ]
        : [{ name: '不可回显的错乱行动', weight: 0, effects: { damage: 'unknown * 4' } }],
    abilities: [],
    status_effects: [],
    lust_effect: {
      name: '镜面反噬',
      description: '镜面在欲望满溢时折回一道刺目的裂光。',
      effects: { damage: 4 },
    },
    action_mode: 'probability',
    action_config:
      validLike ? { probability: { 裂光: 2, 镜壳: 1 } } : { probability: { 不可回显的错乱行动: 0 } },
  };
  if (scenarioName === 'loop') {
    enemy.max_hp = 3;
    enemy.hp = 3;
  }
  const recoveryCards = [
    { id: 'strike', name: '星辉斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 4, effects: { damage: 7 } },
    { id: 'guard', name: '月幕防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 4, effects: { block: 6 } },
    { id: 'echo_drop', name: '回声落片', type: 'Skill', rarity: 'Common', cost: 0, quantity: 1, innate: true, effects: { block: 1 } },
    { id: 'ember_drop', name: '余烬落片', type: 'Skill', rarity: 'Common', cost: 0, quantity: 1, innate: true, exhaust: true, effects: { block: 1 } },
    {
      id: 'recall_discard',
      name: '弃牌召回',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { recover: 1, from: 'discard', pick: 'choose' },
    },
    {
      id: 'recall_exhaust',
      name: '余烬召回',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { recover: 1, from: 'exhaust', pick: 'choose' },
    },
  ];
  const standardCards = [
    {
      id: 'strike',
      name: '星辉斩击',
      type: 'Attack',
      rarity: 'Common',
      cost: 1,
      quantity: 4,
      effects: { damage: 7 },
    },
    { id: 'guard', name: '月幕防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 4, effects: { block: 6 } },
    {
      id: 'triple_ray',
      name: '三重星芒',
      type: 'Attack',
      rarity: 'Uncommon',
      cost: 1,
      quantity: 1,
      effects: { damage: 3, hits: 3 },
      innate: true,
    },
    {
      id: 'ash_seed',
      name: '余烬种子',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      effects: { block: 5, to: 'opponent' },
      exhaust: true,
      innate: true,
    },
    {
      id: 'ash_guard',
      name: '余烬护幕',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 1,
      quantity: 1,
      effects: { block: 'self.exhaust_pile_size * 4' },
      innate: true,
    },
    {
      id: 'combo_ray',
      name: '连星终式',
      type: 'Attack',
      rarity: 'Uncommon',
      cost: 1,
      quantity: 1,
      effects: { damage: 'turn_number + attacks_played_this_turn * 2 + skills_played_this_turn' },
      innate: true,
    },
    {
      id: 'type_power',
      name: '星型共鸣',
      type: 'Power',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      trigger: 'turn_start',
      effects: { block: 1 },
      innate: true,
    },
  ];
  const scryCards = [
    { id: 'strike', name: '星辉斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 4, effects: { damage: 7 } },
    { id: 'guard', name: '月幕防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 4, effects: { block: 6 } },
    {
      id: 'star_foresight',
      name: '星见',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { scry: 3 },
    },
    { id: 'future_a', name: '未来刻痕·一', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 5 } },
    { id: 'future_b', name: '未来刻痕·二', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 5 } },
    { id: 'future_c', name: '未来刻痕·三', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { heal: 3 } },
  ];
  const seekCards = [
    { id: 'strike', name: '星辉斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 4, effects: { damage: 7 } },
    { id: 'guard', name: '月幕防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 4, effects: { block: 6 } },
    {
      id: 'star_seek',
      name: '星轨检索',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { seek: 1 },
    },
    { id: 'search_target_a', name: '星轨样本·一', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 5 } },
    { id: 'search_target_b', name: '星轨样本·二', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 5 } },
  ];
  const effectCards = [
    {
      id: 'effect_modifier',
      name: '星位校准',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { set_block: 3 },
    },
    {
      id: 'effect_damage',
      name: '校准射线',
      type: 'Attack',
      rarity: 'Common',
      cost: 1,
      quantity: 1,
      innate: true,
      effects: { damage: 7 },
    },
    {
      id: 'effect_vitals',
      name: '生命回路',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { heal: 8, block: 6, energy: 2 },
    },
    {
      id: 'effect_lust_status',
      name: '心焰烙印',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { lust: 20, apply_status: 'weak', stacks: 2 },
    },
    {
      id: 'effect_cleanse',
      name: '净化星环',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { remove_status: 'focus', to: 'self' },
    },
    { id: 'effect_filler_a', name: '测试填充·一', type: 'Attack', rarity: 'Common', cost: 1, quantity: 3, effects: { damage: 4 } },
    { id: 'effect_filler_b', name: '测试填充·二', type: 'Skill', rarity: 'Common', cost: 1, quantity: 3, effects: { block: 4 } },
  ];
  const statusCards = [
    {
      id: 'status_apply',
      name: '星痕叠印',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { apply_status: 'star_mark', stacks: 1, to: 'self' },
    },
    {
      id: 'status_holder_probe',
      name: '归属探针',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { apply_status: 'holder_probe' },
    },
    {
      id: 'status_holder_self_probe',
      name: '自持探针',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { apply_status: 'holder_probe', to: 'self' },
    },
    {
      id: 'status_guard',
      name: '星痕护幕',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { block: 1 },
    },
    {
      id: 'status_remove',
      name: '星痕净化',
      type: 'Skill',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { remove_status: 'star_mark', to: 'self' },
    },
    { id: 'status_attack', name: '状态填充攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 3, effects: { damage: 4 } },
    { id: 'status_defend', name: '状态填充防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 2, effects: { block: 4 } },
  ];
  const triggerCards = [
    {
      id: 'trigger_probe',
      name: '四源共鸣',
      type: 'Attack',
      rarity: 'Uncommon',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { damage: 3 },
    },
    { id: 'trigger_attack', name: '触发填充攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 4 } },
    { id: 'trigger_defend', name: '触发填充防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 4, effects: { block: 4 } },
  ];
  const triggerArtifacts = [
    { id: 'card_relic', name: '回响石', rarity: 'Uncommon', trigger: 'card_played', effects: { block: 4 } },
    { id: 'attack_relic', name: '刃光根', rarity: 'Uncommon', trigger: 'attack_played', effects: { block: 8 } },
    { id: 'passive_relic', name: '增幅核', rarity: 'Rare', trigger: 'passive', effects: { modify: 'damage', add: 2 } },
  ];
  const triggerAbilities = [
    { id: 'card_ability', name: '牌鸣', trigger: 'card_played', effects: { block: 1 } },
    { id: 'attack_ability', name: '刃鸣', trigger: 'attack_played', effects: { block: 2 } },
    { id: 'passive_ability', name: '增幅', trigger: 'passive', effects: { modify: 'damage', add: 1 } },
  ];
  const loopCards = [
    {
      id: 'loop_finisher',
      name: '闭环终击',
      type: 'Attack',
      rarity: 'Common',
      cost: 0,
      quantity: 1,
      innate: true,
      effects: { damage: 10 },
    },
    { id: 'loop_strike', name: '闭环攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 6 } },
    { id: 'loop_guard', name: '闭环防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
  ];
  return {
    core: {
      emoji: '🧙',
      hp: scenarioName === 'effects' ? 60 : scenarioName === 'status' ? 40 : scenarioName === 'triggers' ? 50 : 80,
      max_hp: 80,
      lust: 0,
      max_lust: 100,
      card_removal_count: 1,
    },
    cards:
      scenarioName === 'recovery'
        ? recoveryCards
        : scenarioName === 'scry'
          ? scryCards
          : scenarioName === 'seek'
            ? seekCards
            : scenarioName === 'effects'
              ? effectCards
              : scenarioName === 'status'
                ? statusCards
                : scenarioName === 'triggers'
                  ? triggerCards
                  : scenarioName === 'loop'
                    ? loopCards
            : standardCards,
    artifacts:
      scenarioName === 'triggers'
        ? triggerArtifacts
        : scenarioName === 'status'
        ? []
        : scenarioName === 'effects'
        ? [{ id: 'life_stone', name: '生命之石', rarity: 'Common', trigger: 'battle_start', effects: { block: 2 } }]
        : [
            { id: 'life_stone', name: '生命之石', rarity: 'Common', trigger: 'battle_start', effects: { block: 2 } },
            { id: 'ash_echo', name: '余烬回声', rarity: 'Uncommon', trigger: 'on_exhaust', effects: { block: 1 } },
            { id: 'card_echo', name: '万象回声', rarity: 'Uncommon', trigger: 'card_played', effects: { block: 'self.block' } },
            { id: 'attack_echo', name: '刃光回声', rarity: 'Uncommon', trigger: 'attack_played', effects: { block: 'self.block' } },
            { id: 'skill_echo', name: '术式回声', rarity: 'Uncommon', trigger: 'skill_played', effects: { block: 'self.block' } },
            { id: 'power_echo', name: '星型回声', rarity: 'Uncommon', trigger: 'power_played', effects: { block: 'self.block' } },
            { id: 'draw_echo', name: '抽牌回声', rarity: 'Uncommon', trigger: 'on_draw', effects: { block: 'self.block' } },
            { id: 'shuffle_echo', name: '回洗回声', rarity: 'Rare', trigger: 'on_shuffle', effects: { block: 'self.block' } },
            { id: 'discard_echo', name: '弃牌回声', rarity: 'Rare', trigger: 'on_discard', effects: { block: 'self.block' } },
          ],
    items: [{ id: 'starlight_tonic', name: '星光药剂', count: 1, effects: { heal: 8 } }],
    statuses:
      scenarioName === 'status'
        ? [
            {
              id: 'star_mark',
              name: '星痕',
              emoji: 'S',
              description: '施加、叠加、持有、回合结算与移除均有结构化效果。',
              type: 'buff',
              stacks_change: -1,
              maxStacks: 3,
              triggers: {
                apply: { block: 2 },
                stack: { heal: 2 },
                hold: { modify: 'block', add: 'stacks' },
                tick: { heal: 1 },
                remove: { heal: 3 },
              },
            },
            {
              id: 'holder_probe',
              name: '归属印记',
              emoji: 'P',
              type: 'debuff',
              stacks_change: 'keep',
              triggers: {
                apply: { damage: 2 },
                tick: { damage: 3 },
              },
            },
          ]
        : scenarioName === 'effects'
        ? [
            { id: 'weak', name: '虚弱', emoji: 'W', description: '实机状态施加探针。', type: 'debuff', triggers: {} },
            { id: 'focus', name: '专注', emoji: 'F', description: '实机状态移除探针。', type: 'buff', triggers: {} },
          ]
        : [],
    player_abilities:
      scenarioName === 'triggers'
        ? triggerAbilities
        : scenarioName === 'status'
        ? []
        : scenarioName === 'effects'
        ? [{ id: 'effect_power', name: '星力增幅', trigger: 'passive', effects: { modify: 'damage', add: 2 } }]
        : [
            { id: 'card_focus', name: '万象聚焦', trigger: 'card_played', effects: { block: 1 } },
            { id: 'attack_focus', name: '刃光聚焦', trigger: 'attack_played', effects: { block: 2 } },
            { id: 'skill_focus', name: '术式聚焦', trigger: 'skill_played', effects: { block: 4 } },
            { id: 'power_focus', name: '星型聚焦', trigger: 'power_played', effects: { block: 8 } },
            { id: 'draw_focus', name: '抽牌聚焦', trigger: 'on_draw', effects: { block: 1 } },
            { id: 'shuffle_focus', name: '回洗聚焦', trigger: 'on_shuffle', effects: { block: 10 } },
            { id: 'discard_focus', name: '弃牌聚焦', trigger: 'on_discard', effects: { block: 16 } },
          ],
    player_status_effects:
      scenarioName === 'effects' ? [{ id: 'focus', name: '专注', type: 'buff', stacks: 1 }] : [],
    player_lust_effect: {
      name: '星蚀满溢',
      description: '积蓄的星光越过承受极限，在对方身旁骤然坍缩。',
      effects: { damage: 6 },
    },
    level: 1,
    exp: scenarioName === 'loop' ? 90 : 0,
    enemy,
  };
}

function createStatData(battle) {
  const run = (() => {
    if (mode !== 'run') return null;
    const waiting = core.createRunState({ seed: 451, startingGold: 99 });
    return core.enterRunNode(waiting, waiting.choices[0].id);
  })();
  return {
    status: {
      time: '战斗修复回归',
      location: '镜面测试场',
      profession: { name: '契约测试员', ability: '验证战斗场景修复' },
      permanent_status: [],
      temporary_status: [],
      clothing: { head: '', neck: '', hands: '', upper_body: '', lower_body: '', underwear: '', legs: '', feet: '' },
      inventory: [],
    },
    battle,
    factions: { player_alignment: '绝对中立', invasion: 0, relations: [] },
    npcs: {},
    reward: { card: [], artifact: [], item: [], limits: {} },
    run,
    run_result: null,
    run_upgrade: null,
  };
}

const battle = createBattle(scenario);
const preflight = preflightBattleContent(battle);
if ((scenario !== 'invalid') !== preflight.ok) {
  throw new Error(`Battle fixture drifted: ${JSON.stringify(preflight.issues)}`);
}
if (process.env.PREFLIGHT_ONLY === '1') {
  console.log(JSON.stringify({ scenario, ok: preflight.ok, issues: preflight.issues.slice(0, 4) }));
  process.exit(0);
}

const api = await createTavernApi(tavernUrl);
const character = await getCharacter(api, avatarUrl);
const characterName = character?.name || character?.data?.name;
if (!characterName) throw new Error(`Character ${avatarUrl} has no name`);

const now = new Date();
const timestamp = now
  .toISOString()
  .replaceAll(':', '-')
  .replace(/\.\d{3}Z$/, 'Z');
const chatFile = `battle-repair-${scenario}-${timestamp}`;
const statData = createStatData(battle);
const worldbookName = `${releaseConfig.worldbookPrefix}${releaseConfig.cardVersion}`;
const variables = createInitializedMvuLayer(statData, worldbookName);
const chat = [
  {
    chat_metadata: { integrity: randomUUID(), variables: {}, tainted: true },
    user_name: 'unused',
    character_name: 'unused',
  },
  {
    name: 'unused',
    is_user: true,
    is_system: false,
    send_date: now.toISOString(),
    mes: '我迎向眼前的敌人，准备战斗。',
    extra: {},
    variables: [structuredClone(variables)],
  },
  {
    name: characterName,
    is_user: false,
    is_system: false,
    send_date: now.toISOString(),
    mes: `真实酒馆战斗场景回归：${scenario === 'invalid' ? '无效场景' : scenario === 'recovery' ? '牌区取回场景' : scenario === 'scry' ? '预见场景' : scenario === 'seek' ? '抽牌堆检索场景' : scenario === 'effects' ? '现代效果链场景' : scenario === 'status' ? '现代状态周期场景' : scenario === 'triggers' ? '能力与遗物触发链场景' : '合法场景'}。\n<BATTLE_START>`,
    extra: {},
    variables: [variables],
  },
];

await saveAndActivateCharacterChat(api, { avatarUrl, characterName, chatFile, chat });

console.log(
  JSON.stringify(
    {
      scenario,
      mode,
      avatarUrl,
      chatFile,
      preflight: {
        ok: preflight.ok,
        paths: preflight.issues.slice(0, 4).map(issue => issue.path),
      },
      expectedUi:
        scenario !== 'invalid'
          ? {
              enemy:
                scenario === 'model-shape'
                  ? '回归测试敌人'
                  : scenario === 'recovery'
                  ? '回收训练体'
                  : scenario === 'scry'
                    ? '星见训练体'
                    : scenario === 'seek'
                      ? '星轨训练体'
                      : scenario === 'effects'
                        ? '效果链训练体'
                        : scenario === 'status'
                          ? '状态周期训练体'
                        : scenario === 'triggers'
                          ? '触发链训练体'
                          : scenario === 'loop'
                            ? '闭环训练体'
                      : '镜影训练体',
              repairButtons: 0,
              phase: '玩家回合',
              mechanics:
                scenario === 'model-shape'
                  ? ['对象式状态表', '触发器 effects 包装', '持续状态 Power', '能力同级 when']
                  : scenario === 'recovery'
                  ? ['回声落片', '余烬落片', '弃牌召回', '余烬召回']
                  : scenario === 'scry'
                    ? ['星见', '牌库顶3张可选0-3张', '不触发on_draw/on_discard']
                    : scenario === 'seek'
                      ? ['星轨检索', '从抽牌堆选择1张加入手牌', '不触发on_draw']
                      : scenario === 'effects'
                        ? ['星位校准', '校准射线', '生命回路', '心焰烙印', '净化星环', '星力增幅']
                        : scenario === 'status'
                          ? ['星痕叠印', '归属探针', '自持探针', '星痕护幕', '星痕净化', 'apply/stack/hold/tick/remove', '状态持有者默认目标']
                          : scenario === 'triggers'
                            ? ['四源共鸣', '能力触发', '遗物触发', '被动修饰']
                            : scenario === 'loop'
                              ? ['闭环终击', '普通战斗终局', '战后奖励', '升级', '返回剧情']
                      : ['三重星芒', '余烬种子', '余烬护幕', '连星终式', '星型共鸣'],
            }
          : { dialog: '无法进行战斗', repairButtons: 1, leakedActionName: false },
    },
    null,
    2,
  ),
);
