import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const { withAiContentDefinitions } = require(resolve('src/game-core/aiContentJsonSchema.ts'));
const { preflightBattleContent } = require(resolve('src/fish/core/battleContentPreflight.ts'));
const { TavernEffectCommandHost } = require(resolve('src/fish/core/effectCommandHost.ts'));

const portableSchema = JSON.parse(await readFile(resolve('schemas/mwg-card-effects-v1.schema.json'), 'utf8'));
const runtimeAstSchema = JSON.parse(await readFile(resolve('schemas/mwg-effect-v1.schema.json'), 'utf8'));
const authoringContract = core.formatCompactEffectAuthoringContract();
const worldbookContract = await readFile(resolve('worldbook_new', '2战斗内容生成要求.md'), 'utf8');
const { compactEffectProtocolSections } = require(resolve('src/game-core/authoredEffectProtocol.ts'));
assert.deepEqual(compactEffectProtocolSections().map(s => s.id), ['containers','basics','formulas','cards','resources','persistent','events','advanced','summons','damage-protection','presentation']);
assert.ok(compactEffectProtocolSections().every(s => authoringContract.includes(s.clauses.join('\n'))));
assert.match(authoringContract, /from 只用 hand\/draw\/discard\/exhaust\/all\/combat/);
assert.match(authoringContract, /pick 只用 random\/choose\/left\/right\/top\/bottom\/all/);
assert.match(authoringContract, /card_rule 的值同样直接是规则字符串，绝不能写成对象/);
assert.match(authoringContract, /reduce_cost 只在效果结算当下修改已经选中的现有卡牌，不接受 scope/);
assert.match(authoringContract, /没有效果的键必须完全省略，绝不能写 \[\] 或 \{\}/);
assert.match(authoringContract, /状态事件键包括 battle_start\/ability_gain\/turn_start\/turn_end/);
assert.match(authoringContract, /禁止包成 \{on,effects\}/);
assert.match(authoringContract, /召唤能力只响应该召唤/);
assert.match(authoringContract, /battle_won\/victory\/battle_end 等战后阶段不是 when 变量/);
assert.match(worldbookContract, /AI 负责机制、数值与表现，程序只补技术结构/);
assert.match(worldbookContract, /无法保留原机制时报告具体缺口，不得删掉要求、改写描述或用空效果换取通过/);
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateRuntimeAst = ajv.compile(runtimeAstSchema);
const validatorFor = definition => ajv.compile(withAiContentDefinitions({ $ref: `#/$defs/${definition}` }));
const validators = {
  ordinary: validatorFor('effectList'),
  card: validatorFor('mwgCardEffectList'),
  passive: validatorFor('mwgPassiveEffectList'),
  event: validatorFor('mwgEventEffectList'),
  summon: validatorFor('mwgSummonEffectList'),
  ability: validatorFor('mwgAbility'),
  cardDefinition: validatorFor('mwgCard'),
  rewardCard: validatorFor('mwgRewardCard'),
  artifactDefinition: validatorFor('mwgArtifact'),
  rewardArtifact: validatorFor('mwgRewardArtifact'),
  itemDefinition: validatorFor('mwgItem'),
  rewardItem: validatorFor('mwgRewardItem'),
  status: validatorFor('mwgStatusDefinition'),
  namedEffects: validatorFor('mwgNamedEffects'),
  enemyAction: validatorFor('mwgEnemyAction'),
  enemy: validatorFor('mwgEnemy'),
};

const initialRepairValidator = ajv.compile(core.createTowerInitialBattleRepairJsonSchema().value);
const minimalInitialBattle = {
  battle: {
    core: { emoji: 'P', hp: 30, max_hp: 30, lust: 0, max_lust: 100 },
    cards: [{
      id: 'repair_strike', name: '修复攻击', type: 'Attack', rarity: 'Common',
      cost: 1, quantity: 1, effects: { damage: 6 },
    }],
  },
};
assert.equal(initialRepairValidator(minimalInitialBattle), true, JSON.stringify(initialRepairValidator.errors));
const invalidInitialRepair = structuredClone(minimalInitialBattle);
invalidInitialRepair.battle.cards[0].effects = {
  spawn_summon: {
    id: 'broken_summon', name: '错误召唤', emoji: 'S', max_hp: 5,
    hp: 5,
    trigger: { on: 'turn_start', effects: { damage: 2 } },
  },
};
assert.equal(
  initialRepairValidator(invalidInitialRepair),
  false,
  'the bounded repair request must use the same strict summon/card grammar as first generation',
);

const currentReplayAttack = {
  id: 'matrix_current_replay', name: '当前重放', type: 'Attack', rarity: 'Uncommon',
  cost: 1, quantity: 1, effects: [{ damage: 5 }, { replay_current: 1 }],
};
assert.equal(
  validators.cardDefinition(currentReplayAttack),
  true,
  `a non-Power card must expose current-card replay to the generator: ${JSON.stringify(validators.cardDefinition.errors)}`,
);
const invalidCurrentReplayPower = {
  id: 'matrix_power_replay', name: '错误能力重放', type: 'Power', rarity: 'Rare',
  cost: 1, quantity: 1, effects: [{ block: 2 }, { replay_current: 1 }],
  trigger: { on: 'turn_start', effects: { block: 1 } },
};
assert.equal(
  validators.cardDefinition(invalidCurrentReplayPower),
  false,
  'Power cards have no currently resolving reusable card body and must reject replay_current in immediate effects',
);

const rewardStatus = {
  id: 'matrix_reward_mark',
  name: '矩阵奖励印记',
  emoji: '◇',
  type: 'debuff',
  stacks_change: -1,
  triggers: { tick: { damage: 'stacks', to: 'self' } },
};
const eventStatus = {
  id: 'matrix_event_state',
  name: '矩阵事件状态',
  emoji: '↗️',
  type: 'buff',
  stacks_change: 'reset',
  triggers: { attack_played: { energy: 'stacks' } },
};
assert.equal(
  validators.status(eventStatus),
  true,
  `AI schema must expose direct status event keys: ${JSON.stringify(validators.status.errors)}`,
);
assert.equal(core.validateCompactStatusDefinition(eventStatus).ok, true);
assert.equal(
  validators.status({ ...eventStatus, triggers: { hold: { on: 'attack_played', effects: { energy: 1 } } } }),
  false,
  'AI schema must reject the old event-listener wrapper inside hold',
);
const rewardCardWithStatus = {
  id: 'matrix_reward_card',
  name: '矩阵奖励牌',
  type: 'Skill',
  rarity: 'Common',
  cost: 1,
  quantity: 1,
  effects: { apply_status: 'matrix_reward_mark', stacks: 2 },
  status: rewardStatus,
};
assert.equal(
  validators.rewardCard(rewardCardWithStatus),
  true,
  `reward cards must be able to carry one atomically registered support status: ${JSON.stringify(validators.rewardCard.errors)}`,
);
assert.equal(
  validators.cardDefinition(rewardCardWithStatus),
  false,
  'the reward-only support status must not leak into persistent or initial card wrappers',
);
assert.equal(
  core.validateRewardCandidateAgainstLibrary('cards', rewardCardWithStatus, { statusDefinitions: [] }).ok,
  true,
  'the reward validator keeps the legacy single-status envelope compatible with the AI schema',
);
const secondRewardStatus = {
  id: 'matrix_reward_guard',
  name: '矩阵奖励守护',
  emoji: '🛡️',
  type: 'buff',
  triggers: { hold: { modify: 'block', add: 'stacks' } },
};
const rewardCardWithStatuses = {
  ...rewardCardWithStatus,
  id: 'matrix_reward_multi_status_card',
  effects: [
    { apply_status: 'matrix_reward_mark', stacks: 2 },
    { apply_status: 'matrix_reward_guard', stacks: 1, to: 'self' },
  ],
  statuses: [rewardStatus, secondRewardStatus],
};
delete rewardCardWithStatuses.status;
assert.equal(
  validators.rewardCard(rewardCardWithStatuses),
  true,
  `reward cards must expose the preferred multi-status envelope: ${JSON.stringify(validators.rewardCard.errors)}`,
);
assert.equal(validators.cardDefinition(rewardCardWithStatuses), false);
assert.equal(
  core.validateRewardCandidateAgainstLibrary('cards', rewardCardWithStatuses, { statusDefinitions: [] }).ok,
  true,
  'AI schema and runtime validator must agree on several atomically registered support statuses',
);
for (const [category, baseValidator, rewardValidator, candidate] of [
  ['artifacts', validators.artifactDefinition, validators.rewardArtifact, {
    id: 'matrix_reward_relic', name: '矩阵奖励遗物', rarity: 'Common',
    trigger: { on: 'turn_start', effects: { apply_status: 'matrix_reward_mark' } },
    status: rewardStatus,
  }],
  ['items', validators.itemDefinition, validators.rewardItem, {
    id: 'matrix_reward_item', name: '矩阵奖励道具', count: 1,
    effects: { apply_status: 'matrix_reward_mark' },
    status: rewardStatus,
  }],
]) {
  assert.equal(
    rewardValidator(candidate),
    true,
    `${category} reward schema must expose the same atomic support-status contract: ${JSON.stringify(rewardValidator.errors)}`,
  );
  assert.equal(baseValidator(candidate), false, `${category} persistent wrapper must reject reward-only status payloads`);
  assert.equal(
    core.validateRewardCandidateAgainstLibrary(category, candidate, { statusDefinitions: [] }).ok,
    true,
    `${category} reward validator must agree with its AI schema`,
  );
}

