import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  normalizeMvuAuthoredContent,
  normalizeMvuPlayerAuthoredContent,
  normalizeMvuBattleContent,
} = require(resolve('src/runtime/mvuBattleContentNormalizer.ts'));
const { createContentPackFromMvuBattle } = require(resolve('src/runtime/contentPackAdapter.ts'));
const { validateContentPackContract } = require(resolve('src/game-core/index.ts'));

function validateAuthoredCard(card, statuses = []) {
  return validateContentPackContract(createContentPackFromMvuBattle({
    core: { emoji: 'T', hp: 20, max_hp: 20, lust: 0, max_lust: 100 },
    cards: [{ quantity: 1, ...structuredClone(card) }],
    artifacts: [],
    items: [],
    statuses: structuredClone(statuses),
    player_abilities: [],
    player_status_effects: [],
  }), { requireExecutable: true });
}

const source = {
  core: { emoji: '🌌', hp: 88, max_hp: 100, lust: 15, max_lust: 100 },
  statuses: [{
    id: '星屑刻印', name: '星屑刻印', emoji: '✨', type: 'debuff', description: '每层造成伤害。',
    triggers: {
      tick: [{ damage: { formula: 'stacks' } }],
      hold: { modify: { attribute: 'damage_taken', add: 2 } },
    }, maxStacks: 10,
  }],
  cards: [
    { id: 'strike', name: '星屑挥击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: [{ damage: 6 }] },
    { id: 'guard', name: '共鸣屏障', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: [{ block: 5 }] },
    {
      id: 'converge', name: '星钻集束', type: 'Attack', rarity: 'Uncommon', cost: 2, quantity: 1,
      effects: [
        {
          damage: { formula: '10 + self.opponent.status.星屑刻印.stacks' },
          when: 'self|opponent.status.星屑刻印.stacks >= 1',
        },
        {
          apply_status: {
            id: '星屑刻印', name: '星屑刻印', emoji: '✨', type: 'debuff',
            description: '每层造成伤害。', triggers: {}, stacks: 2,
          },
        },
      ],
    },
  ],
  artifacts: [{
    id: 'starlit_eye', name: '星瞳', rarity: 'Uncommon',
    trigger: { on: 'battle_start', effects: [{ apply_status: { id: '星屑刻印', stacks: 1, to: 'opponent' } }] },
  }],
  items: [{ id: 'pouch', name: '星尘袋囊', count: 1, effects: [{ heal: 8 }] }],
  player_abilities: [], player_status_effects: [], enemies: [],
  player_lust_effect: {
    name: '星核失控', effects: [
      { damage: { formula: 'opponent.max_hp * 0.2' } },
      { apply_status: { id: '星屑刻印', stacks: 8, to: 'opponent' } },
      { block: 15 },
    ],
  },
};

const normalized = normalizeMvuBattleContent(source);
const implicitOwnedQuantity = normalizeMvuBattleContent({
  cards: [{ id: 'single_copy', name: '单张牌', type: 'Skill', rarity: 'Common', cost: 1, effects: { block: 3 } }],
});
assert.equal(implicitOwnedQuantity.cards[0].quantity, 1, 'the runtime default for an owned card is persisted explicitly');
for (const emptyLustShell of [
  { name: '温存', effects: [] },
  { name: '温存', emoji: '💗', effects: {} },
]) {
  const normalizedEmptyLust = normalizeMvuBattleContent({ player_lust_effect: emptyLustShell });
  assert.equal('player_lust_effect' in normalizedEmptyLust, false, 'a strict empty optional lust shell is omitted');
}
for (const meaningfulLustShell of [
  { name: '温存', description: '欲望满溢时获得力量。', effects: [] },
  { name: '温存', effects: [], creates: [{ id: 'temptation' }] },
  { name: '温存', effects: [], when: 'self.hp > 0' },
  { name: '温存', effects: [], invented: true },
  { name: '温存', effects: { energy: 1 } },
]) {
  const normalizedMeaningfulLust = normalizeMvuBattleContent({ player_lust_effect: meaningfulLustShell });
  assert.equal(
    'player_lust_effect' in normalizedMeaningfulLust,
    true,
    'described, conditional, unknown, generated, or executable lust content must not be silently deleted',
  );
}
const repeatedOwnedDefinition = normalizeMvuBattleContent({
  cards: [
    { id: 'same_guard', name: '同一护盾', type: 'Skill', rarity: 'Common', cost: 1, quantity: 2, effects: { block: 3 } },
    { id: 'same_guard', name: '同一护盾', type: 'Skill', rarity: 'Common', cost: 1, effects: { block: 3 } },
  ],
});
assert.equal(repeatedOwnedDefinition.cards.length, 1, 'identical owned-card definitions collapse to one technical definition');
assert.equal(repeatedOwnedDefinition.cards[0].quantity, 3, 'collapsing exact duplicates preserves the authored deck multiset');
for (const invalidQuantity of [0, -1, 101]) {
  const invalidRepeatedDefinition = normalizeMvuBattleContent({
    cards: [
      { id: 'invalid_guard', name: '非法护盾', type: 'Skill', rarity: 'Common', cost: 1, quantity: invalidQuantity, effects: { block: 3 } },
      { id: 'invalid_guard', name: '非法护盾', type: 'Skill', rarity: 'Common', cost: 1, quantity: 2, effects: { block: 3 } },
    ],
  });
  assert.equal(
    invalidRepeatedDefinition.cards.length,
    2,
    `an invalid source quantity (${invalidQuantity}) cannot be hidden by duplicate folding`,
  );
}
const conflictingOwnedDefinition = normalizeMvuBattleContent({
  cards: [
    { id: 'same_guard', name: '同一护盾', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 3 } },
    { id: 'same_guard', name: '另一护盾', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 5 } },
  ],
});
assert.equal(conflictingOwnedDefinition.cards.length, 2, 'conflicting duplicate ids remain visible to strict validation');
const redundantTemplateQuantity = normalizeMvuPlayerAuthoredContent({
  id: 'template_owner', name: '模板持有者', type: 'Skill', rarity: 'Common', cost: 1,
  effects: { add_card: 'error_card', to: 'discard' },
  creates: [{ id: 'error_card', name: '报错', type: 'Curse', description: '无法打出。', quantity: 1 }],
});
assert.equal(
  Object.hasOwn(redundantTemplateQuantity.creates[0], 'quantity'),
  false,
  'a copied quantity:1 is removed only from an unowned creates template',
);
for (const templateQuantity of [2, 0, -1]) {
  const ambiguousTemplateQuantity = normalizeMvuPlayerAuthoredContent({
    id: 'template_owner', name: '模板持有者', type: 'Skill', rarity: 'Common', cost: 1,
    effects: { add_card: 'error_card', to: 'discard' },
    creates: [{ id: 'error_card', name: '报错', type: 'Curse', description: '无法打出。', quantity: templateQuantity }],
  });
  assert.equal(
    ambiguousTemplateQuantity.creates[0].quantity,
    templateQuantity,
    'template quantity other than one remains an explicit error',
  );
}
assert.match(normalized.statuses[0].id, /^status_[a-z0-9_]+$/);
assert.equal(normalized.statuses[0].name, '星屑刻印');
assert.equal(normalized.statuses[0].triggers.tick[0].damage, 'stacks');
assert.deepEqual(normalized.statuses[0].triggers.hold, { modify: 'damage_taken', add: 2 });
assert.equal(normalized.cards[2].effects[0].damage, `10 + opponent.status.${normalized.statuses[0].id}.stacks`);
assert.equal(normalized.cards[2].effects[0].when, `opponent.status.${normalized.statuses[0].id}.stacks >= 1`);
assert.deepEqual(normalized.cards[2].effects[1], { apply_status: normalized.statuses[0].id, stacks: 2 });
assert.deepEqual(normalized.artifacts[0].trigger.effects[0], {
  apply_status: normalized.statuses[0].id, stacks: 1, to: 'opponent',
});
assert.equal(normalized.player_lust_effect.effects[0].damage, 'opponent.max_hp * 0.2');
assert.equal(source.statuses[0].id, '星屑刻印', 'normalization must not mutate the caller snapshot');

