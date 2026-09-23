import assert from 'node:assert/strict';
import { dungeonPlanFixture, withDungeonPlan } from './lib/tower-plan-fixture.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const {
  DesignAssistantController,
  extractTowerInitialRepairTargets,
  extractTowerInitialRepairSlotTargets,
  mergeTowerInitialSlotRepair,
  mergeTowerInitialRootRepair,
  parseTowerInitialSlotRepairResponse,
  parseTowerInitialRootRepairResponse,
  preserveUnreportedTowerInitialContent,
  salvageInvalidInitialPlayerContent,
} = require(resolve('src/sillytavern-extension/controller.ts'));
const {
  TOWER_INITIAL_ROOT_REPAIR_SPEC,
  formatCompactEffectAuthoringContract,
  TOWER_INITIAL_SLOT_REPAIR_SPEC,
  createTowerInitialSlotRepairJsonSchema,
  createTowerInitialRootRepairJsonSchema,
} = require(resolve('src/game-core/towerRequest.ts'));
const {
  DESIGN_ASSISTANT_CARD_SCOPE,
  DESIGN_ASSISTANT_EXTENSION_ID,
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
} = require(resolve('src/sillytavern-extension/types.ts'));
const { normalizeMvuBattleContent } = require(resolve('src/runtime/mvuBattleContentNormalizer.ts'));
const { observeNarrativeDelivery } = require(resolve('src/sillytavern-extension/narrativeDeliveryObservation.ts'));

class FakeEvents {
  listeners = new Map();

  on(event, listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter(value => value !== listener));
  }

  async emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) await listener(...args);
  }
}

const events = new FakeEvents();
const context = {
  chatId: 'single-floor-start-chat',
  chat: [{ is_user: false, is_system: false, mes: '[爬塔模式开场]' }],
  characterId: 0,
  groupId: null,
  characters: [{
    data: {
      extensions: {
        magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE },
      },
    },
  }],
  extensionSettings: {
    [DESIGN_ASSISTANT_EXTENSION_ID]: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS, enabled: false },
  },
  saveSettingsDebounced() {},
  chatMetadata: {},
  saveMetadataDebounced() {},
  eventSource: events,
  eventTypes: {
    GENERATE_AFTER_DATA: 'generate_after_data',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_CHANGED: 'chat_id_changed',
    MESSAGE_UPDATED: 'message_updated',
  },
  updateMessageBlock(messageId, message) {
    assert.equal(messageId, 0);
    this.chat[messageId] = message;
  },
  async saveChat() {
    saveChatCalls += 1;
  },
};

let variables = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    status: {},
    battle: {},
  },
};
const modelCalls = [];
const mvuWrites = [];
const chatVariableWrites = [];
let createChatMessageCalls = 0;
let saveChatCalls = 0;

function readRepairProjection(config) {
  const match = config.user_input.match(/REPAIR_SLOTS=(\{.*\})\nREPAIR_CONTEXT=/);
  assert.ok(match, 'typed repair prompt must contain its bounded slot projection');
  return JSON.parse(match[1]);
}

function typedRepairResponse(config, replacementForPath, options = {}) {
  const projection = readRepairProjection(config);
  const roots = {};
  for (const [token, target] of Object.entries(projection)) {
    assert.ok(Object.hasOwn(replacementForPath, target.path), `missing test replacement for ${target.path}`);
    const replacement = structuredClone(replacementForPath[target.path]);
    roots[token] = { slots: {} };
    for (const [slotToken, slot] of Object.entries(target.slots)) {
      const operation = { action: slot.action };
      if (slot.action !== 'remove_invalid_field') {
        if (slot.kind === 'discard_strategy') {
          operation.value = structuredClone(options.discardStrategies?.[target.path] || { mode: 'discard_all' });
        } else if (slot.kind === 'card_copy_strategy') {
          operation.value = { mode: 'copy_at_original_cost' };
        } else {
          let value = replacement;
          for (const part of slot.path.matchAll(/([^.\[\]]+)|\[(\d+)\]/g)) {
            value = value?.[part[2] === undefined ? part[1] : Number(part[2])];
          }
          if (slot.kind === 'trigger_mode_strategy') {
            operation.value = value.on === 'passive'
              ? { mode: 'passive', effects: Array.isArray(value.effects) ? value.effects : [value.effects] }
              : { mode: 'event', on: value.on, effects: Array.isArray(value.effects) ? value.effects : [value.effects] };
          } else if (slot.kind === 'summon_lifecycle_default') {
            operation.value = { mode: 'use_runtime_default' };
          } else {
            operation.value = structuredClone(
              ['effect_sequence', 'passive_effect_sequence', 'status_trigger_effect_sequence', 'status_hold_sequence'].includes(slot.kind)
                && !Array.isArray(value)
                ? [value]
                : value,
            );
          }
        }
      }
      roots[token].slots[slotToken] = operation;
    }
  }
  return JSON.stringify({
    spec: TOWER_INITIAL_SLOT_REPAIR_SPEC,
    roots,
    support_statuses: structuredClone(options.supportStatuses || []),
    support_resources: structuredClone(options.supportResources || []),
  });
}

const initialContent = {
  status: {
    time: '旅途第一日',
    location: '无名高塔入口',
    profession: { name: '星火旅者', ability: '在攻守转换时收集星火。' },
  },
  battle: {
    core: { emoji: '✨', hp: 72, max_hp: 72, lust: 0, max_lust: 100 },
    cards: [
      {
        id: 'star_strike', name: '星火斩', emoji: '🌠', type: 'Attack', rarity: 'Common',
        cost: 1, quantity: 5, description: '以星火切开敌阵。', effects: { damage: 7 },
      },
      {
        id: 'star_guard', name: '星幕', emoji: '🌌', type: 'Skill', rarity: 'Common',
        cost: 1, quantity: 5, description: '展开一层流动星幕。', effects: { block: 6 },
      },
    ],
    artifacts: [{
      id: 'star_compass', name: '星路罗盘', rarity: 'Common',
      description: '在旅途开始时标出一条短暂的安全路径。',
      trigger: { on: 'battle_start', effects: { block: 4 } },
    }],
    items: [{
      id: 'starlight_tonic', name: '星露药剂', count: 1,
      description: '饮下后恢复少量生命。', effects: { heal: 8 },
    }],
    statuses: [],
    player_abilities: [],
    player_status_effects: [],
    player_lust_effect: {
      name: '星潮反击', description: '欲望满溢时引爆积蓄的星火。', effects: { damage: 8 },
    },
    level: 1,
    exp: 0,
  },
};

const salvageFixture = {
  stat_data: {
    battle: structuredClone(initialContent.battle),
  },
};
salvageFixture.stat_data.battle.statuses.push({
  id: 'empty_aura', name: '空光环', emoji: '⚠️', type: 'buff',
  triggers: { hold: [] },
});
salvageFixture.stat_data.battle.cards.push({
  id: 'broken_aura_card', name: '坏光环牌', type: 'Power', rarity: 'Uncommon', cost: 1, quantity: 1,
  effects: { apply_status: 'empty_aura', stacks: 1, to: 'self' },
});
const salvagedFixture = salvageInvalidInitialPlayerContent(salvageFixture);
assert.equal(salvagedFixture, null, 'referenced authored cards/statuses must never be deleted as optional');
assert.equal(salvageFixture.stat_data.battle.cards.some(card => card.id === 'broken_aura_card'), true);
assert.equal(salvageFixture.stat_data.battle.statuses.some(status => status.id === 'empty_aura'), true);

const inertStatusFixture = {
  stat_data: {
    battle: structuredClone(initialContent.battle),
  },
};
inertStatusFixture.stat_data.battle.statuses.push({
  id: 'unreachable_empty_aura', name: '未引用空光环', emoji: '⚠️', type: 'buff',
  triggers: { hold: [] },
});
const inertStatusSalvage = salvageInvalidInitialPlayerContent(inertStatusFixture);
assert.ok(inertStatusSalvage, 'an invalid mechanically unreachable support definition may be isolated');
assert.equal(
  inertStatusSalvage.stat_data.battle.statuses.some(status => status.id === 'unreachable_empty_aura'),
  false,
);
assert.equal(inertStatusFixture.stat_data.battle.statuses.some(status => status.id === 'unreachable_empty_aura'), true);

// Even a complete-looking stale/template deck must be replaced at the only
// legitimate initialization boundary: the first assistant greeting.
variables.stat_data.status = structuredClone(initialContent.status);
variables.stat_data.battle = structuredClone(initialContent.battle);
variables.stat_data.battle.cards = variables.stat_data.battle.cards.map(card => ({
  ...card,
  id: `stale_${card.id}`,
  name: `旧模板${card.name}`,
}));

const mvu = {
  getMvuData: options => {
    assert.deepEqual(options, { type: 'message', message_id: 0 });
    return structuredClone(variables);
  },
  replaceMvuData: async (next, options) => {
    assert.deepEqual(options, { type: 'message', message_id: 0 });
    variables = structuredClone(next);
    mvuWrites.push(structuredClone(next));
  },
  isDuringExtraAnalysis: () => false,
};

const previousTavernHelper = globalThis.TavernHelper;
globalThis.TavernHelper = {
  async replaceVariables(next, options) {
    assert.deepEqual(options, { type: 'chat' });
    chatVariableWrites.push(structuredClone(next));
  },
};

const validGiftBeforeCardRepair = {
  narrative: '原始引导剧情',
  status: { location: '原始入口' },
  player: { cards: [{ id: 'broken_card' }] },
  opening: {
    title: '原始馈赠',
    choices: [{ id: 'energy_gift', description: '获得一张星核牌', outcome: { reward: { cards: [{ id: 'star_core_card' }] } } }],
  },
};
const overreachingCardRepair = {
  narrative: '模型擅自重写的剧情',
  status: { location: '模型擅自改写的入口' },
  player: { cards: [{ id: 'fixed_card' }] },
  opening: {
    title: '模型擅自重写的馈赠',
    choices: [{ id: 'energy_gift', description: '最大能量+1', outcome: { max_energy: 1 } }],
  },
};
const scopedCardRepair = preserveUnreportedTowerInitialContent(
  validGiftBeforeCardRepair,
  overreachingCardRepair,
  'battle.cards[0].effects：规则字段不符合浅层 effects 契约',
);
assert.equal(scopedCardRepair.player.cards[0].id, 'fixed_card');
assert.equal(scopedCardRepair.narrative, '原始引导剧情');
assert.deepEqual(scopedCardRepair.opening, validGiftBeforeCardRepair.opening);
const dependencySafeRepair = preserveUnreportedTowerInitialContent(
  {
    narrative: '原始引导剧情',
    status: { location: '原始入口' },
    player: {
      core: { emoji: '✨', hp: 40, max_hp: 40, lust: 0, max_lust: 100 },
      cards: [{ id: 'broken_card', effects: { add_status: 'new_power' } }, { id: 'valid_card', effects: { damage: 7 } }],
      statuses: [{ id: 'lust_surge', triggers: { hold: { modify: 'damage', add: 3 } } }],
      player_lust_effect: { name: '原始欲望效果', effects: { apply_status: 'lust_surge' } },
    },
    opening: validGiftBeforeCardRepair.opening,
  },
  {
    narrative: '模型擅自重写的剧情',
    status: { location: '模型擅自改写的入口' },
    player: {
      core: { emoji: '❌', hp: 1, max_hp: 1, lust: 99, max_lust: 100 },
      cards: [{ id: 'broken_card', effects: { apply_status: 'new_power' } }, { id: 'valid_card', effects: { damage: 999 } }],
      statuses: [
        {
          id: 'new_power',
          triggers: { turn_start: { apply_status: 'nested_power', stacks: 1, to: 'self' } },
        },
        { id: 'nested_power', triggers: { hold: { modify: 'damage', add: 2 } } },
        { id: 'rogue_status', triggers: { hold: { modify: 'damage', add: 999 } } },
      ],
    },
    opening: overreachingCardRepair.opening,
  },
  'battle.cards[0].effects.add_status：规则字段不符合浅层 effects 契约',
);
assert.equal(dependencySafeRepair.player.cards[0].effects.apply_status, 'new_power');
assert.equal(dependencySafeRepair.player.cards[1].effects.damage, 7, 'unreported cards must remain authored byte-for-byte');
assert.deepEqual(dependencySafeRepair.player.core, { emoji: '✨', hp: 40, max_hp: 40, lust: 0, max_lust: 100 });
assert.equal(dependencySafeRepair.player.player_lust_effect.name, '原始欲望效果');
assert.deepEqual(
  dependencySafeRepair.player.statuses.map(status => status.id),
  ['lust_surge', 'new_power', 'nested_power'],
  'repair may add only the referenced support-status closure, never an unrelated valid definition',
);
const scopedOpeningRepair = preserveUnreportedTowerInitialContent(
  validGiftBeforeCardRepair,
  overreachingCardRepair,
  'opening：opening.choices[0].outcome：开局馈赠不支持字段：max_energy',
);
assert.equal(scopedOpeningRepair.opening.title, '原始馈赠');
assert.deepEqual(scopedOpeningRepair.opening.choices, overreachingCardRepair.opening.choices);
const pathScopedOpeningRepair = preserveUnreportedTowerInitialContent(
  {
    ...validGiftBeforeCardRepair,
    opening: {
      title: '原始馈赠',
      narrative: '原始馈赠叙事',
      choices: [
        { id: 'broken_gift', label: '待修馈赠', outcome: { reward: { cards: [{ id: 'broken_reward' }] } } },
        { id: 'valid_gift', label: '合法馈赠', outcome: { gold: 20 } },
      ],
    },
  },
  {
    ...overreachingCardRepair,
    opening: {
      title: '模型改写标题',
      narrative: '模型改写叙事',
      choices: [
        { id: 'broken_gift', label: '已修馈赠', outcome: { reward: { cards: [{ id: 'fixed_reward' }] } } },
        { id: 'valid_gift', label: '被擅自改写', outcome: { max_energy: 99 } },
      ],
    },
  },
  'opening.choices 奖励：开局馈赠 broken_gift.cards[0] 无效',
);
assert.equal(pathScopedOpeningRepair.opening.title, '原始馈赠');
assert.equal(pathScopedOpeningRepair.opening.choices[0].label, '已修馈赠');
assert.deepEqual(pathScopedOpeningRepair.opening.choices[1], { id: 'valid_gift', label: '合法馈赠', outcome: { gold: 20 } });

