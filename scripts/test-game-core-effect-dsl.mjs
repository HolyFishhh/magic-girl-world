import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/effectDsl.ts'));
const schema = JSON.parse(await readFile(resolve('schemas/mwg-effect-v1.schema.json'), 'utf8'));
const validateEffectSchema = new Ajv2020({ strict: false, allErrors: true }).compile(schema);

assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.equal(schema.$defs.program.properties.spec.const, core.EFFECT_PROGRAM_SPEC);
for (const definition of ['stanceEffect', 'channelOrbEffect', 'evokeOrbsEffect', 'setOrbSlotsEffect', 'modifyOrbsEffect', 'grantExtraTurnEffect', 'forceEndTurnEffect']) {
  assert.ok(schema.$defs[definition], `AST schema must expose ${definition}`);
}
assert.ok(schema.$defs.applyCardAttachmentEffect);
assert.ok(schema.$defs.cardAttachmentChange);
assert.ok(schema.$defs.historyExpression);
assert.ok(schema.$defs.eventTriggerQuery);
assert.ok(schema.$defs.registerTriggerEffect);

const schemaEventProgram = {
  spec: 'mwg.effect/v1',
  steps: [{
    op: 'register_trigger',
    target: 'self',
    trigger: 'deal_damage',
    eventQuery: {
      scope: 'combat',
      ordinal: 'every_n',
      n: 2,
      filter: {
        kind: 'damage_resolved', phase: 'resolve', sourceKind: 'card', damageKind: 'attack',
        actorId: 'player', targetId: 'enemy_alpha',
      },
    },
    effects: [{
      op: 'gain_block',
      target: 'self',
      amount: {
        op: 'history', metric: 'last_hp_loss', scope: 'turn',
        filter: { kind: 'damage_resolved', phase: 'resolve', targetId: 'player' },
      },
    }],
  }],
};
assert.equal(validateEffectSchema(schemaEventProgram), true, JSON.stringify(validateEffectSchema.errors));
for (const invalidProgram of [
  {
    ...schemaEventProgram,
    steps: [{ ...schemaEventProgram.steps[0], eventQuery: { ordinal: 'first', n: 1 } }],
  },
  {
    ...schemaEventProgram,
    steps: [{ ...schemaEventProgram.steps[0], eventQuery: { ordinal: 'nth' } }],
  },
  {
    ...schemaEventProgram,
    steps: [{ ...schemaEventProgram.steps[0], eventQuery: { filter: { damageKind: 'untyped' } } }],
  },
  {
    ...schemaEventProgram,
    steps: [{
      ...schemaEventProgram.steps[0],
      effects: [{ op: 'gain_block', target: 'self', amount: { op: 'history', metric: 'unknown_metric' } }],
    }],
  },
]) {
  assert.equal(validateEffectSchema(invalidProgram), false, 'internal schema must reject malformed event history/query input');
}

const program = {
  spec: 'mwg.effect/v1',
  steps: [
    {
      op: 'damage',
      target: 'opponent',
      amount: {
        op: 'multiply',
        left: { op: 'var', path: 'context.spent_energy' },
        right: 4,
      },
    },
    {
      op: 'gain_block',
      target: 'self',
      amount: { op: 'var', path: 'context.spent_energy' },
    },
    {
      op: 'if',
      condition: {
        op: 'compare',
        relation: 'eq',
        left: { op: 'var', path: 'battle.cards_played_this_turn' },
        right: 1,
      },
      then: [{ op: 'heal', target: 'self', amount: 2 }],
      else: [{ op: 'gain_lust', target: 'self', amount: 2 }],
    },
    {
      op: 'modify',
      target: 'self',
      stat: 'block',
      operator: 'add',
      value: { op: 'var', path: 'context.status_stacks' },
    },
  ],
};

assert.deepEqual(core.validateEffectProgram(program), { ok: true, value: program });

const state = {
  self: { hp: 10, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  opponent: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 2 },
  currentTurn: 3,
  cardsPlayedThisTurn: 1,
  attacksPlayedThisTurn: 1,
  skillsPlayedThisTurn: 0,
};
const result = core.executeEffectProgram(program, state, { spentEnergy: 3, statusStacks: 2 });
assert.equal(result.ok, true);
assert.equal(result.state.self.hp, 12);
assert.equal(result.state.self.block, 3);
assert.equal(result.state.opponent.hp, 10);
assert.equal(result.state.opponent.block, 0);
assert.deepEqual(result.events.at(-1), {
  type: 'modify',
  target: 'self',
  stat: 'block',
  operator: 'add',
  value: 2,
});
assert.deepEqual(state, {
  self: { hp: 10, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  opponent: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 2 },
  currentTurn: 3,
  cardsPlayedThisTurn: 1,
  attacksPlayedThisTurn: 1,
  skillsPlayedThisTurn: 0,
});