const contract = validateContentPackContract(createContentPackFromMvuBattle(source), { requireExecutable: true });
assert.equal(contract.ok, true, contract.ok ? '' : JSON.stringify(contract.issues));

const nestedResourceTarget = normalizeMvuBattleContent({
  core: {
    resources: [{ id: 'stardust', name: 'Stardust', emoji: '*', current: 3, max: 3, refresh: 'reset' }],
  },
  statuses: [],
  cards: [],
  artifacts: [],
  items: [],
  player_abilities: [],
  player_status_effects: [],
  player_lust_effect: {
    name: 'Burst',
    effects: [{ set_resource: { id: 'stardust', value: 0, to: 'self' } }],
  },
});
assert.deepEqual(nestedResourceTarget.player_lust_effect.effects[0], {
  set_resource: { id: 'stardust', value: 0 },
  to: 'self',
});
const runtimeResourceAlias = normalizeMvuAuthoredContent({
  triggers: {
    skill_played: {
      gain_resource: { id: 'protocol', amount: 1, to: 'self' },
    },
  },
});
assert.deepEqual(runtimeResourceAlias.triggers.skill_played, {
  resource: { id: 'protocol', amount: 1 },
  to: 'self',
});
const runtimeResourceNamedAlias = normalizeMvuAuthoredContent({
  trigger: {
    on: 'deal_damage',
    effects: { gain_resource: { resource: 'star_chip', amount: 1 }, to: 'self' },
  },
});
assert.deepEqual(runtimeResourceNamedAlias.trigger, {
  on: 'deal_damage',
  effects: { resource: { id: 'star_chip', amount: 1 }, to: 'self' },
});
const misspelledTrigger = normalizeMvuAuthoredContent({
  trigger: { on: 'eal_damage', effects: { damage: 1 } },
});
assert.equal(misspelledTrigger.trigger.on, 'eal_damage', 'unknown trigger names remain invalid');

const redundantCardSourceCondition = normalizeMvuAuthoredContent({
  id: 'echo', name: '回响', emoji: 'E', type: 'buff',
  triggers: { attack_played: { damage: 3, when: "event.source_kind == 'card'" } },
});
assert.deepEqual(redundantCardSourceCondition.triggers.attack_played, { damage: 3 });

const statusPassiveAlias = normalizeMvuAuthoredContent({
  id: 'haste', name: '急速', emoji: 'H', type: 'buff',
  triggers: { passive: { card_rule: 'replay', limit: 1, extra: 1 } },
});
assert.equal('passive' in statusPassiveAlias.triggers, false);
assert.deepEqual(statusPassiveAlias.triggers.hold, { card_rule: 'replay', limit: 1, extra: 1 });
const rootStatusHold = normalizeMvuAuthoredContent({
  id: 'root_hold', name: '根持续规则', emoji: 'H', type: 'buff', stacks_change: -1,
  triggers: { attack_played: { draw: 1 } },
  hold: { modify: 'damage', add: 'stacks' },
});
assert.equal('hold' in rootStatusHold, false);
assert.deepEqual(rootStatusHold.triggers.hold, { modify: 'damage', add: 'stacks' });
assert.deepEqual(rootStatusHold.triggers.attack_played, { draw: 1 }, 'root hold placement preserves sibling triggers');
for (const conflictingHold of [
  {
    id: 'both_hold', name: '冲突持续规则', emoji: 'B', type: 'buff', triggers: { hold: { modify: 'block', add: 1 } },
    hold: { modify: 'damage', add: 1 },
  },
  {
    id: 'one_shot_hold', name: '错误根效果', emoji: 'D', type: 'buff', triggers: {}, hold: { damage: 3 },
  },
  {
    id: 'empty_hold', name: '空根效果', emoji: 'E', type: 'buff', triggers: {}, hold: {},
  },
]) {
  const normalizedHold = normalizeMvuAuthoredContent(conflictingHold);
  assert.equal('hold' in normalizedHold, true, 'ambiguous or invalid root hold remains visible to validation');
}
const redundantPowerTriggerShell = normalizeMvuAuthoredContent({
  id: 'loop', name: '回路', type: 'Power', rarity: 'Rare', cost: 1,
  effects: { apply_status: 'mirror_loop' },
  trigger: { on: 'passive', effects: {} },
});
assert.equal('trigger' in redundantPowerTriggerShell, false);
assert.deepEqual(redundantPowerTriggerShell.effects, { apply_status: 'mirror_loop' });

const emptyRewardStatusLibrary = normalizeMvuAuthoredContent({
  reward: { cards: [{ id: 'gift', name: '馈赠', effects: { draw: 1 } }], statuses: [] },
});
assert.equal('statuses' in emptyRewardStatusLibrary.reward, false);
const conflictingRuntimeResourceAlias = normalizeMvuAuthoredContent({
  effects: {
    gain_resource: { id: 'protocol', amount: 1, to: 'self', invented: true },
  },
});
assert.equal(
  conflictingRuntimeResourceAlias.effects.gain_resource.invented,
  true,
  'non-closed gain_resource shapes remain invalid instead of being guessed',
);
const conflictingRuntimeResourceIdAlias = normalizeMvuAuthoredContent({
  effects: { gain_resource: { id: 'protocol', resource: 'other', amount: 1 } },
});
assert.equal(
  conflictingRuntimeResourceIdAlias.effects.gain_resource.resource,
  'other',
  'conflicting resource identifier aliases remain invalid',
);
const recoverFromDrawAlias = normalizeMvuAuthoredContent({
  effects: { recover: 1, from: 'draw', pick: 'top', card_type: 'Skill' },
});
assert.deepEqual(recoverFromDrawAlias.effects, {
  move_card: 1, from: 'draw', pick: 'top', card_type: 'Skill', destination: 'hand',
});
const ambiguousRecoverFromDrawAlias = normalizeMvuAuthoredContent({
  effects: { recover: 1, from: 'draw', pick: 'all' },
});
assert.equal(
  ambiguousRecoverFromDrawAlias.effects.recover,
  1,
  'numeric recover plus pick all remains invalid instead of changing the requested count',
);
const conflictingRecoverFromDrawAlias = normalizeMvuAuthoredContent({
  effects: { recover: 1, from: 'draw', pick: 'top', to: 'self' },
});
assert.equal(
  conflictingRecoverFromDrawAlias.effects.recover,
  1,
  'recover with unsupported target metadata remains visible to validation',
);
const statusHoldSelfStacksAlias = normalizeMvuAuthoredContent({
  id: 'code_focus',
  triggers: { hold: { modify: 'damage', add: 'self.stacks * 2' } },
});
assert.equal(statusHoldSelfStacksAlias.triggers.hold.add, 'stacks * 2');
const nonHoldSelfStacks = normalizeMvuAuthoredContent({
  effects: { damage: 'self.stacks * 2' },
});
assert.equal(
  nonHoldSelfStacks.effects.damage,
  'self.stacks * 2',
  'self.stacks outside a status hold remains invalid instead of gaining a guessed owner',
);