const conditionalDesireEffect = {
  name: '临界回响',
  when: 'self.hp < self.max_hp / 2',
  effects: { damage: 4 },
};
assert.equal(
  validators.namedEffects(conditionalDesireEffect),
  true,
  `initial desire effects must expose the same root when contract as dynamically spawned enemies: ${JSON.stringify(validators.namedEffects.errors)}`,
);
const compiledConditionalDesire = core.compileCompactEffectList(
  conditionalDesireEffect.effects,
  { when: conditionalDesireEffect.when },
);
assert.equal(compiledConditionalDesire.ok, true);
assert.equal(compiledConditionalDesire.value.steps[0].op, 'if');

const conditionalResource = {
  resource: { id: 'charge', amount: 'attacks_played_this_turn >= 1 ? 3 : 2' },
};
assert.equal(validators.ordinary(conditionalResource), true, JSON.stringify(validators.ordinary.errors));
const compiledConditionalResource = core.compileCompactEffectList(conditionalResource);
assert.equal(compiledConditionalResource.ok, true, JSON.stringify(compiledConditionalResource.issues));
assert.equal(compiledConditionalResource.value.steps[0].op, 'if');
assert.equal(compiledConditionalResource.value.steps[0].then[0].op, 'gain_resource');
assert.equal(compiledConditionalResource.value.steps[0].else[0].op, 'gain_resource');

const playerCollectionHeal = { heal: 2, targets: { mode: 'lowest_hp' } };
assert.equal(validators.ordinary(playerCollectionHeal), true, JSON.stringify(validators.ordinary.errors));
const compiledPlayerCollectionHeal = core.compileCompactEffectList(playerCollectionHeal, {
  enemyCollectionTarget: 'opponent',
});
assert.equal(compiledPlayerCollectionHeal.ok, true, JSON.stringify(compiledPlayerCollectionHeal.issues));
assert.equal(compiledPlayerCollectionHeal.value.steps[0].target, 'opponent');
assert.equal(
  validators.ordinary({ ...playerCollectionHeal, to: 'self' }),
  false,
  'player-authored collection selectors cannot claim the player side',
);
assert.equal(
  core.compileCompactEffectList({ ...playerCollectionHeal, to: 'self' }, { enemyCollectionTarget: 'opponent' }).ok,
  false,
  'the compiler must reject the same incompatible player collection target',
);

const enemyCollectionGuard = {
  id: 'matrix_enemy_guard',
  name: '群体守护',
  effects: { block: 3, targets: { mode: 'all' } },
};
assert.equal(validators.enemyAction(enemyCollectionGuard), true, JSON.stringify(validators.enemyAction.errors));
const compiledEnemyCollectionGuard = core.compileCompactEffectList(enemyCollectionGuard.effects, {
  enemyCollectionTarget: 'self',
});
assert.equal(compiledEnemyCollectionGuard.ok, true, JSON.stringify(compiledEnemyCollectionGuard.issues));
assert.equal(compiledEnemyCollectionGuard.value.steps[0].target, 'self');
assert.equal(
  validators.enemyAction({ ...enemyCollectionGuard, effects: { ...enemyCollectionGuard.effects, to: 'opponent' } }),
  false,
  'enemy ally collection selectors cannot claim the player side',
);
assert.equal(
  core.compileCompactEffectList(
    { ...enemyCollectionGuard.effects, to: 'opponent' },
    { enemyCollectionTarget: 'self' },
  ).ok,
  false,
  'the compiler must reject the same incompatible enemy collection target',
);

// Recursive containers must retain the same source perspective. These used
// to fall back to the player default after the outer enemy effect compiled.
const enemyScheduledGuard = {
  id: 'matrix_enemy_scheduled_guard',
  name: '延迟群体守护',
  effects: {
    schedule: 1,
    phase: 'turn_start',
    effects: { block: 2, targets: { mode: 'all' } },
  },
};
assert.equal(validators.enemyAction(enemyScheduledGuard), true, JSON.stringify(validators.enemyAction.errors));
const compiledEnemyScheduledGuard = core.compileCompactEffectList(enemyScheduledGuard.effects, {
  enemyCollectionTarget: 'self',
});
assert.equal(compiledEnemyScheduledGuard.ok, true, JSON.stringify(compiledEnemyScheduledGuard.issues));
assert.equal(compiledEnemyScheduledGuard.value.steps[0].effects[0].target, 'self');

const enemyChoiceGuard = {
  id: 'matrix_enemy_choice_guard',
  name: '选择群体守护',
  effects: {
    choose: 'enemy_guard_mode',
    options: [
      { id: 'allies', label: '守护全体', effects: { block: 2, targets: { mode: 'all' } } },
      { id: 'self_only', label: '守护自身', effects: { block: 4 } },
    ],
  },
};
assert.equal(validators.enemyAction(enemyChoiceGuard), true, JSON.stringify(validators.enemyAction.errors));
const compiledEnemyChoiceGuard = core.compileCompactEffectList(enemyChoiceGuard.effects, {
  enemyCollectionTarget: 'self',
});
assert.equal(compiledEnemyChoiceGuard.ok, true, JSON.stringify(compiledEnemyChoiceGuard.issues));
assert.equal(compiledEnemyChoiceGuard.value.steps[0].options[0].effects[0].target, 'self');

const opposingSummon = {
  spawn_summon: {
    id: 'matrix_opposing_totem', name: '敌对图腾', emoji: 'T', max_hp: 5,
    actions: [{ id: 'guard_all', name: '群体守护', effects: { block: 2, targets: { mode: 'all' } } }],
  },
  to: 'opponent',
};
assert.equal(validators.ordinary(opposingSummon), true, JSON.stringify(validators.ordinary.errors));
const compiledOpposingSummon = core.compileCompactEffectList(opposingSummon, {
  enemyCollectionTarget: 'opponent',
});
assert.equal(compiledOpposingSummon.ok, true, JSON.stringify(compiledOpposingSummon.issues));
assert.equal(
  compiledOpposingSummon.value.steps[0].summon.actions[0].effectProgram.steps[0].target,
  'self',
  'a summon created for the enemy side compiles its ally selector from the enemy perspective',
);

for (const trigger of core.ABILITY_TRIGGERS) {
  const definition = {
    id: `matrix_${trigger}`,
    name: `矩阵 ${trigger}`,
    trigger: {
      on: trigger,
      effects: trigger === 'passive'
        ? { modify: 'damage', add: 1 }
        : { energy: 1 },
    },
  };
  assert.equal(
    validators.ability(definition),
    true,
    `${trigger} ability must be accepted by the shared AI schema: ${JSON.stringify(validators.ability.errors)}`,
  );
}
assert.equal(
  validators.ability({ id: 'legacy_trigger', name: '旧触发写法', trigger: 'turn_start', effects: { energy: 1 } }),
  false,
  'new AI output must not see the legacy sibling trigger spelling',
);
assert.equal(
  validators.ability({
    id: 'invalid_passive', name: '非法被动', trigger: { on: 'passive', effects: { damage: 1 } },
  }),
  false,
  'passive abilities may only expose continuous modifiers or card rules',
);

const statusTriggerEffects = {
  apply: { block: 1 },
  stack: { energy: 1 },
  tick: { damage: 'stacks', to: 'self' },
  remove: { heal: 1, to: 'self' },
  hold: { modify: 'block', add: 'stacks' },
  threshold_execute: { execute: 10, to: 'self' },
};
for (const trigger of core.STATUS_TRIGGERS) {
  const definition = {
    id: `matrix_status_${trigger}`,
    name: `矩阵状态 ${trigger}`,
    emoji: '◇',
    type: trigger === 'tick' ? 'debuff' : 'buff',
    stacks_change: trigger === 'tick' ? -1 : 'keep',
    triggers: { [trigger]: statusTriggerEffects[trigger] || { energy: 1 } },
  };
  assert.equal(
    validators.status(definition),
    true,
    `${trigger} status must be accepted by the shared AI schema: ${JSON.stringify(validators.status.errors)}`,
  );
  assert.ok(core.normalizeRuntimeStatusDefinition(definition), `${trigger} status must compile into the runtime registry`);
}
const permanentStun = {
  id: 'permanent_stun', name: '永久眩晕', emoji: '◇', type: 'debuff', stun: true, triggers: {},
};
assert.equal(validators.status(permanentStun), true, 'stun duration is a design choice, not a structural rejection');
assert.ok(core.normalizeRuntimeStatusDefinition(permanentStun), 'runtime must accept an executable permanent stun');