const typedRepairOriginal = {
  narrative: '必须原样保留的引导剧情',
  status: structuredClone(initialContent.status),
  player: {
    ...structuredClone(initialContent.battle),
    statuses: [{
      id: 'existing_status', name: '既有状态', emoji: '✅', type: 'buff',
      triggers: { hold: { modify: 'damage', add: 1 } },
    }],
    player_abilities: [{
      id: 'first_skill_echo', name: '首次回响', description: '首次打出技能牌时额外结算。',
      trigger: { on: 'skill_played', ordinal: 'first', effects: { card_rule: 'replay', limit: 1, extra: 1 } },
    }],
  },
  opening: {
    title: '必须原样保留的馈赠标题',
    narrative: '必须原样保留的馈赠叙事',
    choices: [
      { id: 'bad_energy', label: '错误能量', outcome: { energy: 1 } },
      { id: 'safe_gold', label: '合法金币', outcome: { gold: 20 } },
      { id: 'safe_remove', label: '合法移除', outcome: { card_removals: 1 } },
    ],
  },
};
const typedRepairError = [
  'opening：opening.choices[0].outcome：开局馈赠不支持字段：energy',
  'battle.player_abilities[0].trigger.effects：非 passive trigger 不允许持续 card_rule',
].join('；');
const typedTargets = extractTowerInitialRepairTargets(typedRepairOriginal, typedRepairError);
assert.deepEqual(typedTargets.map(target => target.path), ['opening.choices[0]', 'player.player_abilities[0]']);
assert.deepEqual(typedTargets.map(target => target.token), ['r0', 'r1']);
const iterationFourFailureA = structuredClone(typedRepairOriginal);
iterationFourFailureA.opening.choices[0] = {
  id: 'fragment_growth', label: '成长碎片',
  outcome: { reward: { artifacts: [{ id: 'iterative_pointer' }] } },
};
const failureATargets = extractTowerInitialRepairTargets(
  iterationFourFailureA,
  [
    'opening.choices 奖励：开局馈赠 fragment_growth.artifacts[0] 迭代指针 无效：trigger.effects.scope 不允许字段 scope',
    '开局馈赠 fragment_growth.artifacts[0] 迭代指针 无效：trigger.effects.pick: from: all/combat requires pick: all',
  ].join('；'),
);
assert.deepEqual(failureATargets.map(target => target.path), ['opening.choices[0]']);
assert.equal(failureATargets[0].errors.length, 2, 'both iteration-4 artifact defects stay attached to one choice root');
const typedSchema = createTowerInitialRootRepairJsonSchema(typedTargets);
assert.deepEqual(typedSchema.value.properties.roots.required, ['r0', 'r1']);
assert.equal(typedSchema.value.properties.roots.additionalProperties, false);
assert.throws(
  () => parseTowerInitialRootRepairResponse({
    spec: TOWER_INITIAL_ROOT_REPAIR_SPEC,
    roots: { r0: { id: 'bad_energy', label: '已修能量', outcome: { gold: 10 } } },
    support_statuses: [],
    support_resources: [],
  }, typedTargets),
  /漏掉必需根：r1/,
  'a response that fixes only one of two reported roots must be rejected before merge',
);
assert.throws(
  () => parseTowerInitialRootRepairResponse({
    spec: TOWER_INITIAL_ROOT_REPAIR_SPEC,
    roots: {
      r0: { id: 'bad_energy', label: '已修能量', outcome: { gold: 10 } },
      r1: null,
      r2: { id: 'unrequested' },
    },
    support_statuses: [],
    support_resources: [],
  }, typedTargets),
  /未请求根：r2/,
  'the model cannot select or add repair paths',
);
assert.throws(
  () => parseTowerInitialRootRepairResponse({
    spec: TOWER_INITIAL_ROOT_REPAIR_SPEC,
    roots: { r0: null, r1: null },
    support_statuses: [],
    support_resources: [],
  }, typedTargets),
  /r0 不允许删除/,
  'required opening choices never gain a deletion escape hatch',
);
const typedRepair = parseTowerInitialRootRepairResponse({
  spec: TOWER_INITIAL_ROOT_REPAIR_SPEC,
  roots: {
    r0: { id: 'bad_energy', label: '已修能量', outcome: { gold: 10 } },
    r1: {
      id: 'first_skill_echo', name: '首次回响', description: '战斗开始时获得一层回响。',
      trigger: { on: 'battle_start', effects: { apply_status: 'required_support', stacks: 1, to: 'self' } },
    },
  },
  support_statuses: [
    { id: 'required_support', name: '回响', emoji: '🔁', type: 'buff', triggers: { hold: { modify: 'damage', add: 1 } } },
    { id: 'rogue_support', name: '越权状态', emoji: '❌', type: 'buff', triggers: { hold: { modify: 'damage', add: 999 } } },
  ],
  support_resources: [],
}, typedTargets);
const typedMerged = mergeTowerInitialRootRepair(typedRepairOriginal, typedTargets, typedRepair);
assert.equal(typedMerged.opening.choices[0].outcome.gold, 10);
assert.equal(typedMerged.player.player_abilities[0].trigger.on, 'battle_start');
assert.equal(typedMerged.narrative, typedRepairOriginal.narrative);
assert.deepEqual(typedMerged.player.cards, typedRepairOriginal.player.cards);
assert.deepEqual(typedMerged.opening.choices[1], typedRepairOriginal.opening.choices[1]);
assert.deepEqual(
  typedMerged.player.statuses.map(status => status.id),
  ['existing_status', 'required_support'],
  'only support definitions referenced from accepted player roots may merge',
);
const optionalAbilityTarget = typedTargets.find(target => target.kind === 'player_ability');
assert.equal(optionalAbilityTarget.nullable, true);
assert.doesNotThrow(() => parseTowerInitialRootRepairResponse({
  spec: TOWER_INITIAL_ROOT_REPAIR_SPEC,
  roots: { r0: { id: 'bad_energy', label: '已修能量', outcome: { gold: 10 } }, r1: null },
  support_statuses: [],
  support_resources: [],
}, typedTargets));

const lockedSlotOriginal = structuredClone(typedRepairOriginal);
lockedSlotOriginal.opening.choices[0] = {
  id: 'discard_gift', label: '重排手牌',
  outcome: {
    reward: {
      cards: [{
        id: 'sequence_recombine', name: '序列重组', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
        description: '弃掉任意数量的手牌，然后抽1张牌。',
        effects: { discard: 'all', from: 'hand', pick: 'choose', draw: 1 },
      }],
    },
  },
};
const lockedSlotError = [
  'opening.choices 奖励：开局馈赠 discard_gift.cards[0] 序列重组 无效：cards[0].effects.discard: This operation must remain a separate effect object',
  'battle.player_abilities[0].trigger.effects：非 passive trigger 不允许持续 card_rule',
].join('；');
const lockedSlotTargets = extractTowerInitialRepairSlotTargets(lockedSlotOriginal, lockedSlotError);
assert.deepEqual(lockedSlotTargets.map(root => root.path), ['opening.choices[0]', 'player.player_abilities[0]']);
assert.deepEqual(lockedSlotTargets[0].slots.map(slot => slot.kind), ['description', 'discard_strategy']);
assert.deepEqual(lockedSlotTargets[1].slots.map(slot => slot.kind), ['description', 'trigger_mode_strategy']);
const lockedSlotSchema = createTowerInitialSlotRepairJsonSchema(lockedSlotTargets);
assert.equal(lockedSlotSchema.name, 'mwg_tower_initial_slot_repair');
assert.deepEqual(lockedSlotSchema.value.properties.roots.required, ['r0', 'r1']);
assert.deepEqual(lockedSlotSchema.value.properties.roots.properties.r0.properties.slots.required, ['s0', 's1']);

const slotResponseFor = (targets, values) => ({
  spec: TOWER_INITIAL_SLOT_REPAIR_SPEC,
  roots: Object.fromEntries(targets.map(root => [root.token, {
    slots: Object.fromEntries(root.slots.map(slot => [slot.token, {
      action: slot.action,
      ...(slot.action === 'remove_invalid_field' ? {} : { value: values[`${root.path}:${slot.kind}`] }),
    }])),
  }])),
  support_statuses: [],
  support_resources: [],
});
const validLockedResponse = slotResponseFor(lockedSlotTargets, {
  'opening.choices[0]:description': '弃掉全部手牌，然后抽1张牌。',
  'opening.choices[0]:discard_strategy': { mode: 'discard_all' },
  'player.player_abilities[0]:description': '每回合第一张技能牌额外完整结算1次。',
  'player.player_abilities[0]:trigger_mode_strategy': {
    mode: 'passive', effects: [{ card_rule: 'replay', card_type: 'Skill', limit: 1, extra: 1 }],
  },
});
const parsedLockedResponse = parseTowerInitialSlotRepairResponse(validLockedResponse, lockedSlotTargets);
const lockedMerged = mergeTowerInitialSlotRepair(lockedSlotOriginal, lockedSlotTargets, parsedLockedResponse);
assert.deepEqual(lockedMerged.opening.choices[0].outcome.reward.cards[0].effects, [
  { discard: 'all', from: 'hand', pick: 'all' },
  { draw: 1 },
]);
assert.equal(lockedMerged.opening.choices[0].outcome.reward.cards[0].description, '弃掉全部手牌，然后抽1张牌。');
assert.equal(lockedMerged.player.player_abilities[0].trigger.on, 'passive');
assert.equal(lockedMerged.player.player_abilities[0].id, 'first_skill_echo');
assert.deepEqual(lockedMerged.player.cards, lockedSlotOriginal.player.cards, 'sibling cards stay immutable');
assert.deepEqual(lockedMerged.opening.choices[1], lockedSlotOriginal.opening.choices[1], 'sibling gifts stay immutable');
assert.throws(() => {
  const missing = structuredClone(validLockedResponse);
  delete missing.roots.r0.slots.s1;
  parseTowerInitialSlotRepairResponse(missing, lockedSlotTargets);
}, /漏掉必需槽：s1/);
assert.throws(() => {
  const extra = structuredClone(validLockedResponse);
  extra.roots.r0.slots.s9 = { action: 'replace_value', value: '越权' };
  parseTowerInitialSlotRepairResponse(extra, lockedSlotTargets);
}, /返回未请求槽：s9/);
assert.throws(() => {
  const wrongAction = structuredClone(validLockedResponse);
  wrongAction.roots.r0.slots.s1.action = 'replace_value';
  parseTowerInitialSlotRepairResponse(wrongAction, lockedSlotTargets);
}, /action 不匹配/);
assert.throws(() => {
  const invalidEffect = structuredClone(validLockedResponse);
  const triggerSlot = lockedSlotTargets[1].slots.find(slot => slot.kind === 'trigger_mode_strategy');
  invalidEffect.roots.r1.slots[triggerSlot.token].value = { mode: 'passive', effects: [] };
  parseTowerInitialSlotRepairResponse(invalidEffect, lockedSlotTargets);
}, /非空持续效果数组/);
assert.throws(() => {
  const invalidModifier = structuredClone(validLockedResponse);
  const triggerSlot = lockedSlotTargets[1].slots.find(slot => slot.kind === 'trigger_mode_strategy');
  invalidModifier.roots.r1.slots[triggerSlot.token].value = {
    mode: 'passive', effects: [{ modify: { attribute: 'mirror_energy_max', value: 2 } }],
  };
  parseTowerInitialSlotRepairResponse(invalidModifier, lockedSlotTargets);
}, /权威 effects 校验/,
'a provider that ignores the deep schema cannot smuggle an object-shaped modifier through runtime parsing');