const singularResourceEnvelope = normalizeMvuBattleContent({
  core: {
    resource: [{ id: 'mirror_code', name: 'Mirror code', emoji: '*', start: 0, max: 20, refresh: 'retain' }],
  },
  statuses: [], cards: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
});
assert.deepEqual(singularResourceEnvelope.core.resources, [
  { id: 'mirror_code', name: 'Mirror code', emoji: '*', start: 0, max: 20, refresh: 'retain' },
]);
assert.equal('resource' in singularResourceEnvelope.core, false);

const genericRuleEnvelope = normalizeMvuBattleContent({
  statuses: [],
  cards: [{
    id: 'rule_strike', name: '规则斩击', type: '攻击', rarity: '普通',
    effects: [
      { source: 'card', operation: 'deal_damage', target: 'enemy', value: 7, trigger: 'on_play' },
      { source: 'card', operation: 'gain_block', target: 'player', value: 4, trigger: 'immediate' },
    ],
  }],
});
assert.equal(genericRuleEnvelope.cards[0].type, 'Attack');
assert.equal(genericRuleEnvelope.cards[0].rarity, 'Common');
assert.deepEqual(genericRuleEnvelope.cards[0].effects, [
  { damage: 7, to: 'opponent' },
  { block: 4, to: 'self' },
]);

const misplacedCardExhaustFlag = normalizeMvuPlayerAuthoredContent({
  id: 'code_dash', name: 'Code dash', type: 'Skill', rarity: 'Uncommon', cost: 0,
  effects: [{ resource: { id: 'code', amount: 2 } }, { draw: 1 }, { exhaust: true }],
});
assert.equal(misplacedCardExhaustFlag.exhaust, true);
assert.deepEqual(misplacedCardExhaustFlag.effects, [
  { resource: { id: 'code', amount: 2 } },
  { draw: 1 },
]);
const realExhaustZoneOperation = normalizeMvuPlayerAuthoredContent({
  id: 'purge', name: 'Purge', type: 'Skill', rarity: 'Common', cost: 1,
  effects: [{ exhaust: 1, from: 'hand', pick: 'choose' }],
});
assert.equal(realExhaustZoneOperation.exhaust, undefined);
assert.deepEqual(realExhaustZoneOperation.effects, [{ exhaust: 1, from: 'hand', pick: 'choose' }]);

const redundantFirstOrdinal = normalizeMvuBattleContent({
  statuses: [],
  player_abilities: [{
    id: 'first_attack_energy',
    trigger: { on: 'attack_played', scope: 'turn', ordinal: 'first', n: 1, effects: { energy: 1 } },
  }],
});
assert.deepEqual(redundantFirstOrdinal.player_abilities[0].trigger, {
  on: 'attack_played', scope: 'turn', ordinal: 'first', effects: { energy: 1 },
});

const unconditionalWhen = normalizeMvuBattleContent({
  statuses: [],
  cards: [{
    id: 'always_ready', name: '恒真准备', type: 'Skill', rarity: 'Common',
    effects: [{ energy: 1, when: ' true ' }, { block: 2, when: true }],
  }],
});
assert.deepEqual(unconditionalWhen.cards[0].effects, [{ energy: 1 }, { block: 2 }]);

const generatedShapeVariants = normalizeMvuBattleContent({
  statuses: [{
    id: 'echo_window', name: '回响窗口', emoji: '↻', type: 'buff',
    triggers: {
      stacks_change: 'reset',
      hold: {
        card_rule: { replay: 'replay', limit: 1, extra: 1, card_type: 'Attack' },
      },
      skill_played: {
        when: 'self.hp < self.max_hp',
        effects: [{ heal: 1 }, { draw: 1, when: 'self.energy > 0' }],
      },
    },
  }],
  enemies: [{ status_effects: [{ id: 'echo_window', stacks: 0 }] }],
});
assert.equal(generatedShapeVariants.statuses[0].stacks_change, 'reset');
assert.deepEqual(generatedShapeVariants.statuses[0].triggers.hold, {
  card_rule: 'replay', limit: 1, extra: 1, card_type: 'Attack',
});
assert.deepEqual(generatedShapeVariants.statuses[0].triggers.skill_played, [
  { heal: 1, when: 'self.hp < self.max_hp' },
  { draw: 1, when: '(self.hp < self.max_hp) && (self.energy > 0)' },
]);
assert.deepEqual(generatedShapeVariants.enemies[0].status_effects, []);

const dynamicEnemyVariant = normalizeMvuAuthoredContent({
  effects: {
    spawn_enemy: { id: 'reinforcement', name: '增援', emoji: '+', actions: [] },
    count: 2,
    capacity: 4,
  },
});
assert.deepEqual(dynamicEnemyVariant.effects, {
  spawn_enemy: {
    id: 'reinforcement', name: '增援', emoji: '+', actions: [], count: 2, capacity: 4,
  },
});

const nestedScalarVariants = normalizeMvuAuthoredContent({
  effects: [
    { recover: { value: 'skills_played_this_turn', from: 'discard', pick: 'random' } },
    { damage: { amount: 4, hits: 2, to: 'opponent' } },
  ],
});
assert.deepEqual(nestedScalarVariants.effects, [
  { recover: 'skills_played_this_turn', from: 'discard', pick: 'random' },
  { damage: 4, hits: 2, to: 'opponent' },
]);
const ambiguousNestedScalar = normalizeMvuAuthoredContent({
  effects: { recover: { value: 1, amount: 2, from: 'discard' } },
});
assert.deepEqual(ambiguousNestedScalar.effects, {
  recover: { value: 1, amount: 2, from: 'discard' },
}, 'conflicting nested payload aliases must remain visible to validation');

const summonBlockAlias = normalizeMvuAuthoredContent({
  effects: [{
    block_summon: {
      selector: { owner: 'self', pick: 'all' },
      amount: 4,
    },
  }],
});
assert.deepEqual(summonBlockAlias.effects, [{
  modify_summon: {
    selector: { owner: 'self', pick: 'all' },
    stat: 'block',
    add: 4,
  },
}]);

const triggerLevelCondition = normalizeMvuAuthoredContent({
  id: 'conditional_ability',
  trigger: {
    on: 'turn_start',
    when: 'self.hp < self.max_hp / 2',
    effects: [{ block: 3 }, { energy: 1, when: 'self.energy == 0' }],
  },
});
assert.deepEqual(triggerLevelCondition.trigger, {
  on: 'turn_start',
  effects: [
    { block: 3, when: 'self.hp < self.max_hp / 2' },
    { energy: 1, when: '(self.hp < self.max_hp / 2) && (self.energy == 0)' },
  ],
});