for (const [label, definition] of [
  ['nested listener in hold', {
    id: 'bad_hold_listener', name: '错误监听', emoji: '◇', type: 'buff', stacks_change: 'keep',
    triggers: { hold: { on: 'attack_played', effects: { block: 3 } } },
  }],
  ['active hold effect', {
    id: 'bad_hold', name: '错误持有', emoji: '◇', type: 'buff', stacks_change: 'keep',
    triggers: { hold: { damage: 1 } },
  }],
  ['modifier outside hold', {
    id: 'bad_apply', name: '错误获得', emoji: '◇', type: 'buff', stacks_change: 'keep',
    triggers: { apply: { modify: 'damage', add: 1 } },
  }],
  ['threshold targets opponent', {
    id: 'bad_execute', name: '错误清算', emoji: '◇', type: 'debuff', stacks_change: 'keep',
    triggers: { threshold_execute: { execute: 10, to: 'opponent' } },
  }],
]) {
  assert.equal(validators.status(definition), false, `${label} must be rejected by the shared AI schema`);
  assert.equal(core.normalizeRuntimeStatusDefinition(definition), null, `${label} must be rejected by the runtime registry`);
}

const summonSelector = { owner: 'self', pick: 'all' };
const generatedTemplates = [
  {
    id: 'matrix_token', name: '矩阵衍生牌', emoji: '◇', type: 'Attack', rarity: 'Common', cost: 0,
    description: '用于验证动态卡牌身份。', effects: { damage: 2 },
  },
  {
    id: 'matrix_form', name: '矩阵变形牌', emoji: '△', type: 'Skill', rarity: 'Uncommon', cost: 1,
    description: '用于验证变形后的可执行结构。', effects: { block: 3 },
  },
];

/** Every public shallow operation owns one canonical, executable fixture. */
const fixtures = {
  damage: { context: 'ordinary', effect: { damage: 3 }, op: 'damage' },
  execute: { context: 'ordinary', effect: { execute: 25, threshold_mode: 'hp_percent' }, op: 'execute' },
  kill: { context: 'ordinary', effect: { kill: true }, op: 'kill' },
  heal: { context: 'ordinary', effect: { heal: 3 }, op: 'heal' },
  block: { context: 'ordinary', effect: { block: 3 }, op: 'gain_block' },
  energy: { context: 'ordinary', effect: { energy: 1 }, op: 'gain_energy' },
  resource: { context: 'ordinary', effect: { resource: { id: 'charge', amount: 1 } }, op: 'gain_resource' },
  set_resource: { context: 'ordinary', effect: { set_resource: { id: 'charge', value: 2 } }, op: 'set_resource' },
  lust: { context: 'ordinary', effect: { lust: 3 }, op: 'gain_lust' },
  persistent_growth: { context: 'card', effect: { persistent_growth: 'max_hp', add: 2 }, op: 'persistent_growth' },
  set_hp: { context: 'ordinary', effect: { set_hp: 7 }, op: 'set_stat' },
  set_lust: { context: 'ordinary', effect: { set_lust: 7 }, op: 'set_stat' },
  set_energy: { context: 'ordinary', effect: { set_energy: 2 }, op: 'set_stat' },
  set_block: { context: 'ordinary', effect: { set_block: 4 }, op: 'set_stat' },
  narrate: { context: 'event', effect: { narrate: '局势因此改变。' }, op: 'narrate' },
  apply_status: { context: 'ordinary', effect: { apply_status: 'focus', stacks: 2, to: 'self' }, op: 'apply_status' },
  status_action: { context: 'ordinary', effect: { status_action: { mode: 'remove', from: 'self', pick: 'first' } }, op: 'status_action' },
  remove_status: { context: 'ordinary', effect: { remove_status: 'focus', to: 'self' }, op: 'remove_status' },
  draw: { context: 'ordinary', effect: { draw: 1 }, op: 'draw_cards' },
  scry: { context: 'ordinary', effect: { scry: 2 }, op: 'scry_cards' },
  seek: { context: 'ordinary', effect: { seek: 1 }, op: 'recover_cards' },
  discard: { context: 'ordinary', effect: { discard: 1, from: 'hand', pick: 'random' }, op: 'discard_cards' },
  exhaust: { context: 'ordinary', effect: { exhaust: 1, from: 'hand', pick: 'choose' }, op: 'exhaust_cards' },
  recover: { context: 'ordinary', effect: { recover: 1, from: 'discard', pick: 'choose' }, op: 'recover_cards' },
  reduce_cost: { context: 'ordinary', effect: { reduce_cost: 1, from: 'hand', pick: 'left', count: 1 }, op: 'reduce_card_cost' },
  modify_card: { context: 'ordinary', effect: { modify_card: 'damage', add: 1, from: 'hand', pick: 'choose' }, op: 'modify_card_value' },
  patch_card: { context: 'ordinary', effect: { patch_card: 'cost', subtract: 1, scope: 'combat', from: 'hand', pick: 'choose' }, op: 'apply_card_patch' },
  attach_card: {
    context: 'ordinary',
    effect: {
      attach_card: {
        id: 'matrix_binding', kind: 'affliction', name: '矩阵束缚', scope: 'combat',
        changes: [{ kind: 'cost', operator: 'add', value: 1 }],
      },
      from: 'hand', pick: 'choose', count: 1,
    },
    op: 'apply_card_attachment',
  },
  upgrade_card: {
    context: 'ordinary',
    effect: {
      upgrade_card: 1, from: 'hand', pick: 'choose', scope: 'run', levels: 1,
      changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 1 }],
    },
    op: 'upgrade_cards',
  },
  copy: { context: 'ordinary', effect: { copy: 1, from: 'hand', pick: 'choose' }, op: 'copy_cards' },
  double: { context: 'ordinary', effect: { double: 1, from: 'hand', pick: 'choose' }, op: 'double_card_effect' },
  replay_current: { context: 'card', effect: { replay_current: 1 }, op: 'replay_current' },
  add_card: { context: 'ordinary', effect: { add_card: 'matrix_token', to: 'hand', count: 1 }, op: 'add_card', creates: true },
  ensure_card: { context: 'ordinary', effect: { ensure_card: 'matrix_token', to: 'deck', minimum: 1 }, op: 'ensure_card', creates: true },
  modify: { context: 'passive', effect: { modify: 'damage', add: 1 }, op: 'modify' },
  card_rule: { context: 'passive', effect: { card_rule: 'replay', limit: 1, extra: 1 }, op: 'card_play_rule' },
  stance: {
    context: 'ordinary',
    effect: {
      stance: {
        id: 'matrix_stance', name: '矩阵姿态', emoji: '◈',
        enter: { block: 2 }, exit: { energy: 1 }, passive: { modify: 'damage', add: 1 },
      },
    },
    op: 'set_stance',
  },
  channel_orb: {
    context: 'ordinary',
    effect: {
      channel_orb: {
        id: 'matrix_orb', name: '矩阵 Orb', emoji: '◉', value: 2,
        passive: { block: 1 }, evoke: { damage: 2 },
      },
    },
    op: 'channel_orb',
  },
  spawn_summon: {
    context: 'ordinary',
    effect: {
      spawn_summon: {
        id: 'matrix_guard', name: '矩阵守卫', emoji: '▣', max_hp: 6,
        actions: [{ id: 'cover', name: '掩护', effects: { summoner_effects: { block: 2 } } }],
        abilities: [{
          id: 'cycle', name: '循环掩护',
          trigger: { on: 'turn_start', effects: { summoner_effects: { block: 1 } } },
        }],
        resources: { charge: { name: '充能', emoji: '⚡', max: 3, refresh: 'retain' } },
        modifiers: { damage_modifier: 1 },
        actions_per_activation: 1,
        action_priority: 1,
        speed: 1,
        intercept: { mode: 'unblocked_attack', priority: 1, max_per_turn: 1 },
        capabilities: { selectable: true, accepts_status: true, acts: true, intercepts: true },
      },
    },
    op: 'spawn_summon',
  },
  spawn_enemy: {
    context: 'ordinary',
    effect: {
      spawn_enemy: {
        id: 'matrix_enemy', name: '矩阵增援', emoji: '◆', max_hp: 8, hp: 8,
        max_lust: 100, lust: 0,
        actions: [{ id: 'hit', name: '攻击', weight: 1, effects: { damage: 2 } }],
        abilities: [{ id: 'guard_cycle', name: '守势循环', trigger: { on: 'turn_start', effects: { block: 1 } } }],
        status_effects: [{ id: 'focus', stacks: 1 }],
        lust_effect: { name: '失控', effects: { damage: 1 } },
        action_mode: 'random', action_config: {},
        resources: [{ id: 'charge', name: '充能', emoji: '⚡', current: 1, max: 3, refresh: 'retain' }],
        stance: {
          id: 'guard_stance', name: '守势', emoji: '◇',
          enter: { block: 2 }, passive: { modify: 'block', add: 1 },
        },
        orb_slots: 2,
        orbs: [{
          id: 'matrix_orb', name: '矩阵 Orb', emoji: '◉', value: 2,
          passive: { block: 1 }, evoke: { damage: 2 },
        }],
      },
    },
    op: 'spawn_enemy',
  },
  damage_summon: { context: 'ordinary', effect: { damage_summon: { selector: summonSelector, amount: 2 } }, op: 'damage_summons' },
  heal_summon: { context: 'ordinary', effect: { heal_summon: { selector: summonSelector, amount: 2 } }, op: 'heal_summons' },
  modify_summon: { context: 'ordinary', effect: { modify_summon: { selector: summonSelector, stat: 'speed', add: 1 } }, op: 'modify_summons' },
  modify_summon_effect: { context: 'ordinary', effect: { modify_summon_effect: { selector: summonSelector, stat: 'damage', add: 1 } }, op: 'modify_summon_effects' },
  summon_resource: { context: 'ordinary', effect: { summon_resource: { selector: summonSelector, id: 'charge', amount: 1 } }, op: 'gain_summon_resource' },
  set_summon_resource: { context: 'ordinary', effect: { set_summon_resource: { selector: summonSelector, id: 'charge', value: 1 } }, op: 'set_summon_resource' },
  apply_summon_status: { context: 'ordinary', effect: { apply_summon_status: { selector: summonSelector, id: 'focus', stacks: 1 } }, op: 'apply_summon_status' },
  remove_summon_status: { context: 'ordinary', effect: { remove_summon_status: { selector: summonSelector, id: 'focus' } }, op: 'remove_summon_status' },
  activate_summon: { context: 'ordinary', effect: { activate_summon: { selector: summonSelector } }, op: 'activate_summons' },
  trigger_summon_death: { context: 'ordinary', effect: { trigger_summon_death: { selector: summonSelector } }, op: 'activate_summons' },
  dismiss_summon: { context: 'ordinary', effect: { dismiss_summon: { selector: summonSelector, retain_corpse: true } }, op: 'dismiss_summons' },
  copy_summon: { context: 'ordinary', effect: { copy_summon: { selector: summonSelector, to: 'self' } }, op: 'copy_summons' },
  summoner_effects: { context: 'summon', effect: { summoner_effects: { block: 2 } }, op: 'summoner_effects' },
  evoke_orb: { context: 'ordinary', effect: { evoke_orb: 1, pick: 'first' }, op: 'evoke_orbs' },
  orb_slots: { context: 'ordinary', effect: { orb_slots: 3 }, op: 'set_orb_slots' },
  modify_orb: { context: 'ordinary', effect: { modify_orb: 'value', pick: 'first', add: 1 }, op: 'modify_orbs' },
  extra_turn: { context: 'ordinary', effect: { extra_turn: 1, to: 'self' }, op: 'grant_extra_turn' },
  enemy_intent: { context: 'ordinary', effect: { enemy_intent: 'tap' }, op: 'enemy_intent' },
  say: { context: 'ordinary', effect: { say: '准备迎战' }, op: 'say' },
  wait: { context: 'ordinary', effect: { wait: true }, op: 'wait' },
  end_turn: { context: 'ordinary', effect: { end_turn: true, to: 'opponent' }, op: 'force_end_turn' },
  schedule: { context: 'ordinary', effect: { schedule: 1, phase: 'turn_start', effects: { block: 2 } }, op: 'schedule_effect' },
  guard: { context: 'ordinary', effect: { guard: 'self.hp > 0', effects: [{ block: 2 }, { draw: 1 }] }, op: 'if' },
  auto_play: { context: 'ordinary', effect: { auto_play: 1, from: 'draw', pick: 'top', free: true }, op: 'auto_play_cards' },
  card_destination: { context: 'card', effect: { card_destination: 'draw_top' }, op: 'set_card_destination' },
  move_card: { context: 'ordinary', effect: { move_card: 1, from: 'discard', pick: 'top', destination: 'hand' }, op: 'move_cards' },
  remove_card: { context: 'ordinary', effect: { remove_card: 1, from: 'hand', pick: 'choose' }, op: 'remove_cards' },
  transform_card: { context: 'ordinary', effect: { transform_card: 'matrix_form', from: 'hand', pick: 'choose' }, op: 'transform_cards', creates: true },
  choose: {
    context: 'ordinary',
    effect: {
      choose: 'matrix_choice',
      options: [
        { id: 'strike', label: '攻击', effects: { damage: 2 } },
        { id: 'guard', label: '防御', effects: { block: 2 } },
      ],
    },
    op: 'choose_one',
  },
};