const invalidEventStatusOriginal = structuredClone(typedRepairOriginal);
invalidEventStatusOriginal.player.statuses[0] = {
  id: 'overclock_buff', name: '超频', emoji: '⚡', type: 'buff', stacks_change: 'reset',
  description: '下一次打出技能牌时额外结算一次。',
  triggers: { skill_played: { card_rule: 'replay', limit: 1, extra: 1, card_type: 'Skill' } },
};
const invalidEventStatusTargets = extractTowerInitialRepairSlotTargets(
  invalidEventStatusOriginal,
  'battle.statuses[0]：状态定义不合法（具体原因：状态 skill_played 不能包含持续修饰或出牌规则）',
);
assert.deepEqual(invalidEventStatusTargets[0].slots.map(slot => slot.kind), ['description', 'status_trigger_effect_sequence']);
const invalidEventStatusResponse = slotResponseFor(invalidEventStatusTargets, {
  'player.statuses[0]:description': '下一次打出技能牌时额外结算一次。',
  'player.statuses[0]:status_trigger_effect_sequence': [{ card_rule: 'replay', limit: 1, extra: 1, card_type: 'Skill' }],
});
assert.throws(
  () => parseTowerInitialSlotRepairResponse(invalidEventStatusResponse, invalidEventStatusTargets),
  /有限白名单主操作/,
  'event status triggers cannot retain continuous card rules when a provider ignores the schema',
);
const validEventStatusResponse = slotResponseFor(invalidEventStatusTargets, {
  'player.statuses[0]:description': '打出技能牌时抽1张牌。',
  'player.statuses[0]:status_trigger_effect_sequence': [{ draw: 1 }],
});
const validEventStatusMerged = mergeTowerInitialSlotRepair(
  invalidEventStatusOriginal,
  invalidEventStatusTargets,
  parseTowerInitialSlotRepairResponse(validEventStatusResponse, invalidEventStatusTargets),
);
assert.equal(validEventStatusMerged.player.statuses[0].name, '超频');
assert.equal(validEventStatusMerged.player.statuses[0].type, 'buff');
assert.equal(validEventStatusMerged.player.statuses[0].stacks_change, 'reset');
assert.deepEqual(validEventStatusMerged.player.statuses[0].triggers.skill_played, [{ draw: 1 }]);

const indexedStatusOriginal = structuredClone(typedRepairOriginal);
indexedStatusOriginal.player.statuses[0] = {
  id: 'combo_guard', name: '连锁守护', emoji: '🔗', type: 'buff', stacks_change: 'keep',
  description: '打出攻击牌时依次抽牌、造成伤害并获得格挡。',
  triggers: { attack_played: [{ draw: 1 }, { damage: 0 }, { block: 2 }] },
};
const indexedStatusTargets = extractTowerInitialRepairSlotTargets(
  indexedStatusOriginal,
  'battle.statuses[0]：状态定义不合法（具体原因：triggers.attack_played[1].damage：伤害必须大于 0）',
);
assert.deepEqual(indexedStatusTargets[0].slots.map(slot => slot.kind), ['description', 'status_trigger_effect_item']);
const indexedStatusMerged = mergeTowerInitialSlotRepair(
  indexedStatusOriginal,
  indexedStatusTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(indexedStatusTargets, {
    'player.statuses[0]:description': '打出攻击牌时依次抽牌、造成3点伤害并获得格挡。',
    'player.statuses[0]:status_trigger_effect_item': { damage: 3 },
  }), indexedStatusTargets),
);
assert.deepEqual(indexedStatusMerged.player.statuses[0].triggers.attack_played, [
  { draw: 1 }, { damage: 3 }, { block: 2 },
]);
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    indexedStatusOriginal,
    'battle.statuses[0]：状态定义不合法（具体原因：triggers.attack_played：效果序列存在无法定位到单项的规则错误）',
  ),
  [],
  'an unindexed status-trigger error cannot open an existing multi-item sequence',
);

const indexedHoldOriginal = structuredClone(typedRepairOriginal);
indexedHoldOriginal.player.statuses[0] = {
  id: 'layered_aegis', name: '层叠护盾', emoji: '🛡️', type: 'buff', stacks_change: 'keep',
  description: '提高格挡并降低受到的伤害。',
  triggers: { hold: [{ modify: 'block', add: 2 }, { modify: 'damage_taken', multiply: '80%' }] },
};
const indexedHoldTargets = extractTowerInitialRepairSlotTargets(
  indexedHoldOriginal,
  'battle.statuses[0]：状态定义不合法（具体原因：triggers.hold[1].multiply：不支持百分号数值）',
);
assert.deepEqual(indexedHoldTargets[0].slots.map(slot => slot.kind), ['description', 'status_hold_effect_item']);
const indexedHoldMerged = mergeTowerInitialSlotRepair(
  indexedHoldOriginal,
  indexedHoldTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(indexedHoldTargets, {
    'player.statuses[0]:description': '提高格挡并使受到的伤害降低20%。',
    'player.statuses[0]:status_hold_effect_item': { modify: 'damage_taken', multiply: 0.8 },
  }), indexedHoldTargets),
);
assert.deepEqual(indexedHoldMerged.player.statuses[0].triggers.hold, [
  { modify: 'block', add: 2 }, { modify: 'damage_taken', multiply: 0.8 },
]);

const resourcePaymentOriginal = structuredClone(typedRepairOriginal);
resourcePaymentOriginal.player.core.resources = [{
  id: 'charge', name: '星核充能', emoji: '✨', start: 1, max: 3, refresh: 'reset',
}];
resourcePaymentOriginal.player.cards[0] = {
  id: 'summon_proxy', name: '召唤星械代理机', type: 'Skill', rarity: 'Common', cost: 1, quantity: 2,
  description: '每额外消耗1点星核充能，召唤数量增加。',
  effects: { spawn_summon: { id: 'proxy' }, when: 'spent_resource.charge >= 1 && spent_resource.charge >= 2' },
};
const resourcePaymentTargets = extractTowerInitialRepairSlotTargets(
  resourcePaymentOriginal,
  [
    'battle.cards[0].effects.condition.conditions[0].left：公式读取了当前卡未支付的资源（具体原因：当前卡牌不会支付资源 charge）',
    'battle.cards[0].effects.condition.conditions[1].left：公式读取了当前卡未支付的资源（具体原因：当前卡牌不会支付资源 charge）',
  ].join('；'),
);
assert.deepEqual(
  resourcePaymentTargets[0].slots.map(slot => slot.kind),
  ['resource_payment_strategy', 'description'],
  'all diagnostics for one locked resource collapse to one semantic strategy plus its description',
);
assert.equal(resourcePaymentTargets[0].slots[0].preserveId, 'charge');
assert.deepEqual(resourcePaymentTargets[0].slots[0].resourceReferencePaths, ['player.cards[0].effects.when']);
const resourcePaymentMerged = mergeTowerInitialSlotRepair(
  resourcePaymentOriginal,
  resourcePaymentTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(resourcePaymentTargets, {
    'player.cards[0]:resource_payment_strategy': { mode: 'pay_resource', resource_id: 'charge', amount: 2 },
    'player.cards[0]:description': '支付2点星核充能；支付后按实际消耗量决定召唤数量。',
  }), resourcePaymentTargets),
);
assert.deepEqual(resourcePaymentMerged.player.cards[0].cost, { energy: 1, charge: 2 });
assert.equal(resourcePaymentMerged.player.cards[0].effects.when, resourcePaymentOriginal.player.cards[0].effects.when);
assert.equal(resourcePaymentMerged.player.cards[0].id, 'summon_proxy');
assert.deepEqual(resourcePaymentMerged.player.cards[1], resourcePaymentOriginal.player.cards[1]);
assert.throws(
  () => parseTowerInitialSlotRepairResponse(slotResponseFor(resourcePaymentTargets, {
    'player.cards[0]:resource_payment_strategy': { mode: 'pay_resource', resource_id: 'mana', amount: 2 },
    'player.cards[0]:description': '支付资源。',
  }), resourcePaymentTargets),
  /程序锁定资源 ID/,
  'the model cannot substitute a different resource id',
);
const readCurrentMerged = mergeTowerInitialSlotRepair(
  resourcePaymentOriginal,
  resourcePaymentTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(resourcePaymentTargets, {
    'player.cards[0]:resource_payment_strategy': { mode: 'read_current_resource' },
    'player.cards[0]:description': '不消耗星核充能；当前充能至少为1且至少为2时召唤。',
  }), resourcePaymentTargets),
);
assert.equal(readCurrentMerged.player.cards[0].cost, 1);
assert.equal(
  readCurrentMerged.player.cards[0].effects.when,
  'self.resource.charge.current >= 1 && self.resource.charge.current >= 2',
  'read-current mode changes only the locked formula references',
);

const xResourceOriginal = structuredClone(resourcePaymentOriginal);
xResourceOriginal.player.cards[0].effects.when = 'x_resource.charge >= 2';
const xResourceTargets = extractTowerInitialRepairSlotTargets(
  xResourceOriginal,
  'battle.cards[0].effects.condition.left：X_RESOURCE_NOT_ALLOWED（具体原因：当前卡牌没有资源 charge 的 X 费用）',
);
assert.throws(
  () => parseTowerInitialSlotRepairResponse(slotResponseFor(xResourceTargets, {
    'player.cards[0]:resource_payment_strategy': { mode: 'pay_resource', resource_id: 'charge', amount: 2 },
    'player.cards[0]:description': '支付2点星核充能。',
  }), xResourceTargets),
  /使用 x_resource 时必须选择支付全部资源/,
);

const nextAttackModifierOriginal = structuredClone(typedRepairOriginal);
nextAttackModifierOriginal.player.statuses[0] = {
  id: 'hardening', name: '硬化', emoji: '💪', type: 'buff', stacks_change: -1,
  description: '每层使你下一次攻击造成的伤害+2。',
  triggers: {
    attack_played: [{ modify: 'damage', add: '2 * stacks', to: 'self', when: 'false' }],
    turn_start: [{ block: 1 }],
  },
};
const nextAttackModifierTargets = extractTowerInitialRepairSlotTargets(
  nextAttackModifierOriginal,
  'battle.statuses[0]：状态定义不合法（具体原因：triggers.attack_played[0].when: Unknown field: when）',
);
assert.deepEqual(
  nextAttackModifierTargets[0].slots.map(slot => slot.kind),
  ['status_next_attack_modifier_strategy'],
);
const nextAttackModifierMerged = mergeTowerInitialSlotRepair(
  nextAttackModifierOriginal,
  nextAttackModifierTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(nextAttackModifierTargets, {
    'player.statuses[0]:status_next_attack_modifier_strategy': { mode: 'hold_until_next_attack' },
  }), nextAttackModifierTargets),
);
assert.deepEqual(nextAttackModifierMerged.player.statuses[0].triggers.hold, { modify: 'damage', add: '2 * stacks' });
assert.deepEqual(nextAttackModifierMerged.player.statuses[0].triggers.attack_played, [
  { remove_status: 'hardening', to: 'self' },
]);
assert.deepEqual(
  nextAttackModifierMerged.player.statuses[0].triggers.turn_start,
  nextAttackModifierOriginal.player.statuses[0].triggers.turn_start,
  'next-attack migration preserves every sibling trigger',
);
assert.equal(nextAttackModifierMerged.player.statuses[0].stacks_change, -1);
assert.throws(
  () => parseTowerInitialSlotRepairResponse(slotResponseFor(nextAttackModifierTargets, {
    'player.statuses[0]:status_next_attack_modifier_strategy': { mode: 'rewrite_damage', amount: 999 },
  }), nextAttackModifierTargets),
  /下一次攻击持续修饰策略/,
  'the model cannot rewrite the locked modifier value',
);
const existingHoldNextAttack = structuredClone(nextAttackModifierOriginal);
existingHoldNextAttack.player.statuses[0].triggers.hold = { modify: 'block', add: 1 };
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    existingHoldNextAttack,
    'battle.statuses[0]：状态定义不合法（具体原因：triggers.attack_played[0].when: Unknown field: when）',
  ),
  [],
  'a next-attack migration cannot overwrite an existing hold rule',
);