const rewardWithInertStatus = normalizeMvuAuthoredContent({
  id: 'plain_reward', name: '普通奖励', type: 'Attack', rarity: 'Common', cost: 1,
  effects: { damage: 7 },
  statuses: [{ id: 'unused_status', name: '未使用状态', emoji: '?', type: 'debuff', triggers: {} }],
});
assert.equal('statuses' in rewardWithInertStatus, false, 'unreachable reward support definitions are inert and safely pruned');
const rewardWithStatusDependency = normalizeMvuAuthoredContent({
  id: 'status_reward', name: '状态奖励', type: 'Skill', rarity: 'Uncommon', cost: 1,
  effects: { apply_status: 'outer_status', stacks: 1 },
  statuses: [
    {
      id: 'outer_status', name: '外层状态', emoji: 'O', type: 'buff',
      triggers: { tick: { apply_status: 'inner_status', stacks: 1 } },
    },
    { id: 'inner_status', name: '内层状态', emoji: 'I', type: 'buff', triggers: {} },
    { id: 'unrelated_status', name: '无关状态', emoji: 'X', type: 'buff', triggers: {} },
  ],
});
assert.deepEqual(rewardWithStatusDependency.statuses.map(status => status.id), ['outer_status', 'inner_status']);

const enemyAllyTarget = normalizeMvuBattleContent({
  statuses: [],
  enemies: [
    {
      id: 'front_guard',
      actions: [{
        id: 'protect_ally', name: '保护同伴',
        effects: { block: 4, to: 'opponent', targets: { mode: 'by_id', id: 'rear_guard' } },
      }],
    },
    { id: 'rear_guard', actions: [] },
  ],
});
assert.equal(
  enemyAllyTarget.enemies[0].actions[0].effects.to,
  'opponent',
  'enemy target perspective must remain authored for validator-driven repair',
);

const redundantEnemyOpponentCollection = normalizeMvuBattleContent({
  statuses: [],
  enemies: [{
    id: 'hive_queen',
    actions: [],
    lust_effect: {
      name: '全巢爆破',
      effects: { damage: 4, to: 'opponent', targets: { mode: 'all' } },
    },
  }],
});
assert.deepEqual(redundantEnemyOpponentCollection.enemies[0].lust_effect.effects, {
  damage: 4,
  to: 'opponent',
  targets: { mode: 'all' },
});

const enemyNestedStatusLibrary = normalizeMvuBattleContent({
  statuses: [],
  enemies: [{
    id: 'status_sentry',
    statuses: [{
      id: 'vulnerable', name: '易伤', emoji: 'V', type: 'debuff',
      stacks_change: -1, triggers: { hold: { modify: 'damage_taken', multiply: 1.5 } },
    }],
    actions: [{ id: 'pulse', effects: { apply_status: 'vulnerable', stacks: 1 } }],
  }],
});
assert.equal('statuses' in enemyNestedStatusLibrary.enemies[0], false);
assert.equal(enemyNestedStatusLibrary.statuses[0].id, 'vulnerable');

const conflictingEnemyNestedStatusLibrary = normalizeMvuBattleContent({
  statuses: [{ id: 'mark', name: '标记A', emoji: 'A', type: 'debuff', triggers: {} }],
  enemies: [{
    id: 'status_sentry',
    statuses: [{ id: 'mark', name: '标记B', emoji: 'B', type: 'debuff', triggers: {} }],
    actions: [],
  }],
});
assert.equal(conflictingEnemyNestedStatusLibrary.enemies[0].statuses[0].name, '标记B');
assert.equal(conflictingEnemyNestedStatusLibrary.statuses[0].name, '标记A');

const verboseBooleanAliases = normalizeMvuAuthoredContent({
  effects: {
    damage: 3,
    when: 'self.has_summon == false && true != opponent.has_status && self.has_ally == true && self.alive == true',
  },
});
assert.equal(
  verboseBooleanAliases.effects.when,
  '!self.has_summon && !opponent.has_status && self.has_ally && self.alive',
);

const mixedPowerTiming = normalizeMvuAuthoredContent({
  id: 'sentinel_protocol', name: '哨卫协议', type: 'Power', rarity: 'Rare', cost: 1,
  effects: [
    { modify: 'summon_capacity', add: 1 },
    { spawn_summon: { id: 'sentinel', name: '哨卫', emoji: 'S', max_hp: 8, actions: [] } },
  ],
});
assert.deepEqual(mixedPowerTiming.effects, [
  { modify: 'summon_capacity', add: 1 },
  { spawn_summon: { id: 'sentinel', name: '哨卫', emoji: 'S', max_hp: 8, actions: [] } },
]);
assert.equal('trigger' in mixedPowerTiming, false, 'Power timing must remain authored for repair');

const duplicatedPowerTriggerWrapper = normalizeMvuAuthoredContent({
  id: 'focus_protocol', name: '专注协议', type: 'Power', rarity: 'Rare', cost: 1,
  effect: { trigger: { on: 'passive', effects: { modify: 'damage', add: 1 } } },
  effects: [{ trigger: { on: 'passive', effects: { modify: 'damage', add: 1 } } }],
});
assert.equal('effect' in duplicatedPowerTriggerWrapper, false);
assert.equal('effects' in duplicatedPowerTriggerWrapper, false);
assert.deepEqual(duplicatedPowerTriggerWrapper.trigger, {
  on: 'passive', effects: { modify: 'damage', add: 1 },
});

const normalizedDescriptionAlias = normalizeMvuAuthoredContent({
  id: 'weak', name: '虚弱', emoji: 'W', type: 'debuff', desc: '造成的伤害降低。', triggers: {},
});
assert.equal(normalizedDescriptionAlias.description, '造成的伤害降低。');
assert.equal('desc' in normalizedDescriptionAlias, false);

const combinedResourceEffect = normalizeMvuAuthoredContent({
  effects: {
    damage: 'self.status.mirror_weave.stacks > 0 ? 8 : 4',
    resource: { id: 'mirror', amount: 1 },
  },
});
assert.deepEqual(combinedResourceEffect.effects, {
  damage: 'self.status.mirror_weave.stacks > 0 ? 8 : 4',
  resource: { id: 'mirror', amount: 1 },
}, 'operation order must not be inferred from JSON property order');

const duplicateOwnedStatus = {
  id: 'mirror_weave_status', name: '镜像编织', emoji: 'M', type: 'buff',
  triggers: { hold: { card_rule: 'replay', limit: 1, extra: 1 } },
  stacks_change: -1,
};
const normalizedOwnedStatus = normalizeMvuBattleContent({
  core: {},
  statuses: [duplicateOwnedStatus],
  cards: [{
    id: 'mirror_weave', name: '镜像编织', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { apply_status: 'mirror_weave_status', stacks: 1 },
    statuses: [structuredClone(duplicateOwnedStatus)],
  }],
});
assert.equal('statuses' in normalizedOwnedStatus.cards[0], false);
assert.equal(normalizedOwnedStatus.statuses.length, 1);

const newlyAuthoredOwnedStatus = normalizeMvuBattleContent({
  core: {},
  statuses: [],
  cards: [{
    id: 'overclock', name: '过载', type: 'Power', rarity: 'Rare', cost: 1, quantity: 1,
    effects: { apply_status: 'overclock_status', stacks: 1 },
    statuses: [{
      id: 'overclock_status', name: '过载', emoji: 'F', type: 'buff', stacks_change: -1,
      triggers: { turn_end: { resource: { id: 'mirror_frag', amount: 2 } } },
    }],
  }],
});
assert.equal('statuses' in newlyAuthoredOwnedStatus.cards[0], false);
assert.equal(newlyAuthoredOwnedStatus.statuses[0].id, 'overclock_status');
assert.deepEqual(newlyAuthoredOwnedStatus.statuses[0].triggers.turn_end, {
  resource: { id: 'mirror_frag', amount: 2 },
});