function publicOperationNames() {
  const meta = new Set(core.COMPACT_EFFECT_META_KEYS);
  const found = new Set();
  const visiting = new Set();
  const visit = schema => {
    if (!schema || typeof schema !== 'object') return;
    if (schema.$ref?.startsWith('#/$defs/')) {
      const name = schema.$ref.slice('#/$defs/'.length);
      if (visiting.has(name)) return;
      visiting.add(name);
      visit(portableSchema.$defs[name]);
      visiting.delete(name);
      return;
    }
    if (schema.properties) {
      Object.keys(schema.properties).filter(key => !meta.has(key)).forEach(key => found.add(key));
      return;
    }
    for (const keyword of ['oneOf', 'anyOf', 'allOf']) (schema[keyword] || []).forEach(visit);
  };
  visit(portableSchema.$defs.effect);
  return [...found].sort();
}

function portableOperationMetaKeys() {
  const operations = new Set(Object.keys(fixtures));
  const result = Object.fromEntries([...operations].map(operation => [operation, new Set()]));
  const visiting = new Set();
  const visit = schema => {
    if (!schema || typeof schema !== 'object') return;
    if (schema.$ref?.startsWith('#/$defs/')) {
      const name = schema.$ref.slice('#/$defs/'.length);
      if (name === 'bundleEffect' || visiting.has(name)) return;
      visiting.add(name);
      visit(portableSchema.$defs[name]);
      visiting.delete(name);
      return;
    }
    if (schema.properties) {
      const propertyNames = Object.keys(schema.properties);
      const ownedOperations = propertyNames.filter(key => operations.has(key));
      if (ownedOperations.length > 0) {
        const metadata = propertyNames.filter(key => !operations.has(key));
        ownedOperations.forEach(operation => metadata.forEach(key => result[operation].add(key)));
      }
    }
    for (const keyword of ['oneOf', 'anyOf', 'allOf']) (schema[keyword] || []).forEach(visit);
  };
  for (const branch of portableSchema.$defs.effect.anyOf || []) visit(branch);
  return Object.fromEntries(Object.entries(result).map(([operation, keys]) => [operation, [...keys].sort()]));
}

assert.deepEqual(
  Object.keys(fixtures).sort(),
  publicOperationNames(),
  'the matrix must gain a fixture whenever the public effect schema gains or loses an operation',
);

const schemaMetaKeys = portableOperationMetaKeys();
const metadataDrift = [];
for (const operation of publicOperationNames()) {
  const projected = [...core.compactOperationMetaKeys(operation)].sort();
  if (JSON.stringify(projected) !== JSON.stringify(schemaMetaKeys[operation])) {
    metadataDrift.push({ operation, projected, schema: schemaMetaKeys[operation] });
  }
}
assert.deepEqual(metadataDrift, [], 'projection metadata drifted from the portable public schema');

for (const operation of publicOperationNames()) {
  assert.ok(
    authoringContract.includes(operation),
    `the background authoring prompt does not advertise public operation ${operation}`,
  );
  assert.ok(
    worldbookContract.includes(operation),
    `the worldbook does not document public operation ${operation}`,
  );
}

const exactContractProbes = [
  ['structured trigger', 'trigger:{on,effects}'],
  ['summon health', '生命：有生命用正数 max_hp'],
  ['summon legacy boundary', '不输出 hp、顶层 trigger 或旧存档单数 action'],
  ['summon action choice', 'actions 始终为数组，各项 effects 非空'],
  ['summon intercept', 'intercept 仅 {mode:"unblocked_attack",priority?:整数,max_per_turn?:正整数}'],
  ['summon defeated policy', 'on_defeated=new_instance/revive_reset/revive_reinforce'],
  ['summon overflow policy', 'overflow=reject/replace_oldest/replace_lowest_hp'],
  ['summon output modifier', '{modify_summon_effect:{selector,stat,add/subtract/multiply/divide}}；stat=damage/block/lust/stacks'],
  ['power omitted immediate effects', '只有 trigger 时省略根 effects，不写空数组；不用 trigger 的 Power 仍需非空根 effects'],
  ['summon resources', 'resources 为资源ID到 {name,emoji,max,refresh:"reset"|"retain",start?或current?} 的映射'],
  ['card upgrade', 'upgrade_card:数量或"all"'],
  ['named attachment', 'attach_card:{id,kind,name,scope,changes}'],
  ['choice effects', 'options:[{id,label,effects},...]'],
  ['status trigger payload', '每个已写触发键的值直接是非空浅层效果对象或非空数组'],
  ['event-only narration', 'narrate 仅用于 Event 卡唯一顶层效果'],
  ['current-card replay', 'replay_current'],
];
for (const [label, fragment] of exactContractProbes) {
  assert.ok(authoringContract.includes(fragment), `background prompt lost ${label}: ${fragment}`);
}
for (const fragment of [
  '`upgrade_card`', '`move_card/remove_card/transform_card`', '`spawn_summon`', '`spawn_enemy`',
  '`trigger`', '`status_applied`', '`status_removed`', 'Event 的唯一效果为 `{narrate:',
]) assert.ok(worldbookContract.includes(fragment), `worldbook lost canonical contract fragment ${fragment}`);