const quantityStrategyOriginal = structuredClone(typedRepairOriginal);
quantityStrategyOriginal.player.cards[0] = {
  ...quantityStrategyOriginal.player.cards[0], id: 'mirror_placeholder', quantity: 0,
};
const quantityStrategyTargets = extractTowerInitialRepairSlotTargets(
  quantityStrategyOriginal,
  'battle.cards[0].quantity：数量必须是 1 到 100 的整数',
);
assert.deepEqual(quantityStrategyTargets[0].slots.map(slot => slot.kind), ['card_quantity_strategy']);
assert.deepEqual(
  quantityStrategyTargets[0].slots[0].allowedModes,
  ['set_owned_quantity', 'remove_unowned_card'],
);
const positiveQuantityMerged = mergeTowerInitialSlotRepair(
  quantityStrategyOriginal,
  quantityStrategyTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(quantityStrategyTargets, {
    'player.cards[0]:card_quantity_strategy': { mode: 'set_owned_quantity', quantity: 2 },
  }), quantityStrategyTargets),
);
assert.equal(positiveQuantityMerged.player.cards[0].quantity, 2);
assert.equal(positiveQuantityMerged.player.cards[0].id, 'mirror_placeholder');
const removedQuantityMerged = mergeTowerInitialSlotRepair(
  quantityStrategyOriginal,
  quantityStrategyTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(quantityStrategyTargets, {
    'player.cards[0]:card_quantity_strategy': { mode: 'remove_unowned_card' },
  }), quantityStrategyTargets),
);
assert.deepEqual(removedQuantityMerged.player.cards, [quantityStrategyOriginal.player.cards[1]]);
for (const invalidQuantity of [1.5, 101]) {
  const invalidQuantityOriginal = structuredClone(quantityStrategyOriginal);
  invalidQuantityOriginal.player.cards[0].quantity = invalidQuantity;
  assert.deepEqual(
    extractTowerInitialRepairSlotTargets(
      invalidQuantityOriginal,
      'battle.cards[0].quantity：数量必须是 1 到 100 的整数',
    )[0].slots.map(slot => slot.kind),
    ['card_quantity_strategy'],
  );
}
const soleQuantityOriginal = structuredClone(quantityStrategyOriginal);
soleQuantityOriginal.player.cards = [soleQuantityOriginal.player.cards[0]];
const soleQuantityTargets = extractTowerInitialRepairSlotTargets(
  soleQuantityOriginal,
  'battle.cards[0].quantity：数量必须是 1 到 100 的整数',
);
assert.deepEqual(soleQuantityTargets[0].slots[0].allowedModes, ['set_owned_quantity']);
assert.throws(
  () => parseTowerInitialSlotRepairResponse(slotResponseFor(soleQuantityTargets, {
    'player.cards[0]:card_quantity_strategy': { mode: 'remove_unowned_card' },
  }), soleQuantityTargets),
  /持有卡数量策略/,
  'removing the final owned card is not exposed',
);
const referencedQuantityOriginal = structuredClone(quantityStrategyOriginal);
referencedQuantityOriginal.player.player_abilities = [{
  id: 'mirror_lookup', name: '镜中检索',
  trigger: { on: 'turn_start', effects: { seek: 1, template_id: 'mirror_placeholder' } },
}];
const referencedQuantityTargets = extractTowerInitialRepairSlotTargets(
  referencedQuantityOriginal,
  'battle.cards[0].quantity：数量必须是 1 到 100 的整数',
);
assert.deepEqual(referencedQuantityTargets[0].slots[0].allowedModes, ['set_owned_quantity']);

const unknownEffectOriginal = structuredClone(typedRepairOriginal);
unknownEffectOriginal.player.cards[0] = {
  ...unknownEffectOriginal.player.cards[0],
  description: '抽2张牌，并保留手牌。',
  effects: [{ draw: 2 }, { card_rule: { retain_hand: 1 } }],
};
const unknownEffectTargets = extractTowerInitialRepairSlotTargets(
  unknownEffectOriginal,
  'battle.cards[0].effects[1].card_rule：规则字段不符合浅层 effects 契约',
);
assert.deepEqual(
  unknownEffectTargets[0].slots.map(slot => slot.kind),
  ['description', 'unknown_effect_item_strategy'],
);
const unknownEffectMerged = mergeTowerInitialSlotRepair(
  unknownEffectOriginal,
  unknownEffectTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(unknownEffectTargets, {
    'player.cards[0]:description': '抽2张牌并获得3点格挡。',
    'player.cards[0]:unknown_effect_item_strategy': { block: 3 },
  }), unknownEffectTargets),
);
assert.deepEqual(unknownEffectMerged.player.cards[0].effects, [{ draw: 2 }, { block: 3 }]);
assert.deepEqual(unknownEffectMerged.player.cards[1], unknownEffectOriginal.player.cards[1]);
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    unknownEffectOriginal,
    'battle.cards[0].effects：规则字段不符合浅层 effects 契约',
  ),
  [],
  'an unindexed unknown effect array still fails closed',
);

const skillTriggerOriginal = structuredClone(resourcePaymentOriginal);
skillTriggerOriginal.player.cards[0] = {
  id: 'spam_refactor', name: '循环重构', type: 'Skill', rarity: 'Uncommon', cost: 2, quantity: 1,
  description: '获得2点调试数据；本场战斗中每打出两张牌，从弃牌堆回收一张牌。',
  effects: { resource: { id: 'charge', amount: 2 } },
  trigger: {
    on: 'card_played',
    effects: { recover: 1, from: 'discard', pick: 'random', when: 'cards_played_this_turn % 2 == 0' },
  },
};
const skillTriggerTargets = extractTowerInitialRepairSlotTargets(
  skillTriggerOriginal,
  'battle.cards[0].trigger：规则字段不符合浅层 effects 契约',
);
assert.deepEqual(skillTriggerTargets[0].slots.map(slot => slot.kind), ['skill_trigger_classification_strategy']);
const skillTriggerMerged = mergeTowerInitialSlotRepair(
  skillTriggerOriginal,
  skillTriggerTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(skillTriggerTargets, {
    'player.cards[0]:skill_trigger_classification_strategy': { mode: 'promote_to_power' },
  }), skillTriggerTargets),
);
assert.equal(skillTriggerMerged.player.cards[0].type, 'Power');
assert.deepEqual(skillTriggerMerged.player.cards[0].effects, skillTriggerOriginal.player.cards[0].effects);
assert.deepEqual(skillTriggerMerged.player.cards[0].trigger, skillTriggerOriginal.player.cards[0].trigger);
const invalidSkillTrigger = structuredClone(skillTriggerOriginal);
invalidSkillTrigger.player.cards[0].trigger.on = 'resource_changed';
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    invalidSkillTrigger,
    'battle.cards[0].trigger：规则字段不符合浅层 effects 契约',
  ),
  [],
  'an invalid trigger cannot be hidden by Skill-to-Power classification',
);

const conditionAliasOriginal = structuredClone(typedRepairOriginal);
conditionAliasOriginal.player.cards[0] = {
  ...conditionAliasOriginal.player.cards[0],
  description: '造成6点伤害；本回合打出过技能牌时再造成6点伤害。',
  effects: [
    { damage: 6, targets: { mode: 'active' } },
    {
      damage: 6, when: 'targets_count > 0', when_condition: 'skills_played_this_turn > 0',
      targets: { mode: 'active' },
    },
  ],
};
const conditionAliasTargets = extractTowerInitialRepairSlotTargets(
  conditionAliasOriginal,
  [
    'battle.cards[0].effects[1].when_condition：规则字段不符合浅层 effects 契约（具体原因：该操作必须单独占一个 effects 数组项）',
    'battle.cards[0].effects[1]：规则字段不符合浅层 effects 契约（具体原因：Only common numeric, status, and draw effects may share one object; use separate array entries for every other operation）',
  ].join('；'),
);
assert.deepEqual(conditionAliasTargets[0].slots.map(slot => slot.kind), ['condition_alias_strategy']);
assert.deepEqual(conditionAliasTargets[0].slots[0].allowedModes, ['use_when_condition']);
const conditionAliasSchema = createTowerInitialSlotRepairJsonSchema(conditionAliasTargets);
assert.deepEqual(
  conditionAliasSchema.value.properties.roots.properties.r0.properties.slots.properties.s0
    .properties.value.properties.mode.enum,
  ['use_when_condition'],
);
const conditionAliasMerged = mergeTowerInitialSlotRepair(
  conditionAliasOriginal,
  conditionAliasTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(conditionAliasTargets, {
    'player.cards[0]:condition_alias_strategy': { mode: 'use_when_condition' },
  }), conditionAliasTargets),
);
assert.equal(conditionAliasMerged.player.cards[0].effects[1].when, 'skills_played_this_turn > 0');
assert.equal('when_condition' in conditionAliasMerged.player.cards[0].effects[1], false);
assert.deepEqual(conditionAliasMerged.player.cards[0].effects[0], conditionAliasOriginal.player.cards[0].effects[0]);
assert.throws(
  () => parseTowerInitialSlotRepairResponse(slotResponseFor(conditionAliasTargets, {
    'player.cards[0]:condition_alias_strategy': { mode: 'custom', when: 'self.hp > 0' },
  }), conditionAliasTargets),
  /条件别名策略/,
  'condition strategies never accept an arbitrary formula',
);

const addCardDestinationOriginal = structuredClone(typedRepairOriginal);
addCardDestinationOriginal.player.cards[0] = {
  id: 'recursive_strike', name: '递归', type: 'Attack', rarity: 'Rare', cost: 1, quantity: 1,
  description: '造成5点伤害，将一张回响加入抽牌堆。',
  effects: [{ damage: 5 }, { add_card: 'recursive_echo', to: 'draw', count: 1 }],
  creates: [{ id: 'recursive_echo', name: '回响', type: 'Skill', rarity: 'Common', cost: 0, effects: { draw: 1 } }],
};
const addCardDestinationTargets = extractTowerInitialRepairSlotTargets(
  addCardDestinationOriginal,
  'battle.cards[0].effects[1].to: add_card to must be hand, deck, or discard',
);
assert.deepEqual(
  addCardDestinationTargets[0].slots.map(slot => slot.kind),
  ['description', 'add_card_destination'],
);
const addCardDestinationMerged = mergeTowerInitialSlotRepair(
  addCardDestinationOriginal,
  addCardDestinationTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(addCardDestinationTargets, {
    'player.cards[0]:description': '造成5点伤害，将一张回响加入抽牌堆。',
    'player.cards[0]:add_card_destination': 'deck',
  }), addCardDestinationTargets),
);
assert.equal(addCardDestinationMerged.player.cards[0].effects[1].to, 'deck');
assert.deepEqual(addCardDestinationMerged.player.cards[0].effects[0], addCardDestinationOriginal.player.cards[0].effects[0]);
assert.throws(
  () => parseTowerInitialSlotRepairResponse(slotResponseFor(addCardDestinationTargets, {
    'player.cards[0]:description': '加入抽牌堆。',
    'player.cards[0]:add_card_destination': 'draw',
  }), addCardDestinationTargets),
  /合法 add_card 目标牌区/,
);