const conflictingOwnedStatus = normalizeMvuBattleContent({
  core: {},
  statuses: [duplicateOwnedStatus],
  cards: [{
    id: 'mirror_weave', name: '镜像编织', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { apply_status: 'mirror_weave_status', stacks: 1 },
    statuses: [{ ...structuredClone(duplicateOwnedStatus), stacks_change: 'keep' }],
  }],
});
assert.equal(conflictingOwnedStatus.cards[0].statuses.length, 1, 'conflicting definitions remain visible to validation');

const orphanedSiblingTemplate = normalizeMvuBattleContent({
  core: {},
  statuses: [],
  cards: [
    {
      id: 'template_holder',
      effects: { block: 4 },
      creates: [{ id: 'code_fragment', name: '代码碎片', type: 'Attack', rarity: 'Common', cost: 0, effects: { damage: 2 } }],
    },
    {
      id: 'template_consumer',
      effects: { add_card: 'code_fragment', to: 'hand', count: 1 },
    },
  ],
});
assert.equal('creates' in orphanedSiblingTemplate.cards[0], false);
assert.equal(orphanedSiblingTemplate.cards[1].creates[0].id, 'code_fragment');

const sharedSiblingTemplate = normalizeMvuBattleContent({
  core: {},
  statuses: [],
  cards: [
    {
      id: 'template_holder',
      effects: { block: 4 },
      creates: [{ id: 'shared_fragment', name: '共享碎片', type: 'Skill', rarity: 'Common', cost: 0, effects: { draw: 1 } }],
    },
    { id: 'consumer_a', effects: { add_card: 'shared_fragment', to: 'hand' } },
    { id: 'consumer_b', effects: { add_card: 'shared_fragment', to: 'discard' } },
  ],
});
assert.equal(sharedSiblingTemplate.cards[0].creates[0].id, 'shared_fragment');
assert.equal('creates' in sharedSiblingTemplate.cards[1], false, 'ambiguous shared references remain visible to validation');
const unreachableTemplate = normalizeMvuBattleContent({
  statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
  cards: [{
    id: 'template_owner', name: '模板所有者', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { draw: 1 },
    creates: [{
      id: 'unused_fragment', name: '未用碎片', type: 'Event', rarity: 'Common', cost: 0,
      effects: {},
    }],
  }],
});
assert.equal('creates' in unreachableTemplate.cards[0], false, 'a globally unreachable stable template is inert and pruned');
const referencedTemplate = normalizeMvuBattleContent({
  statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
  cards: [{
    id: 'template_owner', name: '模板所有者', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { add_card: 'used_fragment', to: 'discard' },
    creates: [{ id: 'used_fragment', name: '已用碎片', type: 'Curse', rarity: 'Corrupt' }],
  }],
});
assert.equal(referencedTemplate.cards[0].creates[0].id, 'used_fragment');

const passiveStatusPower = normalizeMvuAuthoredContent({
  id: 'astro_shield', name: '星盾术', type: 'Power', rarity: 'Rare', cost: 2,
  trigger: {
    on: 'passive',
    effects: [{ apply_status: 'astral_shield', stacks: 10 }],
  },
});
assert.equal('effects' in passiveStatusPower, false);
assert.deepEqual(passiveStatusPower.trigger, {
  on: 'passive',
  effects: [{ apply_status: 'astral_shield', stacks: 10 }],
}, 'invalid Power timing must remain visible for bounded model repair');
const passiveStatusPowerValidation = validateAuthoredCard(passiveStatusPower, [{
  id: 'astral_shield', name: '星盾', emoji: 'S', type: 'buff',
  triggers: { hold: { modify: 'damage_taken', subtract: 1 } },
}]);
assert.equal(passiveStatusPowerValidation.ok, false, 'invalid Power timing must enter bounded repair');

const allCardFilterAliases = normalizeMvuAuthoredContent({
  effects: {
    card_rule: 'free',
    limit: 1,
    card_type: 'Card',
    name: '',
    racial: '',
  },
});
assert.deepEqual(allCardFilterAliases.effects, { card_rule: 'free', limit: 1 });

const neverExecutedPlaceholder = normalizeMvuAuthoredContent({
  effects: [
    { damage: 5 },
    { damage: 0, when: 'false' },
  ],
});
assert.deepEqual(neverExecutedPlaceholder.effects, [{ damage: 5 }]);

const numericBooleanTernary = normalizeMvuAuthoredContent({
  effects: [{ heal: 2, when: 'discard_pile_size == 0 ? 1 : 0' }],
});
assert.equal(numericBooleanTernary.effects[0].when, 'discard_pile_size == 0');
const invertedBooleanTernary = normalizeMvuAuthoredContent({
  effects: [{ block: 2, when: 'self.has_debuff ? false : true' }],
});
assert.equal(invertedBooleanTernary.effects[0].when, '!(self.has_debuff)');
const scalarValueEnvelope = normalizeMvuAuthoredContent({
  triggers: { hold: [{ modify: 'damage', add: { value: 'stacks' } }] },
});
assert.equal(scalarValueEnvelope.triggers.hold[0].add, 'stacks');
const legacyTargetAlias = normalizeMvuAuthoredContent({
  effects: [{ apply_status: { id: 'shadow_cloak', stacks: 3 }, target: 'self' }],
});
assert.deepEqual(legacyTargetAlias.effects[0], { apply_status: 'shadow_cloak', stacks: 3, to: 'self' });
const ambiguousTargetAlias = normalizeMvuAuthoredContent({ effects: [{ damage: 3, target: 'all' }] });
assert.equal(ambiguousTargetAlias.effects[0].target, 'all');
const playerPileFormulaPerspective = normalizeMvuPlayerAuthoredContent({
  effects: [
    { heal: 2, when: 'discard_pile_size == 0' },
    { damage: 'self.draw_pile_size + hand_size' },
  ],
  description: '保留文字里的 discard_pile_size 原样。',
});
assert.equal(playerPileFormulaPerspective.effects[0].when, 'self.discard_pile_size == 0');
assert.equal(playerPileFormulaPerspective.effects[1].damage, 'self.draw_pile_size + self.hand_size');
assert.match(playerPileFormulaPerspective.description, /discard_pile_size/);

const playerOpponentCollection = normalizeMvuPlayerAuthoredContent({
  effects: { damage: 6, targets: { mode: 'all' }, to: 'self' },
});
assert.deepEqual(playerOpponentCollection.effects, {
  damage: 6, targets: { mode: 'all' }, to: 'self',
}, 'contradictory player targets must not be silently reinterpreted');
const contradictoryTargetValidation = validateAuthoredCard({
  id: 'contradictory_target', name: '冲突目标', type: 'Attack', rarity: 'Common', cost: 1,
  effects: playerOpponentCollection.effects,
});
assert.equal(contradictoryTargetValidation.ok, false, 'contradictory targets must enter bounded repair');

