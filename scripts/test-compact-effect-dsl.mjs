import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const {
  COMPACT_EFFECT_BUNDLE_OPERATIONS,
  compileCompactEffectList,
  executeEffectProgram,
  transformCardEffectProgram,
} = require(
  resolve('src/game-core/index.ts'),
);

const compactSchema = JSON.parse(await readFile(resolve('schemas/mwg-card-effects-v1.schema.json'), 'utf8'));
const validateCompactSchema = new Ajv2020({ strict: false, allErrors: true }).compile(compactSchema);
const schemaHistoryEffect = {
  effects: {
    damage: {
      history: {
        metric: 'last_damage', scope: 'combat', event: 'damage_resolved', phase: 'resolve',
        source_kind: 'card', damage_type: 'attack', actor_id: 'player', target_id: 'enemy_alpha',
      },
    },
  },
};
assert.equal(validateCompactSchema(schemaHistoryEffect), true, JSON.stringify(validateCompactSchema.errors));
const schemaFilteredTrigger = {
  trigger: {
    on: 'deal_damage', effects: { block: 1 }, scope: 'combat', ordinal: 'every_n', n: 2,
    event: 'damage_resolved', phase: 'resolve', source_kind: 'card', damage_type: 'attack',
  },
};
assert.equal(validateCompactSchema(schemaFilteredTrigger), true, JSON.stringify(validateCompactSchema.errors));
const spawnedEnemyInput = {
  effects: {
    spawn_enemy: {
      id: 'split_form', name: '分裂体', emoji: '🧩', max_hp: 9, count: 2, capacity: 6,
      actions: [{ name: '扑击', weight: 1, effects: { damage: 2 } }],
      abilities: [
        { id: 'first_guard', name: '初次防护', trigger: { on: 'take_damage', ordinal: 'first', scope: 'turn', effects: { block: 3 } } },
        { id: 'last_echo', name: '消亡回响', trigger: 'defeated', effects: { lust: 2 } },
      ],
      status_effects: [],
      lust_effect: { name: '失控', effects: { damage: 1 } },
      action_mode: 'random', action_config: {},
    },
  },
};
assert.equal(validateCompactSchema(spawnedEnemyInput), true, JSON.stringify(validateCompactSchema.errors));
const spawnedEnemy = compileCompactEffectList(spawnedEnemyInput.effects);
assert.equal(spawnedEnemy.ok, true, JSON.stringify(spawnedEnemy.issues));
assert.equal(spawnedEnemy.value.steps[0].op, 'spawn_enemy');
assert.equal(spawnedEnemy.value.steps[0].count, 2);
assert.equal(spawnedEnemy.value.steps[0].enemy.abilities.length, 2);
assert.equal(executeEffectProgram(spawnedEnemy.value, {
  self: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
  opponent: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
  currentTurn: 1, cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0,
}, { spentEnergy: 0 }).events[0].type, 'spawn_enemy');
assert.equal(compileCompactEffectList({
  spawn_enemy: { ...spawnedEnemyInput.effects.spawn_enemy, actions: [] },
}).ok, false, 'spawned independent enemies must remain actionable');
for (const invalidCompact of [
  { trigger: { on: 'deal_damage', effects: { block: 1 }, ordinal: 'first', n: 1 } },
  { trigger: { on: 'deal_damage', effects: { block: 1 }, ordinal: 'nth' } },
  { trigger: { on: 'deal_damage', effects: { block: 1 }, unknown_filter: 'x' } },
  { effects: { damage: { history: { metric: 'count', ordinal: 'first' } } } },
  { effects: { damage: { history: { metric: 'last_damage', damage_type: 'untyped' } } } },
]) {
  assert.equal(validateCompactSchema(invalidCompact), false, 'compact schema must reject malformed event history/query input');
}

const compact = [
  { damage: 'spent_energy * 4' },
  { block: 1, when: 'spent_energy == 0' },
  { block: 'spent_energy', when: 'spent_energy > 0' },
];
const compiled = compileCompactEffectList(compact);
assert.equal(compiled.ok, true);
assert.equal(compiled.value.spec, 'mwg.effect/v1');
assert.equal(Object.hasOwn(compact, 'spec'), false);

const repeatedPresentation = compileCompactEffectList([
  { damage: 6, description: '模型重复写进效果项的说明文字。', emoji: '✨' },
  { block: 4, description: '展示文本不参与战斗结算。' },
]);
assert.equal(repeatedPresentation.ok, true, JSON.stringify(repeatedPresentation.issues));
assert.deepEqual(repeatedPresentation.value.steps, [
  { op: 'damage', target: 'opponent', amount: 6 },
  { op: 'gain_block', target: 'self', amount: 4 },
]);