const scalarStatusOriginal = structuredClone(typedRepairOriginal);
scalarStatusOriginal.player.statuses[0] = {
  id: 'decaying_guard', name: '衰减护盾', emoji: '🛡️', type: 'buff', description: '每回合减少1层。',
  stacks_change: '-1', maxStacks: 9,
  triggers: { hold: { modify: 'block', add: 'stacks' }, turn_start: { block: 1 } },
};
const scalarStatusTargets = extractTowerInitialRepairSlotTargets(
  scalarStatusOriginal,
  'battle.statuses[0]：状态定义不合法（具体原因：状态 stacks_change 无效）',
);
assert.deepEqual(scalarStatusTargets[0].slots.map(slot => slot.kind), ['status_stacks_change']);
const scalarStatusMerged = mergeTowerInitialSlotRepair(
  scalarStatusOriginal,
  scalarStatusTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(scalarStatusTargets, {
    'player.statuses[0]:status_stacks_change': -1,
  }), scalarStatusTargets),
);
assert.equal(scalarStatusMerged.player.statuses[0].stacks_change, -1);
assert.deepEqual(
  scalarStatusMerged.player.statuses[0].triggers,
  scalarStatusOriginal.player.statuses[0].triggers,
  'repairing stacks_change cannot alter a sibling status trigger',
);

assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    typedRepairOriginal,
    'battle.cards[0]：缺少状态定义，但诊断没有返回具体 ID',
  ),
  [],
  'generic missing-support diagnostics without an exact ID fail closed',
);
assert.throws(
  () => parseTowerInitialSlotRepairResponse({
    spec: TOWER_INITIAL_SLOT_REPAIR_SPEC,
    roots: { r0: { slots: {} } },
    support_statuses: [],
    support_resources: [],
  }, [{
    token: 'r0', path: 'player.cards[0]', original: typedRepairOriginal.player.cards[0], errors: [], slots: [],
    allowSupportStatuses: true, allowSupportResources: false, supportStatusIds: [], supportResourceIds: [],
  }]),
  /缺少程序锁定的状态 ID/,
  'the runtime parser independently rejects a support permission without exact IDs',
);

const lustSupportOriginal = structuredClone(typedRepairOriginal);
lustSupportOriginal.player.player_lust_effect = {
  name: '镜像屏障', emoji: '🪞', description: '欲望满溢时获得一层镜像屏障。',
  effects: { apply_status: 'mirror_barrier', stacks: 1, to: 'self' },
};
const lustSupportTargets = extractTowerInitialRepairSlotTargets(
  lustSupportOriginal,
  'battle.player_lust_effect.effects.status：引用了未注册状态（具体原因：状态未注册: mirror_barrier）',
);
assert.deepEqual(lustSupportTargets.map(root => root.path), ['player.player_lust_effect']);
assert.deepEqual(lustSupportTargets[0].slots, []);
assert.deepEqual(lustSupportTargets[0].supportStatusIds, ['mirror_barrier']);
const lustSupportResponse = {
  spec: TOWER_INITIAL_SLOT_REPAIR_SPEC,
  roots: { r0: { slots: {} } },
  support_statuses: [{
    id: 'mirror_barrier', name: '镜像屏障', emoji: '🪞', type: 'buff', stacks_change: -1,
    triggers: { hold: { modify: 'block', add: 2 } },
  }],
  support_resources: [],
};
const lustSupportMerged = mergeTowerInitialSlotRepair(
  lustSupportOriginal,
  lustSupportTargets,
  parseTowerInitialSlotRepairResponse(lustSupportResponse, lustSupportTargets),
);
assert.deepEqual(lustSupportMerged.player.statuses.map(status => status.id), ['existing_status', 'mirror_barrier']);

const templateAndSupportOriginal = structuredClone(typedRepairOriginal);
templateAndSupportOriginal.player.cards[0] = {
  id: 'debug_light', name: '调试之光', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
  description: '将一张报错置入弃牌堆。', effects: { add_card: 'error', to: 'discard' },
  creates: [{ id: 'error', name: '报错', type: 'Curse', description: '无法打出。', quantity: 1 }],
};
templateAndSupportOriginal.player.player_lust_effect = {
  name: '镜像屏障', emoji: '🪞', description: '欲望满溢时获得一层镜像屏障。',
  effects: [{ block: 3 }, { apply_status: 'mirror_barrier', stacks: 1, to: 'self' }],
};
templateAndSupportOriginal.player = normalizeMvuBattleContent(templateAndSupportOriginal.player);
assert.equal(
  Object.hasOwn(templateAndSupportOriginal.player.cards[0].creates[0], 'quantity'),
  false,
  'the real nested creates.quantity:1 regression is canonicalized before authoritative validation',
);
const templateAndSupportTargets = extractTowerInitialRepairSlotTargets(
  templateAndSupportOriginal,
  'battle.player_lust_effect.effects[1].status：引用了未注册状态（具体原因：状态未注册: mirror_barrier）',
);
assert.equal(templateAndSupportTargets.length, 1, 'the remaining exact missing status needs only one repair root');
assert.deepEqual(templateAndSupportTargets[0].slots, []);
assert.deepEqual(templateAndSupportTargets[0].supportStatusIds, ['mirror_barrier']);
const templateAndSupportMerged = mergeTowerInitialSlotRepair(
  templateAndSupportOriginal,
  templateAndSupportTargets,
  parseTowerInitialSlotRepairResponse({
    spec: TOWER_INITIAL_SLOT_REPAIR_SPEC,
    roots: { r0: { slots: {} } },
    support_statuses: [{
      id: 'mirror_barrier', name: '镜像屏障', emoji: '🪞', type: 'buff', stacks_change: -1,
      triggers: { hold: { modify: 'block', add: 2 } },
    }],
    support_resources: [],
  }, templateAndSupportTargets),
);
assert.equal(templateAndSupportMerged.player.statuses.at(-1).id, 'mirror_barrier');

const ambiguousSequenceOriginal = structuredClone(typedRepairOriginal);
ambiguousSequenceOriginal.player.cards[0].effects = [{ damage: 4 }, { block: 3 }];
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    ambiguousSequenceOriginal,
    'battle.cards[0].effects：效果序列存在无法定位到单项的规则错误',
  ),
  [],
  'an unindexed error cannot open an existing multi-item effect sequence',
);

const guardedPowerOriginal = structuredClone(typedRepairOriginal);
guardedPowerOriginal.player.cards[0] = {
  ...guardedPowerOriginal.player.cards[0], type: 'Power', effects: { block: 4 },
  trigger: { on: 'turn_start', effects: { block: 1 } },
};
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    guardedPowerOriginal,
    'battle.cards[0]：Power 必须至少包含真实触发能力',
  ),
  [],
  'card type repair is unavailable while an authored trigger still exists',
);

const supportOnlyOriginal = structuredClone(typedRepairOriginal);
supportOnlyOriginal.player.core.resources = [];
supportOnlyOriginal.opening.choices[0] = {
  id: 'gift_star_core', label: '星核储备', outcome: { reward: { cards: [{
    id: 'star_bolt', name: '星核光束', type: 'Attack', rarity: 'Common', cost: { energy: 1, star_core: 1 },
    quantity: 1, description: '消耗星核造成伤害。', effects: { damage: 8 },
  }] } },
};
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    supportOnlyOriginal,
    'opening.choices 奖励：开局馈赠 gift_star_core.cards[0] 星核光束 无效：费用引用了未注册资源: star_core',
  ),
  [],
  'an unchosen opening reward cannot register a missing resource in player.core',
);

const summonLifecycleOriginal = structuredClone(typedRepairOriginal);
summonLifecycleOriginal.player.cards[0] = {
  id: 'call_familiar', name: '召来使魔', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
  description: '召唤一只会攻击的星猫。',
  effects: {
    spawn_summon: {
      id: 'star_cat', name: '星猫', emoji: '🐈', max_hp: 8,
      actions: [{ id: 'claw', name: '星爪', effects: { damage: 3 } }],
      on_destroyed: 'default',
    },
  },
};
const summonLifecycleTargets = extractTowerInitialRepairSlotTargets(
  summonLifecycleOriginal,
  'battle.cards[0].effects.spawn_summon.on_destroyed：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 on_destroyed）',
);
assert.deepEqual(summonLifecycleTargets[0].slots.map(slot => slot.kind), ['summon_lifecycle_default']);
const summonLifecycleMerged = mergeTowerInitialSlotRepair(
  summonLifecycleOriginal,
  summonLifecycleTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(summonLifecycleTargets, {
    'player.cards[0]:summon_lifecycle_default': { mode: 'use_runtime_default' },
  }), summonLifecycleTargets),
);
assert.equal(Object.hasOwn(summonLifecycleMerged.player.cards[0].effects.spawn_summon, 'on_destroyed'), false);
const summonLifecycleExpected = structuredClone(summonLifecycleOriginal);
delete summonLifecycleExpected.player.cards[0].effects.spawn_summon.on_destroyed;
assert.deepEqual(
  summonLifecycleMerged,
  summonLifecycleExpected,
  'runtime-default lifecycle compatibility must change exactly the locked on_destroyed path',
);
const invalidExistingLifecycle = structuredClone(summonLifecycleOriginal);
invalidExistingLifecycle.player.cards[0].effects.spawn_summon.on_existing = 'reuse';
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    invalidExistingLifecycle,
    [
      'battle.cards[0].effects.spawn_summon.on_destroyed：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 on_destroyed）',
      'battle.cards[0].effects.spawn_summon.on_existing：INVALID_SUMMON_POLICY: on_existing must be reinforce or replace',
    ].join('；'),
  ),
  [],
  'a second invalid lifecycle policy on the same summon blocks default compatibility',
);
const missingSlotLifecycle = structuredClone(summonLifecycleOriginal);
missingSlotLifecycle.player.cards[0].effects.spawn_summon.on_existing = 'replace';
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    missingSlotLifecycle,
    [
      'battle.cards[0].effects.spawn_summon.on_destroyed：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 on_destroyed）',
      'battle.cards[0].effects.spawn_summon：MISSING_SUMMON_SLOT: unique summon policies require slot',
    ].join('；'),
  ),
  [],
  'a summon-level missing-slot invariant blocks default compatibility',
);
const invalidSlotLifecycle = structuredClone(summonLifecycleOriginal);
invalidSlotLifecycle.player.cards[0].effects.spawn_summon.slot = '无效槽位';
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    invalidSlotLifecycle,
    [
      'battle.cards[0].effects.spawn_summon.on_destroyed：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 on_destroyed）',
      'battle.cards[0].effects.spawn_summon.slot：INVALID_SUMMON_SLOT: summon slot must be stable English',
    ].join('；'),
  ),
  [],
  'an invalid slot on the same summon blocks default compatibility',
);
const nonDefaultSummonLifecycle = structuredClone(summonLifecycleOriginal);
nonDefaultSummonLifecycle.player.cards[0].effects.spawn_summon.on_destroyed = 'revive';
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(
    nonDefaultSummonLifecycle,
    'battle.cards[0].effects.spawn_summon.on_destroyed：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 on_destroyed）',
  ),
  [],
  'non-default legacy lifecycle values remain fail-closed',
);

const triggerOnOriginal = structuredClone(typedRepairOriginal);
triggerOnOriginal.player.player_abilities[0].trigger = { on: 'eal_damage', effects: { block: 2 } };
const triggerOnTargets = extractTowerInitialRepairSlotTargets(
  triggerOnOriginal,
  'battle.player_abilities[0].trigger.on：不支持的触发器 eal_damage',
);
assert.deepEqual(triggerOnTargets[0].slots.map(slot => slot.kind), ['trigger_on']);
const triggerOnMerged = mergeTowerInitialSlotRepair(
  triggerOnOriginal,
  triggerOnTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(triggerOnTargets, {
    'player.player_abilities[0]:trigger_on': 'deal_damage',
  }), triggerOnTargets),
);
assert.equal(triggerOnMerged.player.player_abilities[0].trigger.on, 'deal_damage');
assert.deepEqual(triggerOnMerged.player.player_abilities[0].trigger.effects, { block: 2 });