const commandState = {
  self: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0, resources: { charge: { current: 1, max: 3 } } },
  opponent: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  currentTurn: 1,
  cardsPlayedThisTurn: 0,
  attacksPlayedThisTurn: 0,
  skillsPlayedThisTurn: 0,
};

function policyFor(context) {
  const common = { knownStatusIds: new Set(['focus']) };
  if (context === 'passive') return { ...common, triggerPolicy: 'forbid', modifierPolicy: 'only' };
  if (context === 'event') return { ...common, triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowNarrate: true, requireSingleNarrate: true };
  if (context === 'summon') return { ...common, triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowSummonerEffects: true };
  if (context === 'card') return {
    ...common,
    triggerPolicy: 'forbid',
    modifierPolicy: 'forbid',
    allowCardDestination: true,
    allowCurrentCardReplay: true,
    allowPersistentGrowth: true,
    allowPersistentGrowth: true,
  };
  return { ...common, triggerPolicy: 'forbid', modifierPolicy: 'forbid' };
}

function cardFor(name, fixture) {
  const base = {
    id: `matrix_${name}`, name: `矩阵·${name}`, emoji: '◇', rarity: 'Common', quantity: 1,
    description: '机制契约矩阵夹具。',
  };
  if (fixture.context === 'passive') {
    return { ...base, type: 'Power', cost: 1, trigger: { on: 'passive', effects: fixture.effect } };
  }
  if (fixture.context === 'event') return { ...base, type: 'Event', cost: 0, effects: fixture.effect };
  if (fixture.context === 'summon') {
    return {
      ...base, type: 'Skill', cost: 1,
      effects: {
        spawn_summon: {
          id: 'matrix_owner_link', name: '矩阵连携体', emoji: '▣', max_hp: 5,
          actions: [{ id: 'matrix_action', name: '矩阵行动', effects: fixture.effect }],
        },
      },
    };
  }
  return {
    ...base, type: 'Skill', cost: 1, effects: fixture.effect,
    ...(fixture.creates ? { creates: generatedTemplates } : {}),
  };
}

function battleFor(card) {
  return {
    core: {
      emoji: '🧙', hp: 30, max_hp: 30, lust: 0, max_lust: 100,
      resources: [{ id: 'charge', name: '充能', emoji: '⚡', current: 1, max: 3, refresh: 'retain' }],
      orb_slots: 3, orbs: [],
    },
    cards: [card],
    artifacts: [], items: [], player_abilities: [], player_status_effects: [],
    statuses: [{
      id: 'focus', name: '专注', emoji: '✨', type: 'buff', stacks_change: -1, maxStacks: 99, triggers: {},
    }],
    player_lust_effect: { name: '反击', effects: { damage: 2 } },
    enemy: {
      id: 'matrix_dummy', name: '矩阵假人', emoji: '◆', hp: 20, max_hp: 20, lust: 0, max_lust: 100,
      actions: [{ id: 'tap', name: '轻击', weight: 1, effects: { damage: 1 } }],
      abilities: [], status_effects: [],
      lust_effect: { name: '失控', effects: { damage: 1 } },
      action_mode: 'random', action_config: {},
    },
  };
}

const runtimeAstContractFailures = [];
const compiledAstFixtures = new Map();

for (const [name, fixture] of Object.entries(fixtures)) {
  const validate = validators[fixture.context];
  assert.equal(validate(fixture.effect), true, `${name} AI schema: ${JSON.stringify(validate.errors)}`);

  const compiled = core.compileCompactEffectList(fixture.effect, {
    ...(fixture.creates ? { creates: generatedTemplates } : {}),
    statusNames: { focus: '专注' },
  });
  assert.equal(compiled.ok, true, `${name} compile: ${JSON.stringify(compiled.issues)}`);
  assert.equal(compiled.value.steps[0]?.op, fixture.op, `${name} compiler lowered to the wrong runtime operation`);
  compiledAstFixtures.set(name, structuredClone(compiled.value));
  if (!validateRuntimeAst(compiled.value)) {
    const allErrors = structuredClone(validateRuntimeAst.errors || []);
    const operationErrors = allErrors.filter(error =>
      error.instancePath.startsWith('/steps/0/enemy/') ||
      error.instancePath.startsWith('/steps/0/summon/') ||
      error.instancePath.startsWith('/steps/0/orb/') ||
      error.instancePath.startsWith('/steps/0/stance/'),
    );
    runtimeAstContractFailures.push({
      name,
      op: compiled.value.steps[0]?.op,
      errors: operationErrors.length > 0 ? operationErrors : allErrors.slice(0, 12),
    });
  }

  const policy = core.validateEffectProgramPolicy(compiled.value, policyFor(fixture.context));
  assert.equal(policy.ok, true, `${name} policy: ${JSON.stringify(policy.issues)}`);

  const tags = core.effectProgramToDisplayTags(compiled.value, {
    statusNames: { focus: '专注' }, resourceNames: { charge: '充能' },
  });
  assert.ok(tags.length > 0 && tags.every(tag => tag.text.trim().length > 0), `${name} has no authoritative UI description`);

  const commands = [];
  const commandResult = await core.runEffectCommandProgram(compiled.value, { spentEnergy: 0 }, {
    readState: () => structuredClone(commandState),
    execute: command => { commands.push(command); },
    chooseEffectOption: choice => choice.options[0].id,
  });
  assert.equal(commandResult.completed, true, `${name} command runtime did not complete`);
  assert.ok(commands.length > 0, `${name} produced no runtime command`);

  // `runEffectCommandProgram` producing a command is not enough: the Tavern
  // host must route every actionable command into a real mutation port.
  const routed = [];
  const mark = command => { routed.push(command.type); };
  const host = new TavernEffectCommandHost({
    readState: () => structuredClone(commandState),
    isTerminal: () => false,
    executeCardCommand: async command => mark(command),
    presentCommand: () => {},
    executeBattleCommand: async command => mark(command),
    executePersistentGrowth: async command => mark(command),
    executeSpecialCommand: async command => mark(command),
    executeSummonCommand: async command => mark(command),
    executeEnemyCommand: async command => mark(command),
    executeSummonerProgram: async command => mark(command),
    forEachEnemyTarget: async (_selector, execute) => execute('matrix_dummy'),
    applyStatus: async () => routed.push('apply_status'),
    removeStatuses: async () => routed.push('remove_status'),
    executeStatusAction: async () => routed.push('status_action'),
    registerAbility: async () => routed.push('register_trigger'),
    scheduleEffect: async () => routed.push('schedule_effect'),
    setCardDestination: async () => routed.push('set_card_destination'),
    narrate: async () => routed.push('narration'),
    chooseEffectOption: choice => choice.options[0].id,
  });
  await host.executeProgram(compiled.value, true);
  const expectedRoutes = commands
    .map(command => command.type)
    .filter(type => type !== 'choice_selected' && type !== 'card_play_rule');
  assert.deepEqual(routed.sort(), expectedRoutes.sort(), `${name} Tavern command routing dropped or duplicated an operation`);

  const preflight = preflightBattleContent(battleFor(cardFor(name, fixture)));
  assert.equal(preflight.ok, true, `${name} battle preflight: ${JSON.stringify(preflight.issues)}`);
}

assert.deepEqual(
  runtimeAstContractFailures,
  [],
  `compiler emitted operations outside mwg-effect-v1: ${JSON.stringify(runtimeAstContractFailures)}`,
);

const attachmentEffect = (change, extra = {}) => ({
  attach_card: {
    id: 'matrix_attachment', kind: 'enchantment', name: 'Matrix attachment',
    changes: [change],
    ...extra,
  },
  from: 'hand', pick: 'choose', count: 1,
});
const upgradeEffect = change => ({
  upgrade_card: 1, from: 'hand', pick: 'choose', scope: 'run', changes: [change],
});

/**
 * Branch-level contract parity. The operation matrix above proves every public
 * verb has a complete route. These cases prove each polymorphic verb exposes
 * exactly the same shape to the model that the compact compiler understands.
 */