const chineseTechnicalIds = normalizeMvuPlayerAuthoredContent({
  cards: [{
    id: '召唤信标', name: '召唤信标', type: 'Skill', rarity: 'Common', cost: 1,
    effects: {
      spawn_summon: {
        id: '星械信标', name: '星械信标', emoji: 'S', max_hp: 4,
        actions: [{ id: '信标射线', name: '信标射线', effects: { damage: 2 } }],
      },
    },
  }],
});
assert.match(chineseTechnicalIds.cards[0].id, /^content_[a-z0-9]+$/);
assert.equal(chineseTechnicalIds.cards[0].name, '召唤信标');
assert.match(chineseTechnicalIds.cards[0].effects.spawn_summon.id, /^content_[a-z0-9]+$/);
assert.match(chineseTechnicalIds.cards[0].effects.spawn_summon.actions[0].id, /^content_[a-z0-9]+$/);
const referencedChineseTechnicalId = normalizeMvuPlayerAuthoredContent({
  id: '临时生成器', name: '临时生成器', type: 'Skill', rarity: 'Common', cost: 1,
  creates: [{ id: '火花牌', name: '火花牌', type: 'Attack', rarity: 'Common', cost: 0, effects: { damage: 2 } }],
  effects: { add_card: '火花牌', count: 1, to: 'hand' },
});
assert.equal(
  referencedChineseTechnicalId.creates[0].id,
  '火花牌',
  'a referenced invalid id must remain visible for graph-aware validation and repair',
);

const rewardLevelStatuses = normalizeMvuPlayerAuthoredContent({
  reward: {
    cards: [
      {
        id: 'charged_card', name: '充能牌', type: 'Skill', rarity: 'Common', cost: 0,
        effects: { apply_status: 'charge_mark', stacks: 1, to: 'self' },
      },
      {
        id: 'barrier_card', name: '屏障牌', type: 'Skill', rarity: 'Common', cost: 1,
        effects: { apply_status: 'barrier_mark', stacks: 1, to: 'self' },
      },
    ],
    statuses: [
      {
        id: 'charge_mark', name: '充能', emoji: 'C', type: 'buff',
        triggers: { hold: { modify: 'summon_capacity', add: 1 } },
      },
      {
        id: 'barrier_mark', name: '屏障', emoji: 'B', type: 'buff',
        triggers: { hold: { modify: 'damage_taken', subtract: 'stacks' } },
      },
    ],
  },
});
assert.equal(rewardLevelStatuses.reward.statuses, undefined);
assert.deepEqual(rewardLevelStatuses.reward.cards[0].statuses.map(status => status.id), ['charge_mark']);
assert.deepEqual(rewardLevelStatuses.reward.cards[1].statuses.map(status => status.id), ['barrier_mark']);

const emptyWhen = normalizeMvuAuthoredContent({ effects: { damage: 8, when: '' } });
assert.deepEqual(emptyWhen.effects, { damage: 8, when: '' });

const ambiguousPassiveStatusPower = normalizeMvuAuthoredContent({
  id: 'conditional_shield', name: '条件星盾', type: 'Power', rarity: 'Rare', cost: 2,
  effects: { draw: 1 },
  trigger: { on: 'passive', effects: { apply_status: 'astral_shield', stacks: 3 } },
});
assert.deepEqual(ambiguousPassiveStatusPower, {
  id: 'conditional_shield', name: '条件星盾', type: 'Power', rarity: 'Rare', cost: 2,
  effects: { draw: 1 },
  trigger: { on: 'passive', effects: { apply_status: 'astral_shield', stacks: 3 } },
});

const triggerNestedCreates = normalizeMvuAuthoredContent({
  id: 'token_ability', name: '生成能力',
  trigger: {
    on: 'battle_start',
    effects: { add_card: { id: 'spark_token', count: 1 } },
    creates: [{ id: 'spark_token', name: '火花', type: 'Attack', rarity: 'Common', cost: 0, effects: { damage: 2 } }],
  },
});
assert.deepEqual(triggerNestedCreates.trigger, {
  on: 'battle_start', effects: { add_card: 'spark_token', count: 1 },
});
assert.equal(triggerNestedCreates.creates[0].id, 'spark_token');

const summonOwnerTarget = normalizeMvuAuthoredContent({
  effects: { block: 4, to: 'self', targets: { mode: 'all', owner: 'self' } },
});
assert.deepEqual(summonOwnerTarget.effects, {
  block: 4, to: 'self', targets: { mode: 'all', owner: 'self' },
}, 'combat targets must not be reinterpreted as summon operations');
const summonOwnerTargetValidation = validateAuthoredCard({
  id: 'ambiguous_summon_target', name: '含混援护', type: 'Skill', rarity: 'Common', cost: 1,
  effects: summonOwnerTarget.effects,
});
assert.equal(summonOwnerTargetValidation.ok, false, 'ambiguous summon targets must enter bounded repair');

const summonSelfTarget = normalizeMvuAuthoredContent({
  effects: {
    spawn_summon: {
      id: 'guard', name: '护卫', emoji: 'G', max_hp: 8,
      actions: [{ id: 'brace', name: '架势', effects: { block: 2, to: 'self', targets: { mode: 'active' } } }],
    },
  },
});
assert.deepEqual(summonSelfTarget.effects.spawn_summon.actions[0].effects, {
  block: 2, to: 'self', targets: { mode: 'active' },
});

const unboundSummonStacksCondition = normalizeMvuAuthoredContent({
  effects: {
    spawn_summon: {
      id: 'mote', name: '微粒', emoji: 'M', max_hp: 3,
      actions: [{
        id: 'peck', name: '撞击',
        effects: { damage: 2, when: 'stacks >= 1' },
      }],
    },
  },
});
assert.deepEqual(
  unboundSummonStacksCondition.effects.spawn_summon.actions[0].effects,
  { damage: 2, when: 'stacks >= 1' },
  'an unbound condition must remain invalid instead of becoming unconditional',
);
const unboundSummonValidation = validateAuthoredCard({
  id: 'unbound_summon', name: '无绑定召唤', type: 'Skill', rarity: 'Common', cost: 1,
  effects: unboundSummonStacksCondition.effects,
});
assert.equal(unboundSummonValidation.ok, false, 'unbound summon conditions must enter bounded repair');
const qualifiedSummonStacksCondition = normalizeMvuAuthoredContent({
  effects: {
    spawn_summon: {
      id: 'mote', name: '微粒', emoji: 'M', max_hp: 3,
      actions: [{
        id: 'peck', name: '撞击',
        effects: { damage: 2, when: 'self.status.charge.stacks >= 1' },
      }],
    },
  },
});
assert.equal(
  qualifiedSummonStacksCondition.effects.spawn_summon.actions[0].effects.when,
  'self.status.charge.stacks >= 1',
);

const programOwnedSummonFields = normalizeMvuAuthoredContent({
  effects: {
    spawn_summon: {
      id: 'familiar', name: '使魔', emoji: 'F', max_hp: 12,
      hp: 12, power: 3,
      trigger: { on: 'turn_start', effects: { damage: 3 } },
      actions: [{ id: 'claw', name: '爪击', effects: { damage: 3 } }],
    },
  },
});
assert.deepEqual(programOwnedSummonFields.effects.spawn_summon, {
  id: 'familiar', name: '使魔', emoji: 'F', max_hp: 12,
  hp: 12, power: 3,
  trigger: { on: 'turn_start', effects: { damage: 3 } },
  actions: [{ id: 'claw', name: '爪击', effects: { damage: 3 } }],
}, 'unsupported summon fields must remain visible for bounded repair');
const programOwnedSummonFieldsValidation = validateAuthoredCard({
  id: 'invalid_familiar', name: '非法使魔', type: 'Skill', rarity: 'Common', cost: 1,
  effects: programOwnedSummonFields.effects,
});
assert.equal(programOwnedSummonFieldsValidation.ok, false, 'illegal summon fields must enter bounded repair');