const observedSummonFailure = structuredClone(typedRepairOriginal);
observedSummonFailure.player.cards[0] = {
  id: 'sun_contract', name: '太阳契约', type: 'Power', rarity: 'Uncommon', cost: 2, quantity: 1,
  description: '每回合开始时获得1层星辉充能。', effects: { apply_status: 'astral_charge' },
  trigger: { on: 'turn_start', effects: { apply_status: { status_id: 'astral_charge_case' } } },
};
observedSummonFailure.player.statuses[0] = {
  id: 'astral_charge', name: '星辉充能', emoji: '✨', type: 'buff',
  description: '每层提高1点召唤容量。', triggers: { hold: { modify: 'summon_capacity' } },
};
observedSummonFailure.opening.choices[0] = {
  id: 'choice_orb_3', label: '星空之镜',
  outcome: { reward: { artifacts: [{
    id: 'starmirror', name: '星空之镜', rarity: 'Rare',
    description: '战斗开始获得1点星尘，且首次打出攻击牌时召唤星屑精灵。',
    trigger: { on: 'battle_start', effects: { resource: { id: 'stardust', amount: 1 } } },
    trigger2: { on: 'attack_played', effects: { damage: 2 } },
  }] } },
};
const observedSummonTargets = extractTowerInitialRepairSlotTargets(observedSummonFailure, [
  'battle.statuses[0].triggers.hold：状态定义不合法（具体原因：triggers.hold: modify requires exactly one of add/subtract/multiply/divide/set）',
  'battle.cards[0].trigger.effects.apply_status：规则字段不符合浅层 effects 契约',
  'opening.choices 奖励：开局馈赠 choice_orb_3.artifacts[0] 星空之镜 无效：relics[0].trigger2: unsupported content field: trigger2',
].join('；'));
assert.deepEqual(
  observedSummonTargets,
  [],
  'two authored triggers remain unmappable until a dedicated finite trigger-composition strategy exists',
);

const copyRepairOriginal = structuredClone(typedRepairOriginal);
copyRepairOriginal.player.cards[0] = {
  id: 'reflective_program', name: '反射程序', type: 'Skill', rarity: 'Common', cost: 'energy', quantity: 1,
  description: '从弃牌堆选择一张牌，本回合内可免费打出一次。',
  effects: [
    { apply_status: 'existing_status', stacks: 1, to: 'self' },
    { copy: 1, from: 'discard', pick: 'choose', card_rule: 'free', target_rule: 'self' },
  ],
};
const copyRepairTargets = extractTowerInitialRepairSlotTargets(copyRepairOriginal, [
  'battle.cards[0].effects[1].copy：规则字段不符合浅层 effects 契约（具体原因：该操作必须单独占一个 effects 数组项）',
  'battle.cards[0].effects[1].card_rule：规则字段不符合浅层 effects 契约（具体原因：该操作必须单独占一个 effects 数组项）',
  'battle.cards[0].effects[1].target_rule：规则字段不符合浅层 effects 契约',
].join('；'));
assert.deepEqual(copyRepairTargets[0].slots.map(slot => slot.kind), ['description', 'card_copy_strategy']);
const copyRepairResponse = slotResponseFor(copyRepairTargets, {
  'player.cards[0]:description': '从弃牌堆选择一张牌，将一个保留原费用的副本放入手牌。',
  'player.cards[0]:card_copy_strategy': { mode: 'copy_at_original_cost' },
});
const copyRepairMerged = mergeTowerInitialSlotRepair(
  copyRepairOriginal,
  copyRepairTargets,
  parseTowerInitialSlotRepairResponse(copyRepairResponse, copyRepairTargets),
);
assert.deepEqual(copyRepairMerged.player.cards[0].effects[1], {
  copy: 1, from: 'discard', pick: 'choose', to: 'hand',
});
assert.equal(copyRepairMerged.player.cards[0].cost, 'energy', 'copy repair cannot mutate card cost');

const doubleRepairOriginal = structuredClone(copyRepairOriginal);
delete doubleRepairOriginal.player.cards[0].effects[1].copy;
doubleRepairOriginal.player.cards[0].effects[1].double = 1;
const doubleTargets = extractTowerInitialRepairSlotTargets(doubleRepairOriginal,
  'battle.cards[0].effects[1].double：规则字段不符合浅层 effects 契约（具体原因：该操作必须单独占一个 effects 数组项）');
assert.equal(doubleTargets.some(target => target.slots.some(slot => slot.kind === 'card_copy_strategy')), false,
  'double marks an existing card for replay; it cannot enter a strategy promising a new copy');

const redundantEmptyTriggerOriginal = structuredClone(lockedSlotOriginal);
redundantEmptyTriggerOriginal.opening.choices[0].outcome.reward.cards[0] = {
  id: 'opening_recurse', name: '底层递归', type: 'Power', rarity: 'Rare', cost: 1, quantity: 1,
  description: '获得1层镜界回路。', effects: { apply_status: 'mirror_loop' },
  trigger: { on: 'passive', effects: {} },
};
const redundantEmptyTriggerTargets = extractTowerInitialRepairSlotTargets(
  redundantEmptyTriggerOriginal,
  'opening.choices 奖励：开局馈赠 discard_gift.cards[0] 底层递归 无效：cards[0].trigger.effects: Effect must contain one operation plus optional to/when fields',
);
assert.deepEqual(redundantEmptyTriggerTargets[0].slots.map(slot => slot.kind), ['remove_field']);
const redundantEmptyTriggerMerged = mergeTowerInitialSlotRepair(
  redundantEmptyTriggerOriginal,
  redundantEmptyTriggerTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(redundantEmptyTriggerTargets, {
    'opening.choices[0]:remove_field': undefined,
  }), redundantEmptyTriggerTargets),
);
assert.equal('trigger' in redundantEmptyTriggerMerged.opening.choices[0].outcome.reward.cards[0], false);

const passiveEmptyTriggerOriginal = structuredClone(lockedSlotOriginal);
passiveEmptyTriggerOriginal.opening.choices[0] = {
  id: 'capacitor_gift', label: '蓄能核心',
  outcome: { reward: { artifacts: [{
    id: 'energy_capacitor', name: '能量蓄电池', rarity: 'Rare',
    description: '持有时，最大充能提高5点。',
    marker: 'must_stay_locked',
    trigger: { on: 'passive', effects: [] },
  }] } },
};
const passiveEmptyTriggerTargets = extractTowerInitialRepairSlotTargets(
  passiveEmptyTriggerOriginal,
  'opening.choices 奖励：开局馈赠 capacitor_gift.artifacts[0] 能量蓄电池 无效：relics[0].trigger.effects: Effect sequence must contain at least one effect',
);
assert.deepEqual(
  passiveEmptyTriggerTargets[0].slots.map(slot => slot.kind),
  ['description', 'passive_effect_sequence'],
  'an empty passive trigger opens only its description and finite persistent-effect sequence',
);
const passiveEmptyTriggerMerged = mergeTowerInitialSlotRepair(
  passiveEmptyTriggerOriginal,
  passiveEmptyTriggerTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(passiveEmptyTriggerTargets, {
    'opening.choices[0]:description': '持有时，造成的伤害提高5点。',
    'opening.choices[0]:passive_effect_sequence': [{ modify: 'damage', add: 5 }],
  }), passiveEmptyTriggerTargets),
);
assert.deepEqual(
  passiveEmptyTriggerMerged.opening.choices[0].outcome.reward.artifacts[0].trigger,
  { on: 'passive', effects: [{ modify: 'damage', add: 5 }] },
);
assert.equal(
  passiveEmptyTriggerMerged.opening.choices[0].outcome.reward.artifacts[0].marker,
  'must_stay_locked',
  'empty-trigger repair preserves every field outside the exact effects/description write set',
);
assert.throws(
  () => parseTowerInitialSlotRepairResponse(slotResponseFor(passiveEmptyTriggerTargets, {
    'opening.choices[0]:description': '战斗开始时获得1点能量。',
    'opening.choices[0]:passive_effect_sequence': [{ energy: 1 }],
  }), passiveEmptyTriggerTargets),
  /modify\/card_rule/,
  'a passive trigger slot rejects one-shot effects',
);

const eventEmptyTriggerOriginal = structuredClone(typedRepairOriginal);
eventEmptyTriggerOriginal.player.player_abilities[0] = {
  id: 'start_guard', name: '启程防护', description: '战斗开始时获得4点格挡。', marker: 'locked',
  trigger: { on: 'battle_start', scope: 'combat', effects: {} },
};
const eventEmptyTriggerTargets = extractTowerInitialRepairSlotTargets(
  eventEmptyTriggerOriginal,
  'battle.player_abilities[0].trigger.effects：效果序列不能为空',
);
assert.deepEqual(
  eventEmptyTriggerTargets[0].slots.map(slot => slot.kind),
  ['description', 'effect_sequence'],
  'an empty event trigger opens only its description and finite one-shot effect sequence',
);
const eventEmptyTriggerMerged = mergeTowerInitialSlotRepair(
  eventEmptyTriggerOriginal,
  eventEmptyTriggerTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(eventEmptyTriggerTargets, {
    'player.player_abilities[0]:description': '战斗开始时获得4点格挡。',
    'player.player_abilities[0]:effect_sequence': [{ block: 4 }],
  }), eventEmptyTriggerTargets),
);
assert.deepEqual(eventEmptyTriggerMerged.player.player_abilities[0].trigger, {
  on: 'battle_start', scope: 'combat', effects: [{ block: 4 }],
});
assert.equal(eventEmptyTriggerMerged.player.player_abilities[0].marker, 'locked');
assert.throws(
  () => parseTowerInitialSlotRepairResponse(slotResponseFor(eventEmptyTriggerTargets, {
    'player.player_abilities[0]:description': '持续提高伤害。',
    'player.player_abilities[0]:effect_sequence': [{ modify: 'damage', add: 4 }],
  }), eventEmptyTriggerTargets),
  /有限白名单主操作/,
  'an event trigger slot rejects persistent modifiers',
);

const spacedStatusDiagnosticOriginal = structuredClone(typedRepairOriginal);
spacedStatusDiagnosticOriginal.player.statuses[0] = {
  id: 'sturdy', name: '不屈', emoji: '🛡️', type: 'buff', stacks_change: -1,
  description: '受到致命伤害时改为造成1点伤害，然后获得2点格挡。',
  triggers: {
    take_damage: [
      { damage: 0, ' to': 'self', when: 'self.hp - {} <= 1' },
      { block: 2 },
    ],
  },
};
const spacedStatusDiagnostic = 'battle.statuses[0]：状态定义不合法（具体原因：triggers.take_damage[0]. to：规则字段不符合浅层 effects 契约）';
const spacedStatusTargets = extractTowerInitialRepairSlotTargets(
  spacedStatusDiagnosticOriginal,
  spacedStatusDiagnostic,
);
assert.deepEqual(
  spacedStatusTargets[0].slots.map(slot => slot.kind),
  ['description', 'status_trigger_effect_item'],
  'the raw diagnostic index recovers one exact status item even when the invalid field contains whitespace',
);
assert.equal(spacedStatusTargets[0].slots[1].path, 'player.statuses[0].triggers.take_damage[0]');
const spacedStatusMerged = mergeTowerInitialSlotRepair(
  spacedStatusDiagnosticOriginal,
  spacedStatusTargets,
  parseTowerInitialSlotRepairResponse(slotResponseFor(spacedStatusTargets, {
    'player.statuses[0]:description': '受到伤害时反击1点，然后获得2点格挡。',
    'player.statuses[0]:status_trigger_effect_item': { damage: 1, to: 'opponent' },
  }), spacedStatusTargets),
);
assert.deepEqual(spacedStatusMerged.player.statuses[0].triggers.take_damage, [
  { damage: 1, to: 'opponent' },
  { block: 2 },
]);
for (const [label, triggerValue, diagnostic] of [
  ['unknown trigger', [{ damage: 0 }], 'battle.statuses[0]：状态定义不合法（具体原因：triggers.invented[0]. to：字段非法）'],
  ['out-of-range index', [{ damage: 0 }], 'battle.statuses[0]：状态定义不合法（具体原因：triggers.take_damage[3]. to：字段非法）'],
  ['non-array trigger', { damage: 0 }, 'battle.statuses[0]：状态定义不合法（具体原因：triggers.take_damage[0]. to：字段非法）'],
]) {
  const invalidRawIndex = structuredClone(spacedStatusDiagnosticOriginal);
  const triggerName = label === 'unknown trigger' ? 'invented' : 'take_damage';
  invalidRawIndex.player.statuses[0].triggers = { [triggerName]: triggerValue };
  assert.deepEqual(
    extractTowerInitialRepairSlotTargets(invalidRawIndex, diagnostic),
    [],
    `${label} must not be converted into an indexed status repair`,
  );
}