const branchContractCases = [
  ['patch numeric add', 'ordinary', { patch_card: 'damage', add: 2, from: 'hand', pick: 'choose' }, true],
  ['patch numeric divide', 'ordinary', { patch_card: 'stacks', divide: 2, from: 'hand', pick: 'choose' }, true],
  ['patch cost set', 'ordinary', { patch_card: 'cost', set: 0, from: 'hand', pick: 'choose' }, true],
  ['patch x max', 'ordinary', { patch_card: 'x_value', max: 3, from: 'hand', pick: 'choose' }, true],
  ['patch dynamic cost', 'ordinary', { patch_card: 'dynamic_cost', timing: 'on_play', subtract: 1, minimum: 0, from: 'hand', pick: 'choose' }, true],
  ['patch replay', 'ordinary', { patch_card: 'replay', extra: 2, from: 'hand', pick: 'choose' }, true],
  ['patch keyword', 'ordinary', { patch_card: 'retain', enabled: true, from: 'hand', pick: 'choose' }, true],
  ['patch future template copies', 'ordinary', { patch_card: 'damage', add: 1, match: 'template', future_copies: true, from: 'combat', pick: 'all' }, true],
  ['patch numeric rejects set', 'ordinary', { patch_card: 'damage', set: 2, from: 'hand', pick: 'choose' }, false],
  ['patch numeric rejects mixed operators', 'ordinary', { patch_card: 'damage', add: 1, multiply: 2, from: 'hand', pick: 'choose' }, false],
  ['patch cost requires operator', 'ordinary', { patch_card: 'cost', from: 'hand', pick: 'choose' }, false],
  ['patch replay requires extra', 'ordinary', { patch_card: 'replay', from: 'hand', pick: 'choose' }, false],
  ['patch replay rejects arithmetic', 'ordinary', { patch_card: 'replay', extra: 1, add: 1, from: 'hand', pick: 'choose' }, false],
  ['patch keyword requires enabled', 'ordinary', { patch_card: 'exhaust', from: 'hand', pick: 'choose' }, false],
  ['patch dynamic requires timing', 'ordinary', { patch_card: 'dynamic_cost', subtract: 1, from: 'hand', pick: 'choose' }, false],
  ['patch future copies require durable match', 'ordinary', { patch_card: 'damage', add: 1, future_copies: true, from: 'hand', pick: 'choose' }, false],

  ['attachment numeric', 'ordinary', attachmentEffect({ kind: 'numeric', stat: 'block', operator: 'multiply', value: 2 }), true],
  ['attachment cost set', 'ordinary', attachmentEffect({ kind: 'cost', operator: 'set', value: 0 }), true],
  ['attachment keyword', 'ordinary', attachmentEffect({ kind: 'keyword', keyword: 'ethereal', enabled: true }), true],
  ['attachment replay', 'ordinary', attachmentEffect({ kind: 'replay', extra: 2 }), true],
  ['attachment dynamic', 'ordinary', attachmentEffect({ kind: 'dynamic_cost', timing: 'while_in_hand', operator: 'min', value: 1, minimum: 0 }), true],
  ['attachment play access', 'ordinary', attachmentEffect({ kind: 'play_access', mode: 'deny' }), true],
  ['attachment discard auto play', 'ordinary', attachmentEffect({ kind: 'discard_auto_play', reasons: ['player_choice'], failure_destination: 'exhaust', only_player_turn: true }), true],
  ['attachment discard removal filter', 'ordinary', attachmentEffect(
    { kind: 'keyword', keyword: 'retain', enabled: true },
    { remove_on: 'discarded', discard_reasons: ['effect'] },
  ), true],
  ['attachment numeric rejects set', 'ordinary', attachmentEffect({ kind: 'numeric', stat: 'damage', operator: 'set', value: 1 }), false],
  ['attachment cost requires operator', 'ordinary', attachmentEffect({ kind: 'cost', value: 1 }), false],
  ['attachment keyword requires enabled', 'ordinary', attachmentEffect({ kind: 'keyword', keyword: 'retain' }), false],
  ['attachment replay requires extra', 'ordinary', attachmentEffect({ kind: 'replay' }), false],
  ['attachment dynamic requires timing', 'ordinary', attachmentEffect({ kind: 'dynamic_cost', operator: 'add', value: 1 }), false],
  ['attachment play access requires mode', 'ordinary', attachmentEffect({ kind: 'play_access' }), false],
  ['attachment discard auto play requires reasons', 'ordinary', attachmentEffect({ kind: 'discard_auto_play' }), false],
  ['attachment discard reasons require discarded removal', 'ordinary', attachmentEffect(
    { kind: 'keyword', keyword: 'retain', enabled: true },
    { remove_on: 'turn_end', discard_reasons: ['effect'] },
  ), false],

  ['upgrade numeric', 'ordinary', upgradeEffect({ kind: 'numeric', stat: 'damage', operator: 'add', value: 2 }), true],
  ['upgrade cost min', 'ordinary', upgradeEffect({ kind: 'cost', operator: 'min', value: 1 }), true],
  ['upgrade keyword', 'ordinary', upgradeEffect({ kind: 'keyword', keyword: 'innate', enabled: true }), true],
  ['upgrade replay', 'ordinary', upgradeEffect({ kind: 'replay', extra: 2 }), true],
  ['upgrade dynamic', 'ordinary', upgradeEffect({ kind: 'dynamic_cost', timing: 'on_draw', operator: 'subtract', value: 1, minimum: 0 }), true],
  ['upgrade numeric rejects set', 'ordinary', upgradeEffect({ kind: 'numeric', stat: 'damage', operator: 'set', value: 2 }), false],
  ['upgrade replay requires extra', 'ordinary', upgradeEffect({ kind: 'replay' }), false],
  ['upgrade dynamic requires timing', 'ordinary', upgradeEffect({ kind: 'dynamic_cost', operator: 'subtract', value: 1 }), false],

  ['rule replay', 'passive', { card_rule: 'replay', limit: 2, extra: 1 }, true],
  ['rule replay requires extra', 'passive', { card_rule: 'replay', limit: 2 }, false],
  ['rule free resource', 'passive', { card_rule: 'free', limit: 2, resources: ['energy'] }, true],
  ['rule retain hand', 'passive', { card_rule: 'retain_hand' }, true],
  ['rule retain block', 'passive', { card_rule: 'retain_block' }, true],
  ['rule draw limit', 'passive', { card_rule: 'limit_draw', limit: 5 }, true],
  ['rule block limit', 'passive', { card_rule: 'limit_block_gain', limit: 8 }, true],
  ['rule energy limit', 'passive', { card_rule: 'limit_energy_gain', limit: 3 }, true],
  ['rule deny card', 'passive', { card_rule: 'deny_card_play', card_type: 'Attack' }, true],
  ['rule allow card', 'passive', { card_rule: 'allow_card_play', tag: 'summon' }, true],
  ['rule play limit', 'passive', { card_rule: 'limit_card_play', limit: 2, rarity: 'Rare' }, true],
  ['rule destination', 'passive', { card_rule: 'card_destination', destination: 'draw_top', card_type: 'Skill' }, true],
  ['rule replay requires limit', 'passive', { card_rule: 'replay', extra: 1 }, false],
  ['rule non replay rejects extra', 'passive', { card_rule: 'free', limit: 1, extra: 1 }, false],
  ['rule retain rejects limit', 'passive', { card_rule: 'retain_hand', limit: 1 }, false],
  ['rule destination requires destination', 'passive', { card_rule: 'card_destination', card_type: 'Skill' }, false],
  ['rule resources only belong to free', 'passive', { card_rule: 'replay', limit: 1, resources: 'all' }, false],

  ['discard all uses the operation value', 'ordinary', { discard: 'all', from: 'hand' }, true],
  ['discard numeric cannot claim pick all', 'ordinary', { discard: 1, from: 'hand', pick: 'all' }, false],
  ['recover all uses the operation value', 'ordinary', { recover: 'all', from: 'discard' }, true],
  ['recover numeric cannot claim pick all', 'ordinary', { recover: 1, from: 'discard', pick: 'all' }, false],
  ['reduce cost can select all without count', 'ordinary', { reduce_cost: 1, from: 'hand', pick: 'all' }, true],
  ['reduce cost all rejects count', 'ordinary', { reduce_cost: 1, from: 'hand', pick: 'all', count: 2 }, false],
  ['modify card can select all without count', 'ordinary', { modify_card: 'damage', add: 1, from: 'hand', pick: 'all' }, true],
  ['modify card all rejects count', 'ordinary', { modify_card: 'damage', add: 1, from: 'hand', pick: 'all', count: 2 }, false],
  ['patch card can select all without count', 'ordinary', { patch_card: 'damage', add: 1, from: 'hand', pick: 'all' }, true],
  ['patch card all rejects count', 'ordinary', { patch_card: 'damage', add: 1, from: 'hand', pick: 'all', count: 2 }, false],
  ['copy all uses the operation value', 'ordinary', { copy: 'all', from: 'hand' }, true],
  ['copy numeric cannot claim pick all', 'ordinary', { copy: 1, from: 'hand', pick: 'all' }, false],
  ['double all uses the operation value', 'ordinary', { double: 'all', from: 'hand' }, true],
  ['double numeric cannot claim pick all', 'ordinary', { double: 1, from: 'hand', pick: 'all' }, false],
  ['upgrade all uses the operation value', 'ordinary', {
    upgrade_card: 'all', from: 'hand',
    changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 1 }],
  }, true],
  ['upgrade numeric cannot claim pick all', 'ordinary', {
    upgrade_card: 1, from: 'hand', pick: 'all',
    changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 1 }],
  }, false],
  ['upgrade rejects ignored sibling count', 'ordinary', {
    upgrade_card: 1, from: 'hand', count: 2,
    changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 1 }],
  }, false],
  ['auto play all uses the operation value', 'ordinary', { auto_play: 'all', from: 'draw' }, true],
  ['auto play numeric cannot claim pick all', 'ordinary', { auto_play: 1, from: 'draw', pick: 'all' }, false],
  ['auto play rejects ignored sibling count', 'ordinary', { auto_play: 1, from: 'draw', count: 2 }, false],
  ['move all uses the operation value', 'ordinary', { move_card: 'all', from: 'discard', destination: 'hand' }, true],
  ['move numeric cannot claim pick all', 'ordinary', { move_card: 1, from: 'discard', pick: 'all', destination: 'hand' }, false],
  ['move rejects ignored sibling count', 'ordinary', { move_card: 1, from: 'discard', count: 2, destination: 'hand' }, false],
  ['remove all uses the operation value', 'ordinary', { remove_card: 'all', from: 'hand' }, true],
  ['remove numeric cannot claim pick all', 'ordinary', { remove_card: 1, from: 'hand', pick: 'all' }, false],
  ['remove rejects ignored sibling count', 'ordinary', { remove_card: 1, from: 'hand', count: 2 }, false],

  ['stance complete definition', 'ordinary', {
    stance: {
      id: 'audit_stance', name: '审计姿态', enter: { block: 1 }, exit: { energy: 1 },
      passive: { modify: 'damage', add: 1 },
    },
  }, true],
  ['stance rejects unknown definition field', 'ordinary', {
    stance: { id: 'audit_stance', name: '审计姿态', duration: 2 },
  }, false],
  ['stance passive rejects active damage', 'ordinary', {
    stance: { id: 'audit_stance', name: '审计姿态', passive: { damage: 1 } },
  }, false],
  ['orb complete definition', 'ordinary', {
    channel_orb: { id: 'audit_orb', name: '审计 Orb', value: 2, passive: { block: 1 }, evoke: { damage: 2 } },
  }, true],
  ['orb accepts values that safely clamp at runtime', 'ordinary', {
    channel_orb: { id: 'audit_orb', name: '审计 Orb', value: -1 },
  }, true],
  ['evoke all rejects count', 'ordinary', { evoke_orb: 'all', pick: 'all', count: 2 }, false],
  ['modify orb rejects mixed operators', 'ordinary', { modify_orb: 'value', add: 1, multiply: 2 }, false],
  ['modify orb rejects literal divide zero', 'ordinary', { modify_orb: 'value', divide: 0 }, false],
  ['modify orb all rejects ignored count', 'ordinary', { modify_orb: 'value', add: 1, pick: 'all', count: 2 }, false],
  ['schedule repeat pair', 'ordinary', {
    schedule: 1, repeat_every: 2, repeats: 3, effects: { block: 1 },
  }, true],
  ['guard ordered children', 'ordinary', { guard: 'self.hp > 0', effects: [{ block: 2 }, { draw: 1 }] }, true],
  ['guard empty children', 'ordinary', { guard: 'self.hp > 0', effects: [] }, false],
  ['guard rejects group target', 'ordinary', { guard: 'self.hp > 0', effects: [{ draw: 1 }], to: 'self' }, false],
  ['guard rejects single child object', 'ordinary', { guard: 'self.hp > 0', effects: { draw: 1 } }, false],
  ['schedule repeat interval requires count', 'ordinary', {
    schedule: 1, repeat_every: 2, effects: { block: 1 },
  }, false],
  ['schedule count requires interval', 'ordinary', {
    schedule: 1, repeats: 2, effects: { block: 1 },
  }, false],
  ['summon no-hp utility', 'ordinary', {
    spawn_summon: {
      id: 'audit_utility', name: '审计装置', emoji: '◇', has_hp: false,
      actions: [{ id: 'support', name: '支援', effects: { summoner_effects: { block: 1 } } }],
    },
  }, true],
  ['summon no-hp utility rejects max hp', 'ordinary', {
    spawn_summon: {
      id: 'audit_utility', name: '审计装置', emoji: '◇', has_hp: false, max_hp: 5,
      actions: [{ id: 'support', name: '支援', effects: { summoner_effects: { block: 1 } } }],
    },
  }, false],
  ['summon default hp requires max hp', 'ordinary', {
    spawn_summon: { id: 'audit_guard', name: '审计守卫', emoji: '◇' },
  }, false],
  ['summon resource with start', 'ordinary', {
    spawn_summon: {
      id: 'audit_guard', name: '审计守卫', emoji: '◇', max_hp: 5,
      resources: {
        charge: { name: '充能', emoji: '⚡', start: 1, max: 3, refresh: 'retain' },
      },
    },
  }, true],
  ['summon resource rejects duplicated id', 'ordinary', {
    spawn_summon: {
      id: 'audit_guard', name: '审计守卫', emoji: '◇', max_hp: 5,
      resources: {
        charge: { id: 'wrong_id', name: '充能', emoji: '⚡', start: 1, max: 3, refresh: 'retain' },
      },
    },
  }, false],
  ['summon resource clamps initial value to max', 'ordinary', {
    spawn_summon: {
      id: 'audit_guard', name: '审计守卫', emoji: '◇', max_hp: 5,
      resources: {
        charge: { name: '充能', emoji: '⚡', start: 9, max: 3, refresh: 'retain' },
      },
    },
  }, true],
  ['summon random n selector requires count', 'ordinary', {
    activate_summon: { selector: { owner: 'self', pick: 'random_n' } },
  }, false],
  ['summon random n selector accepts count', 'ordinary', {
    activate_summon: { selector: { owner: 'self', pick: 'random_n', count: 2 } },
  }, true],
  ['summon order stays in supported range', 'ordinary', {
    spawn_summon: { id: 'audit_guard', name: '审计守卫', emoji: '◇', max_hp: 5, speed: 1000 },
  }, false],
  ['summon ability uses structured trigger only', 'ordinary', {
    spawn_summon: {
      id: 'audit_guard', name: '审计守卫', emoji: '◇', max_hp: 5,
      abilities: [{ id: 'pulse', trigger: { on: 'turn_start', effects: { summoner_effects: { block: 1 } } } }],
    },
  }, true],
  ['summon ability rejects sibling effects with structured trigger', 'ordinary', {
    spawn_summon: {
      id: 'audit_guard', name: '审计守卫', emoji: '◇', max_hp: 5,
      abilities: [{
        id: 'pulse', trigger: { on: 'turn_start', effects: { summoner_effects: { block: 1 } } },
        effects: { summoner_effects: { block: 1 } },
      }],
    },
  }, false],
  ['enemy reinforcement complete definition', 'ordinary', {
    spawn_enemy: {
      id: 'audit_enemy', name: '审计增援', emoji: '◆', hp: 8, max_hp: 8, lust: 0, max_lust: 100,
      resources: [{ id: 'charge', name: '充能', emoji: '⚡', start: 1, max: 3, refresh: 'retain' }],
      actions: [{ id: 'tap', name: '轻击', effects: { damage: 1 } }],
      abilities: [], status_effects: [], lust_effect: { name: '失控', effects: { damage: 1 } },
      action_mode: 'random', action_config: {},
    },
  }, true],
  ['enemy reinforcement rejects invalid action id', 'ordinary', {
    spawn_enemy: {
      id: 'audit_enemy', name: '审计增援', emoji: '◆', hp: 8, max_hp: 8, lust: 0, max_lust: 100,
      actions: [{ id: '错误 id', name: '轻击', effects: { damage: 1 } }],
      abilities: [], status_effects: [], lust_effect: { name: '失控', effects: { damage: 1 } },
      action_mode: 'random', action_config: {},
    },
  }, false],
  ['enemy reinforcement rejects unknown action field', 'ordinary', {
    spawn_enemy: {
      id: 'audit_enemy', name: '审计增援', emoji: '◆', hp: 8, max_hp: 8, lust: 0, max_lust: 100,
      actions: [{ id: 'tap', name: '轻击', effects: { damage: 1 }, cooldown: 2 }],
      abilities: [], status_effects: [], lust_effect: { name: '失控', effects: { damage: 1 } },
      action_mode: 'random', action_config: {},
    },
  }, false],
  ['enemy reinforcement requires positive lust cap', 'ordinary', {
    spawn_enemy: {
      id: 'audit_enemy', name: '审计增援', emoji: '◆', hp: 8, max_hp: 8, lust: 0, max_lust: 0,
      actions: [{ id: 'tap', name: '轻击', effects: { damage: 1 } }],
      abilities: [], status_effects: [], lust_effect: { name: '失控', effects: { damage: 1 } },
      action_mode: 'random', action_config: {},
    },
  }, false],
];

