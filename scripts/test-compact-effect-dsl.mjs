import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { COMPACT_EFFECT_BUNDLE_OPERATIONS, compileCompactEffectList, executeEffectProgram } = require(
  resolve('src/game-core/index.ts'),
);

const compact = [
  { damage: 'spent_energy * 4' },
  { block: 1, when: 'spent_energy == 0' },
  { block: 'spent_energy', when: 'spent_energy > 0' },
];
const compiled = compileCompactEffectList(compact);
assert.equal(compiled.ok, true);
assert.equal(compiled.value.spec, 'mwg.effect/v1');
assert.equal(Object.hasOwn(compact, 'spec'), false);

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
const blockedState = structuredClone(state);
blockedState.opponent.block = 5;
const multiHitResult = executeEffectProgram(multiHit.value, blockedState, { spentEnergy: 0 });
assert.equal(multiHitResult.state.opponent.block, 0);
assert.equal(multiHitResult.state.opponent.hp, 26, 'each hit consumes block independently');
assert.equal(multiHitResult.events.filter(event => event.type === 'damage').length, 3);

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
  [[{ damage: 1, extra: true }], 'INVALID_EFFECT_BUNDLE'],
  [[{ damage: 1, to: 'everyone' }], 'INVALID_TARGET'],
  [[{ apply_status: 'bad-id' }], 'INVALID_STATUS_ID'],
  [[{ discard: 1, from: 'draw', pick: 'left' }], 'INVALID_CARD_PICK'],
  [[{ copy: 0 }], 'INVALID_CARD_COUNT'],
  [[{ reduce_cost: 1, count: 'two' }], 'INVALID_CARD_COUNT'],
  [[{ modify: 'speed', add: 1 }], 'INVALID_MODIFIER'],
  [[{ modify: 'damage', add: 1, multiply: 2 }], 'INVALID_MODIFIER_OPERATOR'],
  [[{ modify: 'damage', add: 'self.hp' }], 'INVALID_MODIFIER_FORMULA'],
  [[{ modify: 'damage', add: 1, when: 'self.hp < 5' }], 'UNKNOWN_FIELD'],
  [[{ damage: 1, add_card: 'spark' }], 'INVALID_EFFECT_BUNDLE'],
  [[{ damage: 1, block: 2, count: 2 }], 'UNKNOWN_FIELD'],
  [[{ damage: 2, hits: 0 }], 'INVALID_HIT_COUNT'],
  [[{ damage: 2, block: 1, hits: 2 }], 'INVALID_EFFECT_BUNDLE'],
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

const compactSchema = JSON.parse(await readFile(resolve('schemas/mwg-card-effects-v1.schema.json'), 'utf8'));
const schemaBundleOperations = Object.keys(compactSchema.$defs.bundleEffect.properties).filter(
  key => !['stacks', 'to', 'when', 'on'].includes(key),
);
assert.deepEqual(
  schemaBundleOperations,
  [...COMPACT_EFFECT_BUNDLE_OPERATIONS],
  'the external JSON schema must expose the same bundle operations as the compiler contract',
);
assert.equal(compactSchema.properties.effects.$ref, '#/$defs/effectList');
assert.deepEqual(compactSchema.$defs.amountEffect.properties.hits, { type: 'integer', minimum: 1, maximum: 20 });
assert.deepEqual(compactSchema.$defs.formula.oneOf[0], { type: 'number', multipleOf: 0.1 });
assert.equal(compactSchema.$defs.trigger.enum.includes('on_exhaust'), true);
assert.equal(compactSchema.$defs.trigger.enum.includes('on_draw'), true);
assert.equal(compactSchema.$defs.trigger.enum.includes('on_shuffle'), true);
assert.deepEqual(compactSchema.$defs.recoverEffect.properties.from.enum, ['discard', 'exhaust']);
assert.equal(compactSchema.$defs.scryEffect.properties.scry.$ref, '#/$defs/formula');
assert.equal(compactSchema.$defs.seekEffect.properties.seek.$ref, '#/$defs/formula');
for (const trigger of ['attack_played', 'skill_played', 'power_played']) {
  assert.equal(compactSchema.$defs.trigger.enum.includes(trigger), true);
}

console.log('Compact AI effects compile through restricted CEL into the portable AST.');