const duplicatedTriggerDiagnosticOriginal = structuredClone(typedRepairOriginal);
duplicatedTriggerDiagnosticOriginal.player.player_abilities[0] = {
  id: 'battle_instinct', name: '战斗本能', description: '造成伤害后获得1点格挡。',
  trigger: { on: 'damage_resolved', effects: [{ block: 1 }] },
};
const duplicatedTriggerErrors = [
  'battle.player_abilities[0].trigger.on：trigger 不受支持',
  'battle.player_abilities[0].trigger.trigger：trigger 不受支持',
];
for (const errors of [duplicatedTriggerErrors, [...duplicatedTriggerErrors].reverse()]) {
  const duplicatedTriggerTargets = extractTowerInitialRepairSlotTargets(
    duplicatedTriggerDiagnosticOriginal,
    errors.join('；'),
  );
  assert.deepEqual(
    duplicatedTriggerTargets[0].slots.map(slot => slot.kind),
    ['trigger_on'],
    'an order-independent validator cascade produces one trigger.on slot',
  );
  const duplicatedTriggerMerged = mergeTowerInitialSlotRepair(
    duplicatedTriggerDiagnosticOriginal,
    duplicatedTriggerTargets,
    parseTowerInitialSlotRepairResponse(slotResponseFor(duplicatedTriggerTargets, {
      'player.player_abilities[0]:trigger_on': 'deal_damage',
    }), duplicatedTriggerTargets),
  );
  assert.equal(duplicatedTriggerMerged.player.player_abilities[0].trigger.on, 'deal_damage');
  assert.deepEqual(duplicatedTriggerMerged.player.player_abilities[0].trigger.effects, [{ block: 1 }]);
}
const realNestedTriggerOriginal = structuredClone(duplicatedTriggerDiagnosticOriginal);
realNestedTriggerOriginal.player.player_abilities[0].trigger.trigger = 'authored_nested_value';
assert.deepEqual(
  extractTowerInitialRepairSlotTargets(realNestedTriggerOriginal, duplicatedTriggerErrors.join('；')),
  [],
  'a real nested trigger field is not dismissed as a validator cascade',
);

assert.deepEqual(
  extractTowerInitialRepairSlotTargets(typedRepairOriginal, 'battle.core.hp：当前生命必须在 0 到最大生命之间'),
  [],
  'an unimplemented root family must fail closed instead of falling back to whole-root replacement',
);

const controller = new DesignAssistantController({
  context: () => context,
  mvu: () => mvu,
  now: () => 202609020001,
  notify() {},
}, undefined, {
  currentChatId: () => context.chatId,
  createChatMessages: async () => { createChatMessageCalls += 1; },
  observeStructuredDelivery: id => observeNarrativeDelivery(events, id),
  generate: async config => {
    modelCalls.push(['structured', structuredClone(config)]);
    await events.emit('js_stream_token_received_fully', 'PRIVATE_TEST_OUTPUT', config.generation_id);
    await events.emit('js_stream_token_received_fully', '', config.generation_id);
    await events.emit('js_generation_ended', '', config.generation_id);
    const firstAttempt = modelCalls.filter(([kind]) => kind === 'structured').length === 1;
    if (!firstAttempt) {
      return typedRepairResponse(config, {
        'opening.choices[0]': {
          id: 'warm_star',
          label: '温暖星屑',
          description: '弃掉全部手牌，然后抽1张牌。',
          outcome: {
            hp: 8,
            reward: {
              cards: [{
                id: 'sequence_recombine', name: '序列重组', type: 'Skill', rarity: 'Rare', cost: 1,
                quantity: 1, description: '弃掉全部手牌，然后抽1张牌。',
                effects: [{ discard: 'all', from: 'hand', pick: 'all' }, { draw: 1 }],
              }],
            },
          },
        },
        'player.player_abilities[0]': {
          id: 'first_skill_echo', name: '首次回响', description: '每回合第一张技能牌额外完整结算1次。',
          trigger: { on: 'passive', effects: [{ card_rule: 'replay', card_type: 'Skill', limit: 1, extra: 1 }] },
        },
      });
    }
    const playerBattle = structuredClone(initialContent.battle);
    playerBattle.player_abilities = [{
      id: 'first_skill_echo', name: '首次回响', description: '首次打出技能牌时额外完整结算。',
      trigger: { on: 'skill_played', ordinal: 'first', effects: { card_rule: 'replay', limit: 1, extra: 1 } },
    }];
    return JSON.stringify({
      narrative: withDungeonPlan('雾中的高塔吞没了归路，守门人告诉旅者：只有连续越过三幕试炼，出口才会重新出现。'),
      player: {
        status: initialContent.status,
        ...playerBattle,
      },
      opening: {
        title: '守门人的星火馈赠',
        narrative: '守门人摊开两枚仍在发光的星屑，示意旅者选一枚带走。',
        choices: [
          {
            id: 'warm_star',
            label: '温暖星屑',
            description: '弃掉任意数量的手牌，然后抽1张牌。',
            outcome: {
              hp: 8,
              reward: {
                cards: [{
                  id: 'sequence_recombine', name: '序列重组', type: 'Skill', rarity: 'Rare', cost: 1,
                  quantity: 1, description: '弃掉任意数量的手牌，然后抽1张牌。',
                  effects: { discard: 'all', from: 'hand', pick: 'choose', draw: 1 },
                }],
              },
            },
          },
          { id: 'sharp_star', label: '锐利星屑', outcome: { gold: 40 } },
          { id: 'steady_star', label: '沉静星屑', outcome: { card_removals: 1 } },
        ],
      },
    });
  },
  generateNarrative: async config => {
    modelCalls.push(['unexpected-narrative', structuredClone(config)]);
    throw new Error('single-floor start must not issue a separate narrative request');
  },
  stopGenerationById: () => true,
  emitInternalEvent: async () => {},
}, { towerCoordinator: false });