const redundantSummonModifierScope = normalizeMvuAuthoredContent({
  effects: {
    modify_summon_effect: {
      selector: { owner: 'self', pick: 'all' },
      stat: 'damage', add: 2, scope: 'combat',
    },
  },
});
assert.deepEqual(redundantSummonModifierScope.effects.modify_summon_effect, {
  selector: { owner: 'self', pick: 'all' }, stat: 'damage', add: 2,
});

const nestedSummonConditions = normalizeMvuAuthoredContent({
  effects: [
    {
      modify_summon: {
        selector: { owner: 'self', pick: 'all' }, stat: 'block', add: 2,
        when: 'self.has_summon',
      },
    },
    {
      heal_summon: {
        selector: { owner: 'self', pick: 'all', when: 'self.has_summon' }, amount: 3,
      },
    },
  ],
});
assert.deepEqual(nestedSummonConditions.effects, [
  {
    modify_summon: { selector: { owner: 'self', pick: 'all' }, stat: 'block', add: 2 },
    when: 'self.has_summon',
  },
  {
    heal_summon: { selector: { owner: 'self', pick: 'all' }, amount: 3 },
    when: 'self.has_summon',
  },
]);

const unambiguousEffectAliases = normalizeMvuAuthoredContent({
  effects: [
    { damage: 4, hit: 2 },
    { add_status: { id: 'charged', stacks: 2, to: 'self' } },
    {
      spawn_summon: {
        id: 'scout', name: '斥候', emoji: 'S',
        abilities: [{ id: 'owner_attack', trigger: { on: 'owner_attack_played', effects: { block: 2 } } }],
      },
    },
  ],
});
assert.deepEqual(unambiguousEffectAliases.effects[0], { damage: 4, hits: 2 });
assert.deepEqual(unambiguousEffectAliases.effects[1], { apply_status: 'charged', stacks: 2, to: 'self' });
assert.equal(unambiguousEffectAliases.effects[2].spawn_summon.abilities[0].trigger.on, 'attack_played');

const combinedSummonModifiers = normalizeMvuAuthoredContent({
  effects: [{
    when: 'self.summon_count > 0',
    modify_summon: {
      selector: { owner: 'self', pick: 'all' }, stat: 'max_hp', add: 2,
    },
    modify_summon_effect: {
      selector: { owner: 'self', pick: 'all' }, stat: 'damage', add: 1,
    },
  }],
});
assert.deepEqual(combinedSummonModifiers.effects, [{
  when: 'self.summon_count > 0',
  modify_summon: {
    selector: { owner: 'self', pick: 'all' }, stat: 'max_hp', add: 2,
  },
  modify_summon_effect: {
    selector: { owner: 'self', pick: 'all' }, stat: 'damage', add: 1,
  },
}], 'combined operations must remain invalid for explicit model repair');

const summonActionOwnerTarget = normalizeMvuAuthoredContent({
  effects: {
    spawn_summon: {
      id: 'support', name: '支援机', emoji: 'S', max_hp: 8,
      actions: [{
        id: 'guard_owner', name: '援护',
        effects: { block: 2, to: 'self', targets: { mode: 'owner' } },
      }],
    },
  },
});
assert.deepEqual(summonActionOwnerTarget.effects.spawn_summon.actions[0].effects, {
  block: 2, to: 'self', targets: { mode: 'owner' },
});

const currentCardExhaustMarker = normalizeMvuAuthoredContent({
  id: 'pulse', name: '超频脉冲', type: 'Attack', rarity: 'Common', cost: 0,
  effects: [
    { damage: 2 },
    { exhaust: 1, from: 'hand', pick: 'all', name: '超频脉冲' },
  ],
});
assert.equal(currentCardExhaustMarker.exhaust, true);
assert.deepEqual(currentCardExhaustMarker.effects, { damage: 2 });

const numericSummonSlot = normalizeMvuAuthoredContent({
  effects: {
    spawn_summon: {
      id: 'terminal', name: '终端', emoji: 'T', max_hp: 8, slot: 0,
      actions: [{ id: 'pulse', name: '脉冲', effects: { damage: 3 } }],
    },
  },
});
assert.equal(numericSummonSlot.effects.spawn_summon.slot, 'slot_0');

const combinedSummonEffect = normalizeMvuAuthoredContent({
  id: 'summon_core',
  name: '召唤星核',
  type: 'Skill',
  effects: {
    spawn_summon: {
      id: 'star_core',
      name: '星核',
      max_hp: 2,
      actions: [{ id: 'glow', name: '闪耀', effects: { damage: 2 } }],
    },
    energy: 1,
  },
});
assert.deepEqual(combinedSummonEffect.effects, {
  spawn_summon: {
    id: 'star_core',
    name: '星核',
    max_hp: 2,
    actions: [{ id: 'glow', name: '闪耀', effects: { damage: 2 } }],
  },
  energy: 1,
}, 'combined operations must not be ordered from object key order');

const ambiguousCombinedSummonEffect = normalizeMvuAuthoredContent({
  id: 'summon_core',
  name: '召唤星核',
  type: 'Skill',
  effects: {
    spawn_summon: { id: 'star_core', name: '星核', max_hp: 2, actions: [] },
    energy: 1,
    when: 'self.energy < self.max_energy',
  },
});
assert.deepEqual(ambiguousCombinedSummonEffect.effects, {
  spawn_summon: { id: 'star_core', name: '星核', max_hp: 2, actions: [] },
  energy: 1,
  when: 'self.energy < self.max_energy',
});

const summonActionEnvelope = normalizeMvuAuthoredContent({
  effects: [
    {
      action: 'modify_summon',
      selector: { owner: 'self', pick: 'all' },
      stat: 'block',
      add: 5,
    },
    {
      action: 'activate_summon',
      selector: { owner: 'self', pick: 'all' },
    },
  ],
});
assert.deepEqual(summonActionEnvelope.effects, [
  {
    modify_summon: {
      selector: { owner: 'self', pick: 'all' },
      stat: 'block',
      add: 5,
    },
  },
  { activate_summon: { selector: { owner: 'self', pick: 'all' } } },
]);

const ambiguousSummonActionEnvelope = normalizeMvuAuthoredContent({
  effects: {
    action: 'activate_summon',
    selector: { owner: 'self', pick: 'all' },
    unsupported: true,
  },
});
assert.deepEqual(ambiguousSummonActionEnvelope.effects, {
  action: 'activate_summon',
  selector: { owner: 'self', pick: 'all' },
  unsupported: true,
});

const emptyOptionalDiscardEffects = normalizeMvuAuthoredContent({
  id: 'plain_skill',
  name: '普通技能',
  type: 'Skill',
  rarity: 'Common',
  cost: 1,
  effects: { block: 5 },
  discard_effects: [],
});
assert.equal('discard_effects' in emptyOptionalDiscardEffects, false);
const nullOptionalDiscardEffects = normalizeMvuAuthoredContent({
  id: 'plain_attack',
  name: '普通攻击',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  effects: { damage: 5 },
  discard_effects: null,
});
assert.equal('discard_effects' in nullOptionalDiscardEffects, false);

const nestedStatusDecay = normalizeMvuAuthoredContent({
  id: 'vulnerable',
  name: '脆弱',
  emoji: 'V',
  type: 'debuff',
  triggers: {
    hold: { modify: 'damage_taken', multiply: 1.5 },
    apply: { stacks_change: -1 },
  },
});
assert.equal(nestedStatusDecay.stacks_change, -1);
assert.equal('apply' in nestedStatusDecay.triggers, false);
assert.deepEqual(nestedStatusDecay.triggers.hold, { modify: 'damage_taken', multiply: 1.5 });