const counterProgram = {
  spec: 'mwg.effect/v1',
  steps: [
    {
      op: 'damage',
      target: 'opponent',
      amount: {
        op: 'add',
        left: { op: 'var', path: 'battle.turn_number' },
        right: {
          op: 'add',
          left: { op: 'var', path: 'battle.attacks_played_this_turn' },
          right: { op: 'var', path: 'battle.skills_played_this_turn' },
        },
      },
    },
  ],
};
assert.equal(core.validateEffectProgram(counterProgram).ok, true);
const counterResult = core.executeEffectProgram(
  counterProgram,
  { ...state, currentTurn: 4, attacksPlayedThisTurn: 2, skillsPlayedThisTurn: 1 },
  { spentEnergy: 0 },
);
assert.equal(counterResult.state.opponent.hp, 15, 'the counter formula still resolves through ordinary block-aware damage');

const unknownVariable = structuredClone(program);
unknownVariable.steps[0].amount.left.path = 'self.unknown';
const invalid = core.validateEffectProgram(unknownVariable);
assert.equal(invalid.ok, false);
assert.equal(invalid.issues[0].path, '$.steps[0].amount.left.path');
assert.equal(invalid.issues[0].code, 'UNKNOWN_VARIABLE');

const divideByZero = {
  spec: 'mwg.effect/v1',
  steps: [
    {
      op: 'heal',
      target: 'self',
      amount: { op: 'divide', left: 5, right: 0 },
    },
  ],
};
const failed = core.executeEffectProgram(divideByZero, state, { spentEnergy: 0 });
assert.equal(failed.ok, false);
assert.equal(failed.error.code, 'DIVISION_BY_ZERO');
assert.deepEqual(failed.state, state);
assert.deepEqual(failed.events, []);

const energyResult = core.executeEffectProgram(
  { spec: 'mwg.effect/v1', steps: [{ op: 'gain_energy', target: 'self', amount: 2 }] },
  state,
  { spentEnergy: 0 },
);
assert.equal(energyResult.ok, true);

const signedDeltaResult = core.executeEffectProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [
      { op: 'gain_lust', target: 'self', amount: -8 },
      { op: 'gain_energy', target: 'self', amount: -2 },
      { op: 'gain_resource', target: 'self', resource: 'charge', amount: -3 },
      { op: 'set_stat', target: 'self', stat: 'block', value: -5 },
    ],
  },
  {
    ...state,
    self: { ...state.self, lust: 20, energy: 3, block: 4, resources: { charge: 5 }, maxResources: { charge: 9 } },
  },
  { spentEnergy: 0 },
);
assert.equal(signedDeltaResult.ok, true);
assert.equal(signedDeltaResult.state.self.lust, 12);
assert.equal(signedDeltaResult.state.self.energy, 1);
assert.equal(signedDeltaResult.state.self.resources.charge, 2);
assert.equal(signedDeltaResult.state.self.block, 0, 'block is clamped at the state boundary');
for (const step of [
  { op: 'damage', target: 'opponent', amount: -1 },
  { op: 'gain_block', target: 'self', amount: -1 },
  { op: 'apply_status', target: 'self', status: 'focus', stacks: -1 },
  { op: 'draw_cards', amount: -1 },
]) {
  const rejected = core.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [step] }, state, { spentEnergy: 0 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'NEGATIVE_AMOUNT');
}

const recoverProgram = {
  spec: 'mwg.effect/v1',
  steps: [{ op: 'recover_cards', source: 'discard', pick: 'choose', amount: 2 }],
};
assert.equal(core.validateEffectProgram(recoverProgram).ok, true);
assert.deepEqual(core.executeEffectProgram(recoverProgram, state, { spentEnergy: 0 }).events, [
  { type: 'recover_cards', source: 'discard', pick: 'choose', amount: 2 },
]);
assert.equal(schema.$defs.recoverEffect.properties.op.const, 'recover_cards');
const seekProgram = { spec: 'mwg.effect/v1', steps: [{ op: 'recover_cards', source: 'draw', pick: 'choose', amount: 1 }] };
assert.equal(core.validateEffectProgram(seekProgram).ok, true);
assert.deepEqual(core.executeEffectProgram(seekProgram, state, { spentEnergy: 0 }).events, [
  { type: 'recover_cards', source: 'draw', pick: 'choose', amount: 1 },
]);
const scryProgram = { spec: 'mwg.effect/v1', steps: [{ op: 'scry_cards', amount: 3 }] };
assert.equal(core.validateEffectProgram(scryProgram).ok, true);
assert.deepEqual(core.executeEffectProgram(scryProgram, state, { spentEnergy: 0 }).events, [
  { type: 'scry_cards', amount: 3 },
]);
assert.equal(schema.$defs.scryEffect.properties.op.const, 'scry_cards');
assert.equal(energyResult.state.self.energy, 5, 'maxEnergy is a turn refill value, not a temporary gain cap');