try {
  controller.activate();
  const floorCountBefore = context.chat.length;
  const result = await controller.startTowerSingleFloor({
    spec: 'mwg.tower-single-floor-start/v1',
    sourceMessageId: 0,
    prompt: '[角色创建]\n{"mode":"tower","world":"星海高塔"}\n[爬塔模式]\n[开始游戏]',
    config: { world: '星海高塔', card: '星火攻防' },
  });

  assert.equal(result.spec, 'mwg.tower-single-floor-start-result/v1');
  assert.equal(result.floorCountBefore, 1);
  assert.equal(result.floorCountAfter, 1);
  assert.equal(context.chat.length, floorCountBefore, 'silent initialization must not append a Tavern floor');
  assert.equal(createChatMessageCalls, 0, 'single-floor start must never use createChatMessages');
  assert.equal(modelCalls.filter(([kind]) => kind === 'unexpected-narrative').length, 0);
  assert.deepEqual(variables.stat_data.run.dungeonPlan,dungeonPlanFixture);
  assert.equal(modelCalls.filter(([kind]) => kind === 'structured').length, 2);
  const initialDelivery = controller.getTowerGenerationDiagnostics().filter(row => row.nodeId === '__initial_mechanism');
  assert.equal(initialDelivery.length, 2, 'actual initial controller and repair bypass queue but retain both diagnostics');
  for (const row of initialDelivery) {
    assert.equal(row.structuredDelivery.streamMaxCharacters, 19);
    assert.equal(row.structuredDelivery.streamCharacters, 0);
    assert.equal(row.structuredDelivery.endCharacters, 0);
  }
  assert.ok(!JSON.stringify(initialDelivery).includes('PRIVATE_TEST_OUTPUT'));
  assert.equal((events.listeners.get('js_stream_token_received_fully') || []).length, 0);
  assert.equal((events.listeners.get('js_generation_ended') || []).length, 0);
  const structuredConfig = modelCalls.find(([kind]) => kind === 'structured')[1];
  const repairedConfig = modelCalls.filter(([kind]) => kind === 'structured')[1][1];
  assert.ok(
    repairedConfig.user_input.length < 30_000,
    `path-focused repair prompt must stay bounded: ${repairedConfig.user_input.length}`,
  );
  assert.ok(repairedConfig.user_input.length < structuredConfig.user_input.length);
  assert.equal(structuredConfig.should_silence, true);
  assert.equal(structuredConfig.max_chat_history, 0);
  assert.equal(structuredConfig.json_schema.name, 'mwg_tower_single_floor_initial_content');
  assert.deepEqual(structuredConfig.json_schema.value.required, ['narrative', 'player', 'opening']);
  assert.equal('battle' in structuredConfig.json_schema.value.properties, false);
  assert.match(structuredConfig.user_input, /CURRENT_START_STATE=/);
  assert.match(structuredConfig.user_input, /quantity 必须是 1-100 整数/);
  assert.match(structuredConfig.user_input, /状态根部绝不能另写 hold/);
  assert.match(structuredConfig.user_input, /Attack\/Skill\/Event\/Curse 绝不能写根 trigger/);
  assert.match(structuredConfig.user_input, /条件字段只有 when，绝无 when_condition/);
  assert.match(structuredConfig.user_input, /状态事件键的值只放一次性浅层效果，不接受 scope\/ordinal\/n\/event/);
  assert.match(structuredConfig.user_input, /history\.event 只使用底层事件名/);
  assert.match(structuredConfig.user_input, /提交前在内部建立状态 ID 对照/);
  assert.match(structuredConfig.user_input, /当前没有资源变化触发器/);
  assert.match(structuredConfig.user_input, /普通 damage\/heal\/block 的 targets 只选择敌我战斗实体/);
  assert.match(structuredConfig.user_input, /禁止 self\.is_xxx\/opponent\.is_xxx/);
  assert.match(structuredConfig.user_input, /都必须在同一内容的真实 effects 中执行 spawn_summon/);
  assert.match(structuredConfig.user_input, /尤其检查 player_lust_effect/);
  assert.match(structuredConfig.user_input, /状态不能按中文名称自动生效；白名单内置 ID 可直接引用/);
  assert.ok(structuredConfig.user_input.includes(formatCompactEffectAuthoringContract()), 'legacy request retains the entire current public contract, not only its old heading');
  assert.match(structuredConfig.user_input, /完整玩法、生成方法与 DSL 契约，不是关键词提示/);
  assert.match(structuredConfig.user_input, /不能像奖励候选一样携带 status\/statuses 外壳/);
  assert.match(structuredConfig.user_input, /完整状态定义统一放入 player\.statuses/);
  assert.match(structuredConfig.user_input, /每张临时牌模板的 rarity 也只能是 Common、Uncommon、Rare、Epic、Legendary、Corrupt/);
  assert.match(structuredConfig.user_input, /draw\/scry\/seek 只操作玩家牌区/);
  assert.match(structuredConfig.user_input, /Attack\/Skill\/Event\/Curse 模板不写 trigger/);
  assert.match(structuredConfig.user_input, /具体候选内容同级写 statuses:\[全部完整定义\]/);
  assert.match(structuredConfig.user_input, /不要把三个尚未选择的候选状态提前塞进全局状态表/);
  assert.match(structuredConfig.user_input, /不使用通用 operation\/target\/condition\/operator\/value\/amount\/source 包装/);
  assert.match(structuredConfig.user_input, /apply_status\/remove_status 的值绝不能是对象或 \{状态ID:层数\} 映射/);
  assert.match(structuredConfig.user_input, /\{apply_status:"状态ID",stacks\?:层数,to\?:目标\}/);
  assert.match(structuredConfig.user_input, /生命周期键包括 apply\/stack\/tick\/remove\/hold\/threshold_execute/);
  assert.match(structuredConfig.user_input, /状态事件键包括 battle_start\/ability_gain\/turn_start\/turn_end/);
  assert.match(structuredConfig.user_input, /禁止把 \{on, effects\} 塞进 triggers\.hold/);
  assert.match(structuredConfig.user_input, /数组各项的 when 在执行到该项时重新判断/);
  assert.match(structuredConfig.user_input, /has_status.*无参数布尔字段.*不作函数调用/);
  assert.match(structuredConfig.user_input, /指定状态用 self\.status\.状态ID\.stacks > 0/);
  assert.match(structuredConfig.user_input, /\[输出前结构自检\]/);
  assert.match(structuredConfig.user_input, /不得存在 effects:\[\]、effects:\{\}、trigger:null、空 trigger\.effects/);
  assert.match(structuredConfig.user_input, /opening 奖励候选引用的新状态必须由该候选自己的 statuses 沿完整依赖链闭合/);
  assert.match(structuredConfig.user_input, /每个 opening choice 都必须产生至少一项真实变化/);
  assert.match(structuredConfig.user_input, /outcome 不存在 resource\/set_resource 字段/);
  assert.match(structuredConfig.user_input, /最后逐个检查三个 opening\.choices 的 outcome/);
  assert.match(structuredConfig.user_input, /绝不能出现 energy、max_energy、block、status、resource、set_resource 或 effects/);
  assert.match(structuredConfig.user_input, /绝不能输出单数 effect/);
  assert.match(structuredConfig.user_input, /公式不支持 random\(\)、chance\(\)/);
  assert.match(structuredConfig.user_input, /player_abilities 不能用 source_kind:"summon"/);
  assert.match(structuredConfig.user_input, /不存在 modify:"summon_damage"/);
  assert.match(structuredConfig.user_input, /每个 apply_status\/remove_status 和状态公式引用都必须在 player\.statuses/);
  assert.doesNotMatch(structuredConfig.user_input, /CURRENT_STAT_DATA=/);
  assert.doesNotMatch(structuredConfig.user_input, /stale_star_strike|旧模板星火斩/);
  assert.match(repairedConfig.user_input, /ALL_VALIDATION_ERRORS=/);
  assert.match(repairedConfig.user_input, /锁定槽位修复/);
  assert.match(repairedConfig.user_input, /局部 effects 快速修复契约/);
  assert.match(repairedConfig.user_input, /程序已经锁定全部允许写入的 rN\.sN 槽位/);
  assert.doesNotMatch(repairedConfig.user_input, /\[浅层 effects 完整精确语法 v2/);
  assert.match(repairedConfig.user_input, /禁止 operation\/target\/value\/source 通用对象/);
  assert.doesNotMatch(repairedConfig.user_input, /召唤唯一公开写法是/, 'unrelated summon prose must not bury the reported paths');
  assert.match(repairedConfig.user_input, /mode:"passive",effects:\[持续规则\]/);
  assert.match(repairedConfig.user_input, /REPAIR_SLOTS=/);
  assert.match(repairedConfig.user_input, /REPAIR_CONTEXT=/);
  assert.match(repairedConfig.user_input, /每个 slots\.sN 必须恰好使用 schema 固定的 action/);
  assert.match(repairedConfig.user_input, /opening 奖励的新状态仍属于候选自身/);
  assert.match(repairedConfig.user_input, /support_statuses/);
  assert.doesNotMatch(repairedConfig.user_input, /CANDIDATE_JSON=/);
  assert.doesNotMatch(repairedConfig.user_input, /START_REQUEST=|PLAYER_CONFIG=|CURRENT_START_STATE=/);
  assert.doesNotMatch(repairedConfig.user_input, /旧模板星火斩|stale_star_strike/);
  assert.equal(repairedConfig.json_schema.name, 'mwg_tower_initial_slot_repair');
  assert.deepEqual(
    repairedConfig.json_schema.value.properties.roots.required,
    Object.keys(repairedConfig.json_schema.value.properties.roots.properties),
  );
  assert.match(repairedConfig.user_input, /battle\.player_abilities\[0\]\.trigger\.effects：.*持续规则只允许用于 passive/);
  assert.match(repairedConfig.user_input, /warm_star.*序列重组.*effects\.discard/);
  assert.equal(JSON.stringify(repairedConfig.json_schema).includes('"eal_damage"'), false);
  assert.equal(mvuWrites.length, 1);
  assert.equal(chatVariableWrites.length, 0, 'single-floor publication owns message MVU, not preset/user chat variables');
  assert.equal(variables.stat_data.battle.cards.reduce((sum, card) => sum + card.quantity, 0), 10);
  assert.equal(variables.stat_data.battle.cards.some(card => card.id.startsWith('stale_')), false);
  assert.ok(Number(variables.stat_data.run.schemaVersion) >= 1);
  assert.equal(variables.stat_data.run.opening.phase, 'ready');
  assert.equal(variables.stat_data.run.opening.content.title, '守门人的星火馈赠');
  assert.deepEqual(variables.stat_data.run.opening.content.choices[0].outcome.reward.cards[0].effects, [
    { discard: 'all', from: 'hand', pick: 'all' },
    { draw: 1 },
  ]);
  assert.match(context.chat[0].mes, /只有连续越过三幕试炼/);
  assert.match(context.chat[0].mes, /<TOWER_STATUS\/>/);
  assert.ok(saveChatCalls >= 1, 'the rewritten greeting and MVU snapshot must be saved');

  controller.deactivate();
  context.chat = [{ is_user: false, is_system: false, mes: '[爬塔模式开场]' }];
  context.chatMetadata = {};
  variables = {
    stat_data: {
      game_mode: 'tower',
      game_mode_lock: { schemaVersion: 1, mode: 'tower' },
      status: {},
      battle: {},
    },
  };
  const failedInitialCalls = [];
  const failingController = new DesignAssistantController({
    context: () => context,
    mvu: () => mvu,
    now: () => 202609020002,
    notify() {},
  }, undefined, {
    currentChatId: () => context.chatId,
    createChatMessages: async () => {},
    generate: async config => {
      failedInitialCalls.push(structuredClone(config));
      const invalidBattle = structuredClone(initialContent.battle);
      delete invalidBattle.core.emoji;
      if (failedInitialCalls.length > 1) {
        return typedRepairResponse(config, {
          'player.core': invalidBattle.core,
          opening: {
            title: '三枚星屑',
            narrative: '三枚星屑等待旅者选择。',
            choices: [
              { id: 'warm_star', label: '温暖星屑', outcome: { hp: 8 } },
              { id: 'sharp_star', label: '锐利星屑', outcome: { gold: 40 } },
              { id: 'steady_star', label: '沉静星屑', outcome: { card_removals: 1 } },
            ],
          },
          'opening.narrative': '三枚星屑等待旅者选择。',
        });
      }
      return JSON.stringify({
        narrative: withDungeonPlan('高塔入口仍在等待完整角色资料。'),
        player: { status: initialContent.status, ...invalidBattle },
        opening: {
          title: '三枚星屑',
          choices: [
            { id: 'warm_star', label: '温暖星屑', outcome: { hp: 8 } },
            { id: 'sharp_star', label: '锐利星屑', outcome: { gold: 40 } },
            { id: 'steady_star', label: '沉静星屑', outcome: { card_removals: 1 } },
          ],
        },
      });
    },
    generateNarrative: async () => { throw new Error('unexpected narrative request'); },
    stopGenerationById: () => true,
    emitInternalEvent: async () => {},
  }, { towerCoordinator: false });
  try {
    failingController.activate();
    await assert.rejects(
      failingController.startTowerSingleFloor({
        spec: 'mwg.tower-single-floor-start/v1',
        sourceMessageId: 0,
        prompt: '[角色创建]\n{"mode":"tower","world":"星海高塔"}\n[爬塔模式]\n[开始游戏]',
        config: { world: '星海高塔', card: '星火攻防' },
      }),
      /无法把全部校验错误映射到有限安全修复槽/,
    );
    assert.equal(failedInitialCalls.length, 1, 'an unmapped root must fail closed without a broad repair request');
  } finally {
    failingController.deactivate();
  }

  context.chat = [{ is_user: false, is_system: false, mes: '[爬塔模式开场]' }];
  context.chatMetadata = {};
  variables = {
    stat_data: {
      game_mode: 'tower',
      game_mode_lock: { schemaVersion: 1, mode: 'tower' },
      status: {},
      battle: {},
    },
  };
  const layeredStatusCalls = [];
  const layeredStatusController = new DesignAssistantController({
    context: () => context,
    mvu: () => mvu,
    now: () => 202609020003,
    notify() {},
  }, undefined, {
    currentChatId: () => context.chatId,
    createChatMessages: async () => {},
    generate: async config => {
      layeredStatusCalls.push(structuredClone(config));
      const firstAttempt = layeredStatusCalls.length === 1;
      if (!firstAttempt) {
        assert.match(config.user_input, /候选 statuses\[0\] 无效: 状态 stacks_change 无效/);
        assert.match(
          config.user_input,
          /候选 statuses\[0\] 无效: triggers\.hold\.modify: Unsupported modifier: actions_per_activation/,
          'the one repair must receive every independently discoverable issue from the same status',
        );
        assert.match(config.user_input, /必须同时复核该状态的全部字段/);
        assert.match(config.user_input, /"kind":"status_stacks_change"/);
        assert.match(config.user_input, /"kind":"status_hold_sequence"/);
        const response = typedRepairResponse(config, {
          'opening.choices[0]': {
            id: 'recon_module',
            label: '侦察模块',
            outcome: {
              reward: {
                artifacts: [{
                  id: 'star_scanner', name: '星图扫描仪', emoji: '🔭', rarity: 'Rare',
                  description: '每回合首次打出攻击牌时，使一个随机友方召唤物获得两层急速。',
                  trigger: {
                    on: 'attack_played', ordinal: 'first',
                    effects: {
                      apply_summon_status: {
                        selector: { owner: 'self', pick: 'random' }, id: 'haste', stacks: 2,
                      },
                    },
                  },
                  statuses: [{
                    id: 'haste', name: '急速', emoji: '⚡', type: 'buff',
                    description: '每层使召唤物造成的伤害提高1点，回合结束时减少一层。',
                    stacks_change: -1,
                    triggers: { hold: { modify: 'damage', add: 'stacks' } },
                  }],
                }],
              },
            },
          },
        });
        const parsedResponse = JSON.parse(response);
        assert.match(JSON.stringify(parsedResponse), /"modify":"damage"/);
        assert.doesNotMatch(JSON.stringify(parsedResponse), /actions_per_activation/);
        return response;
      }
      const artifact = {
        id: 'star_scanner', name: '星图扫描仪', emoji: '🔭', rarity: 'Rare',
        description: '每回合首次打出攻击牌时，使一个随机友方召唤物获得两层急速。',
        trigger: {
          on: 'attack_played', ordinal: 'first',
          effects: {
            apply_summon_status: {
              selector: { owner: 'self', pick: 'random' }, id: 'haste', stacks: 2,
            },
          },
        },
        statuses: [{
          id: 'haste', name: '急速', emoji: '⚡', type: 'buff',
          description: '每层使召唤物额外行动一次，回合结束时减少一层。',
          stacks_change: '-1',
          triggers: { hold: { modify: 'actions_per_activation', add: 1 } },
        }],
      };
      return JSON.stringify({
        narrative: withDungeonPlan('镜界入口展开了一层可执行的规则。'),
        player: { status: initialContent.status, ...structuredClone(initialContent.battle) },
        opening: {
          title: '镜界馈赠',
          narrative: '三段稳定的规则在入口处展开，等待旅者选择。',
          choices: [
            { id: 'recon_module', label: '侦察模块', outcome: { reward: { artifacts: [artifact] } } },
            { id: 'sharp_star', label: '锐利星屑', outcome: { gold: 40 } },
            { id: 'steady_star', label: '沉静星屑', outcome: { card_removals: 1 } },
          ],
        },
      });
    },
    generateNarrative: async () => { throw new Error('unexpected narrative request'); },
    stopGenerationById: () => true,
    emitInternalEvent: async () => {},
  }, { towerCoordinator: false });
  try {
    layeredStatusController.activate();
    await layeredStatusController.startTowerSingleFloor({
      spec: 'mwg.tower-single-floor-start/v1',
      sourceMessageId: 0,
      prompt: '[角色创建]\n{"mode":"tower","world":"镜界高塔"}\n[爬塔模式]\n[开始游戏]',
      config: { world: '镜界高塔', card: '召唤与触发' },
    });
    assert.equal(layeredStatusCalls.length, 2, 'one candidate status definition is repaired through one locked slot');
    assert.equal(
      variables.stat_data.run.opening.content.choices[0].outcome.reward.artifacts[0].statuses[0].id,
      'haste',
    );
  } finally {
    layeredStatusController.deactivate();
  }
} finally {
  controller.deactivate();
  if (previousTavernHelper === undefined) delete globalThis.TavernHelper;
  else globalThis.TavernHelper = previousTavernHelper;
}

console.log('Tower single-floor start repairs invalid DSL in place, persists the deck/gift/map, and rewrites only the greeting floor.');