for (const [label, context, effect, expected] of branchContractCases) {
  const validate = validators[context];
  const schemaAccepted = validate(effect);
  const compiled = core.compileCompactEffectList(effect, { statusNames: { focus: 'Focus' } });
  assert.equal(schemaAccepted, expected, `${label} schema expected ${expected}: ${JSON.stringify(validate.errors)}`);
  assert.equal(compiled.ok, expected, `${label} compiler expected ${expected}: ${JSON.stringify(compiled.issues)}`);
  assert.equal(schemaAccepted, compiled.ok, `${label} schema/compiler contract drifted`);
  if (expected) {
    const policy = core.validateEffectProgramPolicy(compiled.value, policyFor(context));
    assert.equal(policy.ok, true, `${label} policy: ${JSON.stringify(policy.issues)}`);
  }
}

// Loading old saves may still compile the former singular summon action, but
// new AI-authored content has one unambiguous spelling: an `actions` array.
const legacySingularSummonAction = {
  spawn_summon: {
    id: 'legacy_guard', name: '旧式守卫', emoji: '◇', max_hp: 5,
    action: { summoner_effects: { block: 1 } },
  },
};
assert.equal(validators.ordinary(legacySingularSummonAction), false);
assert.equal(core.compileCompactEffectList(legacySingularSummonAction).ok, true);