const state = {
  self: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  opponent: { hp: 30, maxHp: 30, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
  currentTurn: 3,
  cardsPlayedThisTurn: 1,
  attacksPlayedThisTurn: 1,
  skillsPlayedThisTurn: 0,
};

const paid = executeEffectProgram(compiled.value, state, { spentEnergy: 3 });
assert.equal(paid.ok, true);
assert.equal(paid.state.opponent.hp, 18);
assert.equal(paid.state.self.block, 3);

const free = executeEffectProgram(compiled.value, state, { spentEnergy: 0 });
assert.equal(free.ok, true);
assert.equal(free.state.opponent.hp, 30);
assert.equal(free.state.self.block, 1);

const ternary = compileCompactEffectList([{ block: 'spent_energy == 0 ? 1 : spent_energy' }]);
assert.equal(ternary.ok, true);
assert.equal(executeEffectProgram(ternary.value, state, { spentEnergy: 0 }).state.self.block, 1);
assert.equal(executeEffectProgram(ternary.value, state, { spentEnergy: 2 }).state.self.block, 2);

const targetOverride = compileCompactEffectList([
  { damage: 2, to: 'self' },
  { heal: 1, to: 'opponent' },
]);
assert.equal(targetOverride.ok, true);
const overridden = executeEffectProgram(targetOverride.value, state, { spentEnergy: 0 });
assert.equal(overridden.ok, true);
assert.equal(overridden.state.self.hp, 18);
assert.equal(overridden.state.opponent.hp, 30);

const combinedCondition = compileCompactEffectList([{ heal: 2, when: '(self.hp < self.max_hp) && opponent.hp > 0' }]);
assert.equal(combinedCondition.ok, true);

const singletonObject = compileCompactEffectList({ damage: 4 });
assert.equal(singletonObject.ok, true, 'a single shallow effect does not need an array wrapper');
assert.deepEqual(singletonObject.value.steps, [{ op: 'damage', target: 'opponent', amount: 4 }]);
const invalidSingletonObject = compileCompactEffectList({ damage: 'unknown * 2' });
assert.equal(invalidSingletonObject.ok, false);
assert.equal(invalidSingletonObject.issues[0].path, '$.damage.left');

const bundled = compileCompactEffectList({
  block: 5,
  damage: 7,
  apply_status: 'bleed',
  stacks: 2,
});
assert.equal(bundled.ok, true);
assert.deepEqual(
  bundled.value.steps.map(step => step.op),
  ['damage', 'gain_block', 'apply_status'],
  'bundles expand in one shared canonical order instead of relying on JSON member order',
);
const bundledResult = executeEffectProgram(bundled.value, state, { spentEnergy: 0 });
assert.equal(bundledResult.state.opponent.hp, 23);
assert.equal(bundledResult.state.self.block, 5);
assert.equal(bundledResult.state.opponent.statusStacks.bleed, 2);

const multiHit = compileCompactEffectList({ damage: 3, hits: 3 });
assert.equal(multiHit.ok, true);
assert.deepEqual(
  multiHit.value.steps,
  Array.from({ length: 3 }, () => ({ op: 'damage', target: 'opponent', amount: 3 })),
  'hits lowers to repeated ordinary damage nodes instead of a new host-specific operation',
);

const typedDamage = compileCompactEffectList({
  damage: 8,
  damage_type: 'hp_loss',
  lifesteal: '0.5',
  targets: { mode: 'all' },
});
assert.equal(typedDamage.ok, true, JSON.stringify(typedDamage.issues));
assert.deepEqual(typedDamage.value.steps, [{
  op: 'damage',
  target: 'opponent',
  targetSelector: { mode: 'all' },
  amount: 8,
  damageKind: 'hp_loss',
  lifesteal: 0.5,
}]);

const compactExecute = compileCompactEffectList([
  { execute: 20, threshold_mode: 'hp_percent', exclude_tags: ['boss'], trigger_fatal: false },
  { kill: true, targets: { mode: 'lowest_hp' } },
]);
assert.equal(compactExecute.ok, true, JSON.stringify(compactExecute.issues));
assert.deepEqual(compactExecute.value.steps, [
  {
    op: 'execute', target: 'opponent', threshold: 20, thresholdMode: 'hp_percent',
    excludeTags: ['boss'], triggerFatal: false,
  },
  { op: 'kill', target: 'opponent', targetSelector: { mode: 'lowest_hp' } },
]);
const blockedState = structuredClone(state);
blockedState.opponent.block = 5;
const multiHitResult = executeEffectProgram(multiHit.value, blockedState, { spentEnergy: 0 });
assert.equal(multiHitResult.state.opponent.block, 0);
assert.equal(multiHitResult.state.opponent.hp, 26, 'each hit consumes block independently');
assert.equal(multiHitResult.events.filter(event => event.type === 'damage').length, 3);

const strengthenedMultiHit = transformCardEffectProgram(multiHit.value, {
  stat: 'damage',
  operator: 'add',
  value: 2,
});
assert.equal(strengthenedMultiHit.steps.length, 3, 'card value changes cannot add or remove hits');
assert.deepEqual(
  strengthenedMultiHit.steps.map(step => step.amount),
  [5, 5, 5],
  'damage changes apply to each existing hit without mutating hit count',
);

const dynamicDamage = compileCompactEffectList({ damage: 'self.block + 1' });
assert.equal(dynamicDamage.ok, true);
const reducedDynamicDamage = transformCardEffectProgram(dynamicDamage.value, {
  stat: 'damage',
  operator: 'subtract',
  value: 5,
});
const dynamicState = structuredClone(state);
dynamicState.self.block = 2;
assert.equal(
  executeEffectProgram(reducedDynamicDamage, dynamicState, { spentEnergy: 0 }).state.opponent.hp,
  30,
  'dynamic card values clamp at zero after subtraction',
);

const triggeredMultiHit = compileCompactEffectList({ damage: 2, hits: 3, on: 'take_damage' });
assert.equal(triggeredMultiHit.ok, true);
assert.equal(triggeredMultiHit.value.steps.length, 1);
assert.equal(triggeredMultiHit.value.steps[0].op, 'register_trigger');
assert.equal(triggeredMultiHit.value.steps[0].effects.length, 3, 'one trigger owns all repeated hits');

const conditionalMultiHit = compileCompactEffectList({ damage: 2, hits: 3, when: 'opponent.hp > 0' });
assert.equal(conditionalMultiHit.ok, true);
assert.equal(conditionalMultiHit.value.steps.length, 1);
assert.equal(conditionalMultiHit.value.steps[0].op, 'if');
assert.equal(conditionalMultiHit.value.steps[0].then.length, 3, 'one condition gates the complete repeated hit group');

const exhaustPileFormula = compileCompactEffectList({ block: 'self.exhaust_pile_size * 2' });
assert.equal(exhaustPileFormula.ok, true);
const pileState = structuredClone(state);
pileState.self.exhaustPileSize = 3;
assert.equal(executeEffectProgram(exhaustPileFormula.value, pileState, { spentEnergy: 0 }).state.self.block, 6);

const turnCountersFormula = compileCompactEffectList({
  damage: 'turn_number + attacks_played_this_turn * 2 + skills_played_this_turn',
});
assert.equal(turnCountersFormula.ok, true);
const counterState = { ...structuredClone(state), currentTurn: 4, attacksPlayedThisTurn: 2, skillsPlayedThisTurn: 1 };
assert.equal(executeEffectProgram(turnCountersFormula.value, counterState, { spentEnergy: 0 }).state.opponent.hp, 21);

const conditionalBundle = compileCompactEffectList({
  damage: 3,
  block: 2,
  when: 'self.hp < self.max_hp',
});
assert.equal(conditionalBundle.ok, true);
assert.equal(conditionalBundle.value.steps.length, 1);
assert.equal(conditionalBundle.value.steps[0].op, 'if', 'one shared condition wraps the whole bundle once');
assert.deepEqual(
  conditionalBundle.value.steps[0].then.map(step => step.op),
  ['damage', 'gain_block'],
);

const triggeredBundle = compileCompactEffectList({ damage: 2, draw: 1, on: 'take_damage' });
assert.equal(triggeredBundle.ok, true);
assert.equal(triggeredBundle.value.steps.length, 1);
assert.equal(triggeredBundle.value.steps[0].op, 'register_trigger');
assert.deepEqual(
  triggeredBundle.value.steps[0].effects.map(step => step.op),
  ['damage', 'draw_cards'],
);

const commonWithScry = compileCompactEffectList({ scry: 2, block: 4 });
assert.equal(commonWithScry.ok, true, JSON.stringify(commonWithScry.issues));
assert.deepEqual(
  commonWithScry.value.steps.map(step => step.op),
  ['gain_block', 'scry_cards'],
  'one auxiliary card-zone effect is split after the common bundle in a deterministic order',
);

const ambiguousCardZoneBundle = compileCompactEffectList({ scry: 2, discard: 1, block: 4 });
assert.equal(ambiguousCardZoneBundle.ok, false, 'multiple card-zone operations must remain explicit array entries');

const statusVariable = compileCompactEffectList([{ damage: 'opponent.status.bleed.stacks * 2' }]);
assert.equal(statusVariable.ok, true);
const statusState = structuredClone(state);
statusState.opponent.statusStacks = { bleed: 3 };
assert.equal(executeEffectProgram(statusVariable.value, statusState, { spentEnergy: 0 }).state.opponent.hp, 24);

const statusEffects = compileCompactEffectList([
  { apply_status: 'bleed', stacks: 2 },
  { apply_status: 'focus', stacks: 'self.status.focus.stacks + 1', to: 'self' },
  { remove_status: 'bleed' },
]);
assert.equal(statusEffects.ok, true);
const statusResult = executeEffectProgram(statusEffects.value, statusState, { spentEnergy: 0 });
assert.equal(statusResult.ok, true);
assert.equal(statusResult.state.opponent.statusStacks.bleed, undefined);
assert.equal(statusResult.state.self.statusStacks.focus, 1);
assert.deepEqual(
  statusResult.events.map(event => event.type),
  ['apply_status', 'apply_status', 'remove_status'],
);

const nestedStatusInput = compileCompactEffectList([
  { damage: 5, apply_status: { id: 'drenched', stacks: 2 } },
  { apply_status: { id: 'drenched', stacks: 3, to: 'opponent' } },
  { remove_status: { id: 'drenched', to: 'self' } },
]);
assert.equal(nestedStatusInput.ok, true, JSON.stringify(nestedStatusInput.issues));
assert.deepEqual(
  nestedStatusInput.value.steps.map(step => ({ op: step.op, target: step.target })),
  [
    { op: 'damage', target: 'opponent' },
    { op: 'apply_status', target: 'opponent' },
    { op: 'apply_status', target: 'opponent' },
    { op: 'remove_status', target: 'self' },
  ],
);
const conflictingNestedStatus = compileCompactEffectList({
  apply_status: { id: 'drenched', stacks: 2 },
  stacks: 3,
});
assert.equal(conflictingNestedStatus.ok, false, 'conflicting nested status fields must remain invalid');

const modifiers = compileCompactEffectList([
  { modify: 'damage', add: 2 },
  { modify: 'block', add: 'stacks * 3' },
  { modify: 'damage_taken', multiply: 0.8, to: 'opponent' },
]);
assert.equal(modifiers.ok, true);
const modifierResult = executeEffectProgram(modifiers.value, state, { spentEnergy: 0, statusStacks: 2 });
assert.deepEqual(modifierResult.events, [
  { type: 'modify', target: 'self', stat: 'damage', operator: 'add', value: 2 },
  { type: 'modify', target: 'self', stat: 'block', operator: 'add', value: 6 },
  { type: 'modify', target: 'opponent', stat: 'damage_taken', operator: 'multiply', value: 0.8 },
]);

const cardOperations = compileCompactEffectList([
  { seek: 1 },
  { draw: 2 },
  { scry: 3 },
  { discard: 1 },
  { exhaust: 'all', from: 'discard' },
  { recover: 1, from: 'discard', pick: 'choose' },
  { reduce_cost: 1, pick: 'choose', count: 2 },
  { copy: 2, from: 'draw', pick: 'random' },
  { double: 1, pick: 'choose' },
]);
assert.equal(cardOperations.ok, true);
assert.deepEqual(cardOperations.value.steps, [
  { op: 'recover_cards', source: 'draw', pick: 'choose', amount: 1 },
  { op: 'draw_cards', amount: 2 },
  { op: 'scry_cards', amount: 3 },
  { op: 'discard_cards', selector: { zone: 'hand', pick: 'random' }, amount: 1 },
  { op: 'exhaust_cards', selector: { zone: 'discard', pick: 'all' }, amount: 1 },
  { op: 'recover_cards', source: 'discard', pick: 'choose', amount: 1 },
  { op: 'reduce_card_cost', selector: { zone: 'hand', pick: 'choose', count: 2 }, amount: 1 },
  { op: 'copy_cards', selector: { zone: 'draw', pick: 'random', count: 2 } },
  { op: 'double_card_effect', selector: { zone: 'hand', pick: 'choose', count: 1 } },
]);
const cardOperationResult = executeEffectProgram(cardOperations.value, state, { spentEnergy: 0 });
assert.equal(cardOperationResult.ok, true);
assert.deepEqual(
  cardOperationResult.events.map(event => event.type),
  ['recover_cards', 'draw_cards', 'scry_cards', 'discard_cards', 'exhaust_cards', 'recover_cards', 'reduce_card_cost', 'copy_cards', 'double_card_effect'],
);

const redundantSelfTargets = compileCompactEffectList([
  { draw: 2, to: 'self' },
  { scry: 1, targets: ['self'] },
]);
assert.equal(redundantSelfTargets.ok, true, JSON.stringify(redundantSelfTargets.issues));
assert.deepEqual(redundantSelfTargets.value.steps, [
  { op: 'draw_cards', amount: 2 },
  { op: 'scry_cards', amount: 1 },
]);
assert.equal(
  compileCompactEffectList({ draw: 1, to: 'opponent' }).ok,
  false,
  'a non-self target on an intrinsically self-side card-flow operation remains invalid',
);

const cardValueOperations = compileCompactEffectList([
  { modify_card: 'damage', add: 2, from: 'hand', pick: 'random', count: 2 },
  { modify_card: 'block', multiply: 1.5, pick: 'left' },
  { modify_card: 'lust', subtract: 1, pick: 'right' },
  { modify_card: 'stacks', divide: 2, from: 'all', pick: 'all' },
]);
assert.equal(cardValueOperations.ok, true, JSON.stringify(cardValueOperations.issues));
assert.deepEqual(
  cardValueOperations.value.steps.map(step => ({
    op: step.op,
    selector: step.selector,
    stat: step.stat,
    operator: step.operator,
    value: step.value,
  })),
  [
    {
      op: 'modify_card_value',
      selector: { zone: 'hand', pick: 'random', count: 2 },
      stat: 'damage',
      operator: 'add',
      value: 2,
    },
    {
      op: 'modify_card_value',
      selector: { zone: 'hand', pick: 'left', count: 1 },
      stat: 'block',
      operator: 'multiply',
      value: 1.5,
    },
    {
      op: 'modify_card_value',
      selector: { zone: 'hand', pick: 'right', count: 1 },
      stat: 'lust',
      operator: 'subtract',
      value: 1,
    },
    {
      op: 'modify_card_value',
      selector: { zone: 'all', pick: 'all' },
      stat: 'stacks',
      operator: 'divide',
      value: 2,
    },
  ],
);

const cardPlayRules = compileCompactEffectList([
  { card_rule: 'replay', limit: 2, extra: 1 },
  { card_rule: 'free', limit: 'all' },
]);
assert.equal(cardPlayRules.ok, true, JSON.stringify(cardPlayRules.issues));
assert.deepEqual(cardPlayRules.value.steps, [
  { op: 'card_play_rule', target: 'self', rule: 'replay', limit: 2, extra: 1 },
  { op: 'card_play_rule', target: 'self', rule: 'free', limit: 'all' },
]);
assert.deepEqual(executeEffectProgram(cardPlayRules.value, state, { spentEnergy: 0 }).events, [
  { type: 'card_play_rule', target: 'self', rule: 'replay', limit: 2, extra: 1, priority: 0 },
  { type: 'card_play_rule', target: 'self', rule: 'free', limit: 'all', extra: 0, priority: 0 },
]);

const specialContainers = compileCompactEffectList([
  {
    stance: {
      id: 'calm', name: '静心', description: '保持专注。',
      enter: [{ block: 2 }], exit: [{ energy: 1 }], passive: [{ modify: 'block', add: 1 }],
    },
  },
  {
    channel_orb: {
      id: 'spark', name: '火花', value: 3,
      passive: [{ block: 'orb_value' }], evoke: [{ damage: 'orb_value' }],
    },
  },
  { evoke_orb: 1, pick: 'first', orb_id: 'spark' },
  { orb_slots: 3 },
  { modify_orb: 'value', pick: 'all', multiply: 1.5 },
  { extra_turn: 1 },
  { end_turn: true, to: 'opponent' },
]);
assert.equal(specialContainers.ok, true, JSON.stringify(specialContainers.issues));
assert.deepEqual(specialContainers.value.steps.map(step => step.op), [
  'set_stance', 'channel_orb', 'evoke_orbs', 'set_orb_slots', 'modify_orbs', 'grant_extra_turn', 'force_end_turn',
]);
assert.deepEqual(specialContainers.value.steps[1].orb.passiveEffects[0].amount, { op: 'var', path: 'context.orb_value' });
assert.equal(compileCompactEffectList({ stance: { id: 'bad-id', name: '错误' } }).ok, false);
assert.equal(compileCompactEffectList({ stance: { id: 'calm', name: '静心', passive: { damage: 1 } } }).ok, false);
assert.equal(compileCompactEffectList({ channel_orb: { id: 'spark', name: '火花', value: 1, unknown: true } }).ok, false);
assert.equal(compileCompactEffectList({ modify_orb: 'value', divide: 0 }).ok, false);

const triggered = compileCompactEffectList([{ block: 2 }, { draw: 1 }], { trigger: 'turn_start' });
assert.equal(triggered.ok, true);
assert.deepEqual(triggered.value.steps, [
  {
    op: 'register_trigger',
    target: 'self',
    trigger: 'turn_start',
    effects: [
      { op: 'gain_block', target: 'self', amount: 2 },
      { op: 'draw_cards', amount: 1 },
    ],
  },
]);
assert.equal(executeEffectProgram(triggered.value, state, { spentEnergy: 0 }).events[0].type, 'register_trigger');
assert.equal(compileCompactEffectList([{ block: 1 }], { trigger: 'tick' }).ok, false);
const mixedTriggers = compileCompactEffectList([
  { block: 2, on: 'turn_start' },
  { apply_status: 'bleed', on: 'take_damage' },
]);
assert.equal(mixedTriggers.ok, true);
assert.deepEqual(
  mixedTriggers.value.steps.map(step => step.trigger),
  ['turn_start', 'take_damage'],
);
const defaultAndOverrideTrigger = compileCompactEffectList(
  [{ block: 1 }, { draw: 1 }, { damage: 2, on: 'take_damage' }],
  { trigger: 'turn_start' },
);
assert.equal(defaultAndOverrideTrigger.ok, true);
assert.deepEqual(
  defaultAndOverrideTrigger.value.steps.map(step => step.trigger),
  ['turn_start', 'take_damage'],
);
assert.equal(defaultAndOverrideTrigger.value.steps[0].effects.length, 2);

const generatedCard = compileCompactEffectList([{ add_card: 'spark', to: 'hand', count: 2 }], {
  creates: [
    {
      id: 'spark',
      name: '火花',
      emoji: '*',
      type: 'Attack',
      rarity: 'Common',
      cost: 0,
      description: '造成 3 点伤害。',
      effects: [{ damage: 3 }],
      exhaust: true,
    },
  ],
});
assert.equal(generatedCard.ok, true);
assert.equal(generatedCard.value.steps[0].op, 'add_card');
assert.equal(generatedCard.value.steps[0].card.id, 'spark');
assert.deepEqual(generatedCard.value.steps[0].card.program.steps, [{ op: 'damage', target: 'opponent', amount: 3 }]);
const generatedResult = executeEffectProgram(generatedCard.value, state, { spentEnergy: 0 });
assert.equal(generatedResult.ok, true);
assert.equal(generatedResult.events[0].type, 'add_card');
assert.equal(generatedResult.events[0].count, 2);

const generatedInnate = compileCompactEffectList([{ add_card: 'late_innate' }], {
  creates: [{ id: 'late_innate', name: '迟到固有', effects: [{ block: 1 }], innate: true }],
});
assert.equal(generatedInnate.ok, false, 'innate is meaningless on cards generated after battle start');
assert.equal(
  generatedInnate.issues.some(issue => issue.code === 'UNKNOWN_FIELD'),
  true,
);

assert.equal(
  compileCompactEffectList([{ add_card: 'missing' }], { creates: [] }).issues[0].code,
  'UNKNOWN_CARD_TEMPLATE',
);
const cyclicTemplates = [
  { id: 'card_a', name: 'A', effects: [{ add_card: 'card_b' }] },
  { id: 'card_b', name: 'B', effects: [{ add_card: 'card_a' }] },
];
const cyclic = compileCompactEffectList([{ add_card: 'card_a' }], { creates: cyclicTemplates });
assert.equal(cyclic.ok, false);
assert.equal(
  cyclic.issues.some(issue => issue.code === 'CARD_TEMPLATE_CYCLE'),
  true,
);

for (const [effects, code] of [
  [[{ damage: 'unknown * 4' }], 'UNKNOWN_VARIABLE'],
  [[{ damage: 'size([1])' }], 'UNSUPPORTED_FORMULA'],
  [[{ damage: 'self.foo + 1' }], 'UNKNOWN_VARIABLE'],
  [[{ damage: 1.25 }], 'TOO_MANY_DECIMALS'],
  [[{ damage: 'self.hp * 0.25' }], 'TOO_MANY_DECIMALS'],
  [[{ damage: 1, extra: true }], 'UNKNOWN_FIELD'],
  [[{ damage: 1, to: 'everyone' }], 'INVALID_TARGET'],
  [[{ apply_status: 'bad-id' }], 'INVALID_STATUS_ID'],
  [[{ discard: 1, from: 'draw', pick: 'left' }], 'INVALID_CARD_PICK'],
  [[{ copy: 0 }], 'INVALID_CARD_COUNT'],
  [[{ reduce_cost: 1, count: 'two' }], 'INVALID_CARD_COUNT'],
  [[{ modify_card: 'hits', add: 1 }], 'INVALID_CARD_VALUE_STAT'],
  [[{ modify_card: 'damage', add: 1, multiply: 2 }], 'INVALID_CARD_VALUE_OPERATOR'],
  [[{ modify_card: 'damage', divide: 0 }], 'DIVISION_BY_ZERO'],
  [[{ card_rule: 'free', limit: 1, extra: 1 }], 'UNEXPECTED_CARD_REPLAY_COUNT'],
  [[{ card_rule: 'replay' }], 'MISSING_CARD_RULE_LIMIT'],
  [[{ modify: 'speed', add: 1 }], 'INVALID_MODIFIER'],
  [[{ modify: 'damage', add: 1, multiply: 2 }], 'INVALID_MODIFIER_OPERATOR'],
  [[{ modify: 'damage', add: 'self.hp' }], 'INVALID_MODIFIER_FORMULA'],
  [[{ modify: 'damage', add: 1, when: 'self.hp < 5' }], 'UNKNOWN_FIELD'],
  [[{ damage: 1, add_card: 'spark' }], 'INVALID_EFFECT_BUNDLE'],
  [[{ damage: 1, block: 2, count: 2 }], 'UNKNOWN_FIELD'],
  [[{ damage: 2, hits: 0 }], 'INVALID_HIT_COUNT'],
  [[{ damage: 2, block: 1, hits: 2 }], 'INVALID_EFFECT_BUNDLE'],
  [[{ damage: 2, damage_type: 'unknown' }], 'INVALID_DAMAGE_KIND'],
  [[{ damage: 2, bypass_block: 'yes' }], 'INVALID_DAMAGE_PACKET'],
  [[{ damage: 2, damage_type: 'hp_loss', bypass_block: false }], 'CONFLICTING_DAMAGE_PACKET'],
  [[{ execute: 20, threshold_mode: 'ratio' }], 'INVALID_EXECUTE_THRESHOLD'],
  [[{ kill: false }], 'INVALID_KILL'],
  [[{ kill: true, exclude_tags: ['boss', 'boss'] }], 'INVALID_ENTITY_TAGS'],
  [[{ block: 2, hits: 2 }], 'UNKNOWN_FIELD'],
  [[{ recover: 1, from: 'hand' }], 'INVALID_CARD_ZONE'],
  [[{ recover: 1, from: 'discard', pick: 'left' }], 'INVALID_CARD_PICK'],
  [[{ recover: 1, from: 'discard', pick: 'all' }], 'INVALID_CARD_COUNT'],
]) {
  const invalid = compileCompactEffectList(effects);
  assert.equal(invalid.ok, false);
  assert.equal(
    invalid.issues.some(issue => issue.code === code),
    true,
    JSON.stringify(invalid.issues),
  );
}

const source = await readFile(resolve('src/game-core/compactEffectDsl.ts'), 'utf8');
assert.doesNotMatch(source, /from ['"].*(runtime|ui|tavern|messageVariables|jquery)/i);
assert.doesNotMatch(source, /\b(document|window|localStorage|eval|Function)\b/);

const schemaBundleOperations = Object.keys(compactSchema.$defs.bundleEffect.properties).filter(
  key => !['stacks', 'damage_type', 'bypass_block', 'lifesteal', 'to', 'targets', 'when', 'on'].includes(key),
);
assert.deepEqual(
  schemaBundleOperations,
  [...COMPACT_EFFECT_BUNDLE_OPERATIONS],
  'the external JSON schema must expose the same bundle operations as the compiler contract',
);
assert.equal(compactSchema.properties.effects.$ref, '#/$defs/effectList');
assert.deepEqual(compactSchema.$defs.amountEffect.properties.hits, { type: 'integer', minimum: 1, maximum: 20 });
assert.deepEqual(compactSchema.$defs.amountEffect.properties.damage_type.enum, [
  'attack', 'effect', 'hp_loss', 'retaliation', 'damage_over_time',
]);
assert.deepEqual(compactSchema.$defs.formula.oneOf[0], { type: 'number', multipleOf: 0.1 });
for (const definition of ['stanceEffect', 'channelOrbEffect', 'evokeOrbEffect', 'orbSlotsEffect', 'modifyOrbEffect', 'extraTurnEffect', 'endTurnEffect']) {
  assert.ok(compactSchema.$defs[definition], `compact schema must expose ${definition}`);
}
assert.ok(compactSchema.$defs.cardAttachmentEffect);
assert.ok(compactSchema.$defs.cardAttachmentChange);
assert.equal(compactSchema.$defs.trigger.enum.includes('on_exhaust'), true);
assert.equal(compactSchema.$defs.trigger.enum.includes('on_draw'), true);
assert.equal(compactSchema.$defs.trigger.enum.includes('on_shuffle'), true);
assert.deepEqual(compactSchema.$defs.recoverEffect.properties.from.enum, ['discard', 'exhaust']);
assert.equal(compactSchema.$defs.scryEffect.properties.scry.$ref, '#/$defs/formula');
assert.equal(compactSchema.$defs.seekEffect.properties.seek.$ref, '#/$defs/formula');
for (const trigger of ['attack_played', 'skill_played', 'power_played']) {
  assert.equal(compactSchema.$defs.trigger.enum.includes(trigger), true);
}

const richSelector = compileCompactEffectList([
  {
    modify_card: 'damage',
    multiply: 2,
    from: 'draw',
    pick: 'top',
    count: 2,
    card_type: ['Attack'],
    rarity: ['Uncommon', 'Rare'],
    min_cost: 1,
    tag: ['combo'],
    origin: 'deck',
    upgraded: true,
  },
]);
assert.equal(richSelector.ok, true);
assert.deepEqual(richSelector.value.steps[0].selector, {
  zone: 'draw',
  pick: 'top',
  count: 2,
  filter: {
    types: ['Attack'],
    rarities: ['Uncommon', 'Rare'],
    minCost: 1,
    tags: ['combo'],
    origin: 'deck',
    upgraded: true,
  },
});
const exhaustSelector = compileCompactEffectList([
  { modify_card: 'block', add: 1, from: 'exhaust', pick: 'bottom', count: 1 },
]);
assert.equal(exhaustSelector.ok, true);
const durablePatch = compileCompactEffectList([
  {
    patch_card: 'retain',
    enabled: true,
    scope: 'run',
    match: 'template',
    future_copies: true,
    from: 'hand',
    pick: 'choose',
    count: 1,
    card_type: 'Skill',
  },
  {
    patch_card: 'cost',
    set: 0,
    scope: 'until_played',
    from: 'hand',
    pick: 'left',
    count: 1,
  },
]);
assert.equal(durablePatch.ok, true, JSON.stringify(durablePatch.issues));
assert.equal(durablePatch.value.steps[0].op, 'apply_card_patch');
assert.deepEqual(durablePatch.value.steps[0].patch, {
  kind: 'keyword',
  keyword: 'retain',
  enabled: true,
  scope: 'run',
  match: 'template',
  includeFutureCopies: true,
});
assert.equal(durablePatch.value.steps[1].patch.operator, 'set');

const legacyNestedPatch = compileCompactEffectList({
  patch_card: {
    damage: { add: 2 },
    scope: 'combat',
    from: 'combat',
    pick: 'all',
    template_id: 'root_card',
    root_only: true,
  },
});
assert.equal(legacyNestedPatch.ok, true, JSON.stringify(legacyNestedPatch.issues));
assert.equal(legacyNestedPatch.value.steps[0].op, 'apply_card_patch');
assert.deepEqual(legacyNestedPatch.value.steps[0].patch, {
  kind: 'numeric',
  stat: 'damage',
  operator: 'add',
  value: 2,
  scope: 'combat',
  match: 'instance',
});
assert.equal(legacyNestedPatch.value.steps[0].selector.filter.templateId, 'root_card');
assert.equal(legacyNestedPatch.value.steps[0].selector.filter.rootOnly, true);

for (const ambiguousPatch of [
  { patch_card: { damage: { add: 1 }, block: { add: 1 }, from: 'combat', pick: 'all' } },
  { patch_card: { damage: { add: 1, multiply: 2 }, from: 'combat', pick: 'all' } },
  { patch_card: { damage: { add: 1, unsupported: true }, from: 'combat', pick: 'all' } },
]) {
  const invalid = compileCompactEffectList(ambiguousPatch);
  assert.equal(invalid.ok, false, 'ambiguous or unknown nested patch_card input must remain rejected');
}

const dynamicCostPatch = compileCompactEffectList([
  { patch_card: 'dynamic_cost', from: 'hand', pick: 'choose', timing: 'on_draw', subtract: 'turn_number', minimum: 0, scope: 'permanent' },
  { patch_card: 'x_value', from: 'hand', pick: 'choose', add: 2, scope: 'combat' },
]);
assert.equal(dynamicCostPatch.ok, true, JSON.stringify(dynamicCostPatch.issues));
assert.equal(dynamicCostPatch.value.steps[0].patch.kind, 'dynamic_cost');
assert.deepEqual(dynamicCostPatch.value.steps[0].patch.value, { op: 'var', path: 'battle.turn_number' });
assert.equal(dynamicCostPatch.value.steps[1].patch.kind, 'x_value');
const xFormula = compileCompactEffectList({ damage: 'x_value * 4' });
assert.equal(xFormula.ok, true);
assert.deepEqual(xFormula.value.steps[0].amount.left, { op: 'var', path: 'context.x_value' });
const historyConditions = compileCompactEffectList([
  { draw: 1, when: 'last_card_type("Attack")' },
  { block: 4, when: 'intent_is("attack")' },
  { energy: 1, when: 'pile_empty("draw")' },
  { damage: 5, when: 'only_card("hand", "Attack")' },
]);
assert.equal(historyConditions.ok, true, JSON.stringify(historyConditions.issues));
assert.equal(historyConditions.value.steps[0].condition.op, 'last_card_type');
assert.equal(historyConditions.value.steps[1].condition.op, 'intent_type');
assert.equal(historyConditions.value.steps[2].condition.left.op, 'count_cards');
assert.equal(historyConditions.value.steps[3].condition.right, 1);
const choiceEffect = compileCompactEffectList({
  choose: 'combat_route',
  options: [
    { id: 'guard', label: '稳守', effects: [{ block: 8 }, { draw: 1 }] },
    { id: 'strike', label: '强攻', effects: [{ damage: 11 }] },
  ],
});
assert.equal(choiceEffect.ok, true, JSON.stringify(choiceEffect.issues));
assert.equal(choiceEffect.value.steps[0].op, 'choose_one');
assert.equal(choiceEffect.value.steps[0].options[0].effects.length, 2);
const upgradeEffect = compileCompactEffectList({
  upgrade_card: 1,
  from: 'hand',
  pick: 'choose',
  scope: 'permanent',
  levels: 1,
  max_level: 5,
  changes: [
    { kind: 'numeric', stat: 'damage', operator: 'add', value: 'self.status.temper.stacks' },
    { kind: 'keyword', keyword: 'retain', enabled: true },
  ],
});
assert.equal(upgradeEffect.ok, true, JSON.stringify(upgradeEffect.issues));
assert.equal(upgradeEffect.value.steps[0].op, 'upgrade_cards');
assert.deepEqual(upgradeEffect.value.steps[0].changes[0].value, { op: 'var', path: 'self.status.temper.stacks' });

const attachmentEffect = compileCompactEffectList({
  attach_card: {
    id: 'runtime_binding',
    kind: 'affliction',
    name: '运行时束缚',
    description: '带来源和明确生命周期的卡牌负面附着。',
    scope: 'combat',
    remove_on: 'discarded',
    remaining: 2,
    discard_reasons: ['player_choice', 'random_effect'],
    changes: [
      { kind: 'cost', operator: 'add', value: 1 },
      { kind: 'play_access', mode: 'deny' },
      {
        kind: 'discard_auto_play',
        reasons: ['player_choice', 'random_effect'],
        failure_destination: 'discard',
        only_player_turn: true,
      },
    ],
  },
  from: 'hand',
  pick: 'choose',
  count: 1,
});
assert.equal(attachmentEffect.ok, true, JSON.stringify(attachmentEffect.issues));
assert.equal(attachmentEffect.value.steps[0].op, 'apply_card_attachment');
assert.equal(attachmentEffect.value.steps[0].attachment.changes.length, 3);
assert.equal(attachmentEffect.value.steps[0].attachment.removeOn, 'discarded');
const badAttachment = compileCompactEffectList({
  attach_card: {
    id: 'bad_binding', kind: 'affliction', name: '错误附着', scope: 'combat',
    changes: [{ kind: 'numeric', stat: 'damage', operator: 'divide', value: 0 }],
  },
  from: 'hand', pick: 'left', count: 1,
});
assert.equal(badAttachment.ok, false);
assert.ok(badAttachment.issues.some(issue => issue.code === 'DIVISION_BY_ZERO'));

const resourceEffect = compileCompactEffectList([
  { resource: { id: 'stars', amount: 2 }, to: 'self' },
  { set_resource: { id: 'stars', value: 'self.resource.stars.max' }, to: 'self' },
  { card_rule: 'free', limit: 1, resources: ['energy'] },
]);
assert.equal(resourceEffect.ok, true, JSON.stringify(resourceEffect.issues));
assert.deepEqual(resourceEffect.value.steps, [
  { op: 'gain_resource', target: 'self', resource: 'stars', amount: 2 },
  { op: 'set_resource', target: 'self', resource: 'stars', value: { op: 'var', path: 'self.resource.stars.max' } },
  { op: 'card_play_rule', target: 'self', rule: 'free', limit: 1, freeResources: ['energy'] },
]);
assert.equal(
  compileCompactEffectList([{ resource: { id: 'energy', amount: 1 } }]).ok,
  false,
  'the compatibility energy channel keeps using the existing energy operation',
);

const summonEffects = compileCompactEffectList([
  {
    spawn_summon: {
      id: 'clockwork_guard', name: '发条守卫', emoji: '⚙️', description: '独立行动并保护召唤者。',
      max_hp: 12, block: 2, count: 1, capacity: 3, overflow: 'replace_oldest',
      action_priority: 2, speed: 4, actions_per_activation: 1,
      intercept: { mode: 'unblocked_attack', priority: 3, max_per_turn: 1 },
      capabilities: { selectable: true, accepts_status: true, acts: true, intercepts: true },
      action: [{ damage: 4 }],
      actions: [
        { id: 'guard_bash', name: '守卫冲撞', emoji: '💥', weight: 2, effects: { damage: 5 } },
        {
          id: 'guard_cover', name: '守卫掩护', emoji: '🛡️', weight: 1,
          effects: { summoner_effects: [{ block: 4 }, { energy: 1 }] },
        },
      ],
      abilities: [{
        id: 'guard_repair', name: '自修复',
        trigger: { on: 'turn_start', effects: { heal: 1 } },
      }],
    },
    to: 'self',
  },
  { damage_summon: { selector: { owner: 'opponent', pick: 'random_n', count: 2 }, amount: 3 } },
  { heal_summon: { selector: { owner: 'self', pick: 'lowest_hp' }, amount: 2 } },
  { modify_summon: { selector: { owner: 'self', pick: 'all' }, stat: 'speed', add: 1 } },
  { modify_summon_effect: { selector: { owner: 'self', pick: 'left' }, stat: 'damage', multiply: 2 } },
  { summon_resource: { selector: { owner: 'self', pick: 'first' }, id: 'charge', amount: 1 } },
  { set_summon_resource: { selector: { owner: 'self', pick: 'first' }, id: 'charge', value: 0 } },
  { apply_summon_status: { selector: { owner: 'self', pick: 'all' }, id: 'focus', stacks: 2 } },
  { remove_summon_status: { selector: { owner: 'self', pick: 'all' }, id: 'focus' } },
  { activate_summon: { selector: { owner: 'self', pick: 'all' } } },
  { dismiss_summon: { selector: { owner: 'self', pick: 'last' }, retain_corpse: true } },
  { copy_summon: { selector: { owner: 'self', pick: 'choose', count: 1 }, to: 'self' } },
], { statusNames: { focus: '专注' } });
assert.equal(summonEffects.ok, true, JSON.stringify(summonEffects.issues));
assert.deepEqual(summonEffects.value.steps.map(step => step.op), [
  'spawn_summon', 'damage_summons', 'heal_summons', 'modify_summons', 'modify_summon_effects',
  'gain_summon_resource', 'set_summon_resource', 'apply_summon_status',
  'remove_summon_status', 'activate_summons', 'dismiss_summons', 'copy_summons',
]);
assert.equal(summonEffects.value.steps[0].summon.actionProgram.steps[0].op, 'damage');
assert.equal(summonEffects.value.steps[0].summon.actions.length, 2);
assert.equal(summonEffects.value.steps[0].summon.actions[1].effectProgram.steps[0].op, 'summoner_effects');
assert.deepEqual(
  summonEffects.value.steps[0].summon.actions[1].effectProgram.steps[0].effects.map(step => step.op),
  ['gain_block', 'gain_energy'],
  'summon actions can explicitly route a nested effect program to their summoner without changing ordinary self',
);
assert.equal(summonEffects.value.steps[0].summon.abilities[0].trigger, 'turn_start');
assert.equal(summonEffects.value.steps[0].summon.intercept.maxPerTurn, 1);
assert.equal(summonEffects.value.steps[0].summon.capabilities.acceptsStatus, true);
assert.equal(summonEffects.value.steps[1].selector.pick, 'random_n');
assert.equal(summonEffects.value.steps[10].retainCorpse, true);
assert.equal(summonEffects.value.steps[11].selector.pick, 'choose');
assert.equal(summonEffects.value.steps[11].targetOwner, 'self');
const badSummonDivision = compileCompactEffectList({
  modify_summon: { selector: { owner: 'self', pick: 'all' }, stat: 'max_hp', divide: 0 },
});
assert.equal(badSummonDivision.ok, false);
assert.ok(badSummonDivision.issues.some(issue => issue.code === 'DIVISION_BY_ZERO'));
const missingSummonId = compileCompactEffectList({
  activate_summon: { selector: { owner: 'self', pick: 'by_id' } },
});
assert.equal(missingSummonId.ok, false);
assert.ok(missingSummonId.issues.some(issue => issue.code === 'MISSING_SUMMON_ID'));

console.log('Compact AI effects compile through restricted CEL into the portable AST.');