const attachmentProgram = {
  spec: 'mwg.effect/v1',
  steps: [{
    op: 'apply_card_attachment',
    selector: { zone: 'hand', pick: 'choose', count: 1 },
    attachment: {
      id: 'dsl_affliction', kind: 'affliction', name: 'DSL负面附着', scope: 'combat',
      removeOn: 'discarded', discardReasons: ['player_choice'], remaining: 1,
      changes: [
        { kind: 'numeric', stat: 'damage', operator: 'add', value: { op: 'var', path: 'battle.turn_number' } },
        { kind: 'play_access', mode: 'deny' },
      ],
    },
  }],
};
assert.equal(core.validateEffectProgram(attachmentProgram).ok, true);
const attachmentResult = core.executeEffectProgram(attachmentProgram, state, { spentEnergy: 0 });
assert.equal(attachmentResult.ok, true);
assert.equal(attachmentResult.events[0].type, 'apply_card_attachment');
assert.equal(attachmentResult.events[0].attachment.changes[0].value, 3);
const invalidAttachment = structuredClone(attachmentProgram);
invalidAttachment.steps[0].attachment.changes[1].mode = 'sometimes';
assert.equal(core.validateEffectProgram(invalidAttachment).ok, false);

const richState = {
  ...state,
  self: { ...state.self, statusStacks: { focus: 2 } },
  cardZones: {
    hand: [
      { id: 'a', type: 'Attack', rarity: 'Common', cost: 1, tags: ['combo'], templateId: 'strike', origin: 'deck' },
      { id: 'b', type: 'Skill', rarity: 'Rare', cost: 2, tags: ['guard'], templateId: 'guard', origin: 'deck', upgraded: true },
    ],
    draw: [{ id: 'c', type: 'Attack', rarity: 'Uncommon', cost: 2, tags: ['combo'], templateId: 'strike', origin: 'generated' }],
    discard: [],
    exhaust: [],
  },
  history: { lastDamage: 9.5, lastHpLoss: 7, lastHeal: 4, lastResourceSpent: 3 },
  enemyIntentValue: 11,
};
const advancedFormula = {
  op: 'max',
  values: [
    { op: 'floor', value: { op: 'history', metric: 'last_damage' } },
    {
      op: 'multiply',
      left: {
        op: 'count_cards',
        selector: { zone: 'all', pick: 'all', filter: { types: ['Attack'], tags: ['combo'] } },
      },
      right: 4,
    },
    { op: 'intent_value' },
  ],
};
assert.equal(core.evaluateNumericExpression(advancedFormula, richState, { spentEnergy: 0 }), 11);
assert.equal(core.evaluateNumericExpression({ op: 'count_statuses', target: 'self' }, richState, { spentEnergy: 0 }), 1);
assert.equal(core.evaluateNumericExpression({ op: 'ceil', value: 2.1 }, richState, { spentEnergy: 0 }), 3);
assert.equal(core.validateEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: advancedFormula }] }).ok, true);

const defeatState = {
  ...structuredClone(state),
  opponent: { ...structuredClone(state.opponent), hp: 8, maxHp: 40, block: 99, tags: ['elite'] },
};
const excludedDefeat = core.executeEffectProgram(
  { spec: 'mwg.effect/v1', steps: [{
    op: 'execute', target: 'opponent', threshold: 25, thresholdMode: 'hp_percent', excludeTags: ['elite'],
  }] },
  defeatState,
  { spentEnergy: 0 },
);
assert.equal(excludedDefeat.state.opponent.hp, 8);
assert.equal(excludedDefeat.events[0].excludedBy, 'elite');
const successfulDefeat = core.executeEffectProgram(
  { spec: 'mwg.effect/v1', steps: [{
    op: 'execute', target: 'opponent', threshold: 25, thresholdMode: 'hp_percent', triggerFatal: true,
  }] },
  defeatState,
  { spentEnergy: 0 },
);
assert.equal(successfulDefeat.state.opponent.hp, 0);
assert.equal(successfulDefeat.state.opponent.block, 99);
assert.deepEqual(successfulDefeat.events[0], {
  type: 'defeat', target: 'opponent', method: 'execute', succeeded: true, previousHp: 8,
  threshold: 25, thresholdMode: 'hp_percent', fatal: true,
});

const source = await readFile(resolve('src/game-core/effectDsl.ts'), 'utf8');
assert.doesNotMatch(source, /from ['"].*(runtime|ui|tavern|messageVariables|jquery)/i);
assert.doesNotMatch(source, /\b(document|window|localStorage|eval|Function)\b/);

console.log('Portable structured effect DSL validation and atomic execution passed.');