const replayFormulaCases = [
  {
    label: 'patch replay formula',
    effect: { patch_card: 'replay', extra: '100', from: 'hand', pick: 'choose' },
    read: command => command.patch?.extra,
  },
  {
    label: 'attachment replay formula',
    effect: attachmentEffect({ kind: 'replay', extra: '100' }),
    read: command => command.attachment?.changes?.[0]?.extra,
  },
  {
    label: 'upgrade replay formula',
    effect: upgradeEffect({ kind: 'replay', extra: '100' }),
    read: command => command.changes?.[0]?.extra,
  },
];
for (const fixture of replayFormulaCases) {
  const compiled = core.compileCompactEffectList(fixture.effect);
  assert.equal(compiled.ok, true, `${fixture.label} compile: ${JSON.stringify(compiled.issues)}`);
  const commands = [];
  const result = await core.runEffectCommandProgram(compiled.value, { spentEnergy: 0 }, {
    readState: () => structuredClone(commandState),
    execute: command => commands.push(command),
  });
  assert.equal(result.completed, true, `${fixture.label} command resolution did not complete`);
  assert.equal(fixture.read(commands[0]), 20, `${fixture.label} must clamp to the runtime-supported maximum`);
}

function collectObjectPaths(value, path = []) {
  if (!value || typeof value !== 'object') return [];
  const paths = [];
  if (!Array.isArray(value)) paths.push(path);
  for (const [key, entry] of Object.entries(value)) {
    paths.push(...collectObjectPaths(entry, [...path, key]));
  }
  return paths;
}

function collectPropertyPaths(value, path = []) {
  if (!value || typeof value !== 'object') return [];
  const paths = [];
  for (const [key, entry] of Object.entries(value)) {
    const propertyPath = [...path, key];
    paths.push(propertyPath, ...collectPropertyPaths(entry, propertyPath));
  }
  return paths;
}

function mutateAtPath(value, path, mutation) {
  const result = structuredClone(value);
  let owner = result;
  for (const segment of path.slice(0, -1)) owner = owner[segment];
  mutation(owner, path.at(-1));
  return result;
}

function contractDecision(fixture, effect) {
  const validate = validators[fixture.context];
  const schema = validate(effect);
  const compile = core.compileCompactEffectList(effect, {
    ...(fixture.creates ? { creates: generatedTemplates } : {}),
    statusNames: { focus: '专注' },
  });
  const policy = compile.ok
    ? core.validateEffectProgramPolicy(compile.value, policyFor(fixture.context))
    : null;
  return {
    schema,
    compiler: compile.ok && policy?.ok === true,
    schemaErrors: (validate.errors || []).slice(0, 6).map(error => ({
      instancePath: error.instancePath,
      keyword: error.keyword,
      message: error.message,
    })),
    compilerIssues: compile.ok ? (policy?.issues || []).slice(0, 6) : compile.issues.slice(0, 6),
  };
}

function runtimeAstDecision(program) {
  return {
    schema: validateRuntimeAst(program),
    validator: core.validateEffectProgram(program).ok,
  };
}

/**
 * The internal AST validator and its JSON Schema are independent boundaries.
 * Mutating every compiled operation prevents one boundary from silently
 * accepting structures that the other would reject during persistence or a
 * later runtime handoff.
 */
const runtimeAstMutationDrifts = [];
for (const [name, program] of compiledAstFixtures) {
  const compareMutation = (mutation, candidate) => {
    const decision = runtimeAstDecision(candidate);
    if (decision.schema !== decision.validator) runtimeAstMutationDrifts.push({ name, mutation, ...decision });
  };
  for (const path of collectPropertyPaths(program)) {
    if (!/^\d+$/.test(path.at(-1))) {
      compareMutation(
        `delete ${path.join('.')}`,
        mutateAtPath(program, path, (owner, key) => { delete owner[key]; }),
      );
    }
    compareMutation(
      `null ${path.join('.')}`,
      mutateAtPath(program, path, (owner, key) => { owner[key] = null; }),
    );
  }
  for (const path of collectObjectPaths(program)) {
    const target = path.length ? path.join('.') : '$';
    compareMutation(
      `unknown ${target}`,
      mutateAtPath({ root: program }, ['root', ...path], (owner, key) => {
        owner[key].__unknown_runtime_ast_field = true;
      }).root,
    );
  }
}
assert.equal(
  runtimeAstMutationDrifts.length,
  0,
  `runtime AST schema/validator mutation drift:\n${runtimeAstMutationDrifts.map(item =>
    `${item.name}: ${item.mutation} (schema=${item.schema}, validator=${item.validator})`).join('\n')}`,
);

/**
 * Differential mutations catch public-contract drift that canonical happy-path
 * fixtures cannot reveal. Every nested property is removed and replaced with
 * null, and every object receives an unknown field. The AI schema and compact
 * compiler must make the same decision for each public shape.
 */
const mutationDrifts = [];
for (const [name, fixture] of Object.entries(fixtures)) {
  const compareMutation = (mutation, effect) => {
    const decision = contractDecision(fixture, effect);
    if (decision.schema !== decision.compiler) {
      mutationDrifts.push({ operation: name, mutation, ...decision });
    }
  };
  for (const path of collectPropertyPaths(fixture.effect)) {
    if (!/^\d+$/.test(path.at(-1))) {
      compareMutation(
        `delete ${path.join('.')}`,
        mutateAtPath(fixture.effect, path, (owner, key) => { delete owner[key]; }),
      );
    }
    compareMutation(
      `null ${path.join('.')}`,
      mutateAtPath(fixture.effect, path, (owner, key) => { owner[key] = null; }),
    );
  }
  for (const path of collectObjectPaths(fixture.effect)) {
    const target = path.length ? path.join('.') : '$';
    compareMutation(
      `unknown ${target}`,
      mutateAtPath({ root: fixture.effect }, ['root', ...path], (owner, key) => {
        const object = owner[key];
        object.__unknown_contract_field = true;
      }).root,
    );
  }
}
assert.equal(
  mutationDrifts.length,
  0,
  `AI schema/compiler mutation drift:\n${mutationDrifts.map(item => `${item.operation}: ${item.mutation} (schema=${item.schema}, compiler=${item.compiler})`).join('\n')}`,
);

const metadataProbeValues = {
  to: 'self', targets: { mode: 'active' }, when: 'self.hp > 0', on: 'turn_start',
  stacks: 2, hits: 2, damage_type: 'effect', bypass_block: true, lifesteal: 0.5,
  threshold_mode: 'hp_percent', exclude_tags: ['boss'], trigger_fatal: false,
  from: 'hand', pick: 'choose', count: 1, add: 1, subtract: 1, multiply: 2, divide: 2,
  set: 1, limit: 1, extra: 1, scope: 'combat', match: 'instance', future_copies: true,
  timing: 'on_draw', minimum: 0, maximum: 3, enabled: true, min: 0, max: 3,
  name: '筛选牌', card_type: 'Skill', rarity: 'Common', cost: 1, min_cost: 0, max_cost: 2,
  tag: 'audit', template_id: 'matrix_token', run_instance_id: 'run_card', combat_instance_id: 'combat_card',
  origin: 'deck', upgraded: false, root_only: true, include_copies: true, phase: 'turn_start',
  priority: 1, repeat_every: 1, repeats: 2, effects: { block: 1 }, free: true,
  destination: 'discard', position: 'top',
  options: [{ id: 'one', label: '一', effects: { block: 1 } }, { id: 'two', label: '二', effects: { damage: 1 } }],
  changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 1 }],
  levels: 1, max_level: 2, orb_id: 'matrix_orb', resources: 'all',
};
const metadataDecisionDrifts = [];
for (const [name, fixture] of Object.entries(fixtures)) {
  for (const [field, probe] of Object.entries(metadataProbeValues)) {
    if (Object.prototype.hasOwnProperty.call(fixture.effect, field)) continue;
    const effect = { ...structuredClone(fixture.effect), [field]: structuredClone(probe) };
    const decision = contractDecision(fixture, effect);
    if (decision.schema !== decision.compiler) {
      metadataDecisionDrifts.push({ operation: name, field, ...decision });
    }
  }
}
assert.equal(
  metadataDecisionDrifts.length,
  0,
  `AI schema/compiler metadata drift:\n${metadataDecisionDrifts.map(item => `${item.operation}+${item.field} (schema=${item.schema}, compiler=${item.compiler})`).join('\n')}`,
);

console.log(`AI mechanism contract matrix passed ${Object.keys(fixtures).length} public operations, ${branchContractCases.length} branch-level schema/compiler parity cases, differential mutations, and replay formula bounds.`);