const exactHpLossAlias = normalizeMvuAuthoredContent({
  id: 'compact_charge',
  name: '紧凑充能',
  type: 'Skill',
  rarity: 'Common',
  cost: 1,
  description: '获得 2 点能量，但失去 2 点生命。',
  effects: [{ energy: 2, to: 'self' }, { hp: -2, to: 'self' }],
});
assert.deepEqual(exactHpLossAlias.effects[1], {
  hp: -2,
  to: 'self',
}, 'unsupported relative hp must remain authored for validator-driven repair');
const ambiguousPositiveHp = normalizeMvuAuthoredContent({ effects: { hp: 2, to: 'self' } });
assert.deepEqual(ambiguousPositiveHp.effects, { hp: 2, to: 'self' });

const exactPercentModifier = normalizeMvuAuthoredContent({
  triggers: { hold: { modify: 'damage_taken', add: '50%' } },
});
assert.deepEqual(exactPercentModifier.triggers.hold, {
  modify: 'damage_taken',
  multiply: 1.5,
});

const misplacedStatusCardRule = normalizeMvuAuthoredContent({
  id: 'combat_algorithm_status',
  name: '战斗算法',
  emoji: '💢',
  type: 'buff',
  stacks_change: 'reset',
  triggers: {
    card_played: [{
      card_rule: 'replay',
      limit: 1,
      extra: 1,
      when: 'self.status.combat_algorithm_status.stacks > 0 && cards_played_this_turn == 1',
    }],
  },
});
assert.deepEqual(misplacedStatusCardRule.triggers, {
  card_played: [{
    card_rule: 'replay',
    limit: 1,
    extra: 1,
    when: 'self.status.combat_algorithm_status.stacks > 0 && cards_played_this_turn == 1',
  }],
}, 'event timing must not be rewritten into a passive hold rule');

const summonDamageStat = normalizeMvuAuthoredContent({
  effects: {
    modify_summon: {
      selector: { template_id: 'mechanical_planet', pick: 'all' },
      stat: 'damage',
      add: 2,
    },
  },
});
assert.deepEqual(summonDamageStat.effects, {
  modify_summon_effect: {
    selector: { template_id: 'mechanical_planet', pick: 'all' },
    stat: 'damage',
    add: 2,
  },
});

const redundantNullEnemy = normalizeMvuBattleContent({
  enemy: null,
  enemies: [{ id: 'drone', name: '工蜂' }],
  statuses: [],
});
assert.equal('enemy' in redundantNullEnemy, false);
assert.equal(redundantNullEnemy.enemies[0].id, 'drone');

const emptyOptionalHooks = normalizeMvuBattleContent({
  core: {
    stance: {
      id: 'compile', name: '编译中', enter: [], exit: {},
      passive: { card_rule: 'replay', limit: 1, extra: 1, card_type: 'Skill' },
    },
    orbs: [{ id: 'mirror', name: '镜像', value: 3, passive: [], evoke: {} }],
  },
  cards: [{
    id: 'empty_card', name: '仍须修复的牌', type: 'Skill', rarity: 'Common', quantity: 1,
    effects: [],
  }],
  statuses: [],
});
assert.equal('enter' in emptyOptionalHooks.core.stance, false);
assert.equal('exit' in emptyOptionalHooks.core.stance, false);
assert.deepEqual(emptyOptionalHooks.core.stance.passive, {
  card_rule: 'replay', limit: 1, extra: 1, card_type: 'Skill',
});
assert.equal('passive' in emptyOptionalHooks.core.orbs[0], false);
assert.equal('evoke' in emptyOptionalHooks.core.orbs[0], false);
assert.deepEqual(
  emptyOptionalHooks.cards[0].effects,
  [],
  'required card effects must remain visible to authoritative validation',
);

const wrappedStance = { effects: { stance: {
  id: 'keen', name: '啸压档', passive: {
    on: 'passive', effects: [{ modify: 'damage', add: 2 }, { modify: 'block', add: -2 }],
  },
} } };
const wrappedStanceBefore = structuredClone(wrappedStance);
const cleanStance = normalizeMvuAuthoredContent(wrappedStance);
assert.deepEqual(cleanStance.effects.stance.passive, wrappedStance.effects.stance.passive.effects);
assert.deepEqual(wrappedStance, wrappedStanceBefore, 'normalization must not mutate input');
assert.deepEqual(normalizeMvuAuthoredContent(cleanStance), cleanStance, 'normalization is idempotent');
for (const passive of [
  { on: 'turn_start', effects: [{ modify: 'damage', add: 2 }] },
  { on: 'passive', effects: [{ modify: 'damage', add: 2 }], when: 'self.hp < 10' },
  { on: 'passive', effects: [{ modify: 'damage', add: 2 }], unknown: 1 },
  { on: 'passive', effects: [{ damage: 2 }] },
  { on: 'passive', effects: [] },
  { on: 'passive' },
]) {
  const input = { effects: { stance: { id: 'guarded', name: '保留错误', passive } } };
  assert.deepEqual(normalizeMvuAuthoredContent(input).effects.stance.passive, passive,
    'ambiguous, active or empty envelopes remain visible to validation');
}
assert.deepEqual(normalizeMvuAuthoredContent({ passive: wrappedStance.effects.stance.passive }),
  { passive: wrappedStance.effects.stance.passive }, 'do not unwrap outside stance context');

const nestedStatusEvent = { triggers: { gain_buff: [
  { effects: [{ resource: { id: 'insight', amount: 1 }, when: 'event_status_is("inspiration_spark")' }] },
  { block: 2 },
] } };
const nestedStatusBefore = structuredClone(nestedStatusEvent);
assert.deepEqual(normalizeMvuAuthoredContent(nestedStatusEvent).triggers.gain_buff, [
  { resource: { id: 'insight', amount: 1 }, when: 'event_status_is("inspiration_spark")' }, { block: 2 },
]);
assert.deepEqual(nestedStatusEvent, nestedStatusBefore);
for (const entries of [[[], { block: 2 }], [[{ unknown: 2 }]], [[[{ block: 2 }]]]]) {
  assert.deepEqual(normalizeMvuAuthoredContent({ triggers: { gain_buff: entries } }).triggers.gain_buff, entries);
}
assert.deepEqual(normalizeMvuAuthoredContent({ triggers: { unknown_event: [[{ block: 2 }]] } }),
  { triggers: { unknown_event: [[{ block: 2 }]] } });
const singletonSelector = { recover: 2, from: 'discard', pick: 'choose', template_id: ['broken_page'] };
assert.deepEqual(normalizeMvuAuthoredContent(singletonSelector), { ...singletonSelector, template_id: 'broken_page' });
assert.deepEqual(singletonSelector.template_id, ['broken_page']);
for (const ids of [[], ['a', 'b'], [''], [2]]) {
  const input = { ...singletonSelector, template_id: ids };
  assert.deepEqual(normalizeMvuAuthoredContent(input), input);
}
assert.deepEqual(normalizeMvuAuthoredContent({ template_id: ['broken_page'] }), { template_id: ['broken_page'] });

console.log('MVU battle normalization canonicalizes ids, formula wrappers, generic rule envelopes, and aliases.');
