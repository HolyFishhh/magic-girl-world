import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { compileCompactEffectList, validateEffectProgramPolicy } = require(resolve('src/game-core/index.ts'));

const compile = (effects, options = {}) => {
  const result = compileCompactEffectList(effects, options);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result.value;
};
const codes = result => (result.ok ? [] : result.issues.map(issue => issue.code));

const xCost = compile([{ damage: 'spent_energy * 4' }]);
assert.equal(validateEffectProgramPolicy(xCost, { allowSpentEnergy: true, triggerPolicy: 'forbid' }).ok, true);
assert.ok(codes(validateEffectProgramPolicy(xCost, { triggerPolicy: 'forbid' })).includes('SPENT_ENERGY_NOT_ALLOWED'));
const xValue = compile([{ damage: 'x_value * 4' }]);
assert.equal(validateEffectProgramPolicy(xValue, { allowXValue: true, triggerPolicy: 'forbid' }).ok, true);
assert.ok(codes(validateEffectProgramPolicy(xValue, { allowSpentEnergy: true, triggerPolicy: 'forbid' })).includes('X_VALUE_NOT_ALLOWED'));
assert.ok(codes(validateEffectProgramPolicy(xCost, { allowXValue: true, triggerPolicy: 'forbid' })).includes('SPENT_ENERGY_NOT_ALLOWED'));

const resourceCost = compile([{ damage: 'spent_resource.stars + x_resource.stars' }]);
assert.equal(validateEffectProgramPolicy(resourceCost, {
  triggerPolicy: 'forbid',
  allowSpentResources: new Set(['stars']),
  allowXResources: new Set(['stars']),
}).ok, true);
assert.ok(codes(validateEffectProgramPolicy(resourceCost, {
  triggerPolicy: 'forbid',
  allowSpentResources: new Set(['stars']),
})).includes('X_RESOURCE_NOT_ALLOWED'));
assert.ok(codes(validateEffectProgramPolicy(resourceCost, { triggerPolicy: 'forbid' })).includes('SPENT_RESOURCE_NOT_ALLOWED'));

const statusFormula = compile([{ block: 'stacks * 2' }]);
assert.equal(validateEffectProgramPolicy(statusFormula, { allowStatusStacks: true }).ok, true);
assert.ok(codes(validateEffectProgramPolicy(statusFormula)).includes('STATUS_STACKS_NOT_ALLOWED'));

const power = compile([{ block: 4 }, { draw: 1 }], { trigger: 'turn_start' });
assert.equal(
  validateEffectProgramPolicy(power, { triggerPolicy: 'require_root', modifierPolicy: 'forbid' }).ok,
  true,
);
const recursiveDraw = compile([{ draw: 1 }], { trigger: 'on_draw' });
assert.equal(
  validateEffectProgramPolicy(recursiveDraw, { triggerPolicy: 'require_root' }).ok,
  true,
  'on_draw may draw because runtime trigger re-entry is guarded by source and trigger identity',
);
assert.ok(codes(validateEffectProgramPolicy(power, { triggerPolicy: 'forbid' })).includes('TRIGGER_NOT_ALLOWED'));
assert.ok(
  codes(validateEffectProgramPolicy(compile([{ block: 4 }]), { triggerPolicy: 'require_root' })).includes(
    'ROOT_TRIGGER_REQUIRED',
  ),
);
const statusPowerWithImmediateBenefit = compile([
  { energy: 1 },
  { apply_status: 'focus', stacks: 1 },
]);
assert.equal(
  validateEffectProgramPolicy(statusPowerWithImmediateBenefit, {
    triggerPolicy: 'require_root_or_status',
    knownStatusIds: new Set(['focus']),
  }).ok,
  true,
  'a Power may combine immediate on-play effects with installing a registered persistent status',
);
assert.ok(
  codes(validateEffectProgramPolicy(compile([{ energy: 1 }]), {
    triggerPolicy: 'require_root_or_status',
  })).includes('ROOT_TRIGGER_REQUIRED'),
  'a purely immediate Power still needs a lasting status or a real root trigger',
);

const event = compile([{ narrate: '战斗终止，返回剧情。' }]);
assert.equal(
  validateEffectProgramPolicy(event, { allowNarrate: true, requireSingleNarrate: true, triggerPolicy: 'forbid' }).ok,
  true,
);
const eventWithDamage = compile([{ narrate: '返回剧情。' }, { damage: 1 }]);
assert.ok(
  codes(
    validateEffectProgramPolicy(eventWithDamage, {
      allowNarrate: true,
      requireSingleNarrate: true,
      triggerPolicy: 'forbid',
    }),
  ).includes('SINGLE_NARRATE_REQUIRED'),
);
assert.ok(codes(validateEffectProgramPolicy(event, { triggerPolicy: 'forbid' })).includes('NARRATE_NOT_ALLOWED'));

const modifier = compile([{ modify: 'damage', add: 2 }]);
assert.equal(validateEffectProgramPolicy(modifier, { modifierPolicy: 'only' }).ok, true);
assert.ok(codes(validateEffectProgramPolicy(modifier, { modifierPolicy: 'forbid' })).includes('MODIFIER_NOT_ALLOWED'));
assert.ok(
  codes(validateEffectProgramPolicy(compile([{ block: 2 }]), { modifierPolicy: 'only' })).includes(
    'ONLY_MODIFIERS_ALLOWED',
  ),
);

const cardRule = compile([{ card_rule: 'replay', limit: 1, extra: 1 }]);
assert.equal(validateEffectProgramPolicy(cardRule, { modifierPolicy: 'only' }).ok, true);
assert.ok(codes(validateEffectProgramPolicy(cardRule, { modifierPolicy: 'forbid' })).includes('MODIFIER_NOT_ALLOWED'));
const cardValueChange = compile([{ modify_card: 'damage', add: 2, pick: 'choose' }]);
assert.ok(
  codes(validateEffectProgramPolicy(cardValueChange, { modifierPolicy: 'only' })).includes(
    'ONLY_MODIFIERS_ALLOWED',
  ),
  'one-shot card changes cannot be smuggled into passive or hold programs',
);

const knownStatus = compile([{ apply_status: 'bleed', stacks: 2 }]);
assert.equal(validateEffectProgramPolicy(knownStatus, { knownStatusIds: new Set(['bleed']) }).ok, true);
assert.ok(
  codes(validateEffectProgramPolicy(knownStatus, { knownStatusIds: new Set(['focus']) })).includes('UNKNOWN_STATUS'),
);

const generated = compile([{ add_card: 'spark' }], {
  creates: [
    {
      id: 'spark',
      name: '火花',
      type: 'Attack',
      cost: 0,
      effects: [{ damage: 'spent_energy + 1' }],
    },
  ],
});
assert.equal(
  validateEffectProgramPolicy(generated, { triggerPolicy: 'forbid' }).ok,
  true,
  'a generated fixed-cost card may read the amount it will actually pay when it is later played',
);

const generatedFixedCostXValue = compile([{ add_card: 'spark' }], {
  creates: [
    {
      id: 'spark', name: '火花', type: 'Attack', cost: 1,
      effects: [{ damage: 'x_value + 1' }],
    },
  ],
});
assert.ok(
  codes(validateEffectProgramPolicy(generatedFixedCostXValue, { triggerPolicy: 'forbid' })).includes('X_VALUE_NOT_ALLOWED'),
  'a generated fixed-cost card must not pretend that its fixed payment is an X value',
);

const scheduledX = compile([{
  schedule: 1,
  phase: 'turn_start',
  effects: { damage: 'spent_energy + 1' },
}]);
assert.ok(
  codes(validateEffectProgramPolicy(scheduledX, { allowSpentEnergy: true })).includes('SPENT_ENERGY_NOT_ALLOWED'),
  'scheduled programs cannot read a payment context that is not persisted until their due turn',
);
const scheduledXValue = compile([{
  schedule: 1,
  phase: 'turn_start',
  effects: { damage: 'x_value + 1' },
}]);
assert.ok(
  codes(validateEffectProgramPolicy(scheduledXValue, { allowXValue: true })).includes('X_VALUE_NOT_ALLOWED'),
  'scheduled programs cannot read an X value that is not persisted until their due turn',
);

const cardDestination = compile([{ card_destination: 'draw_top' }]);
assert.equal(
  validateEffectProgramPolicy(cardDestination, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowCardDestination: true,
  }).ok,
  true,
  'the immediate program of a resolving card may redirect itself',
);
assert.ok(
  codes(validateEffectProgramPolicy(cardDestination, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid',
  })).includes('CARD_DESTINATION_NOT_ALLOWED'),
  'programs without a current card cannot install a destination override',
);
const delayedCardDestination = compile([{
  schedule: 1, phase: 'turn_start', effects: { card_destination: 'hand' },
}]);
assert.ok(
  codes(validateEffectProgramPolicy(delayedCardDestination, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowCardDestination: true,
  })).includes('CARD_DESTINATION_NOT_ALLOWED'),
  'scheduled effects lose the card-resolution context before they execute',
);

const currentCardReplay = compile([{ replay_current: 2, when: 'cards_played_this_turn >= 2' }]);
assert.equal(
  validateEffectProgramPolicy(currentCardReplay, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowCurrentCardReplay: true,
  }).ok,
  true,
  'an immediate non-Power card program may request complete replays of itself',
);
assert.ok(
  codes(validateEffectProgramPolicy(currentCardReplay, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid',
  })).includes('CURRENT_CARD_REPLAY_NOT_ALLOWED'),
  'a detached program cannot request a replay of a nonexistent current card',
);
const delayedCurrentReplay = compile([{
  schedule: 1, phase: 'turn_start', effects: { replay_current: 1 },
}]);
assert.ok(
  codes(validateEffectProgramPolicy(delayedCurrentReplay, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowCurrentCardReplay: true,
  })).includes('CURRENT_CARD_REPLAY_NOT_ALLOWED'),
  'scheduled programs lose the current-card replay context before they execute',
);

const triggeredPaymentContext = compile([{ damage: 'spent_energy + 1' }], { trigger: 'turn_start' });
assert.ok(
  codes(validateEffectProgramPolicy(triggeredPaymentContext, {
    triggerPolicy: 'require_root', modifierPolicy: 'forbid', allowSpentEnergy: true,
  })).includes('SPENT_ENERGY_NOT_ALLOWED'),
  'a registered trigger cannot read the payment of the card that registered it',
);
const stancePaymentContext = compile([{
  stance: { id: 'paid_stance', name: '余能姿态', enter: { block: 'spent_energy + 1' } },
}]);
assert.ok(
  codes(validateEffectProgramPolicy(stancePaymentContext, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowSpentEnergy: true,
  })).includes('SPENT_ENERGY_NOT_ALLOWED'),
  'stored stance lifecycle programs cannot read a discarded card-payment context',
);
const orbPaymentContext = compile([{
  channel_orb: { id: 'paid_orb', name: '余能 Orb', value: 1, evoke: { damage: 'spent_energy + 1' } },
}]);
assert.ok(
  codes(validateEffectProgramPolicy(orbPaymentContext, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowSpentEnergy: true,
  })).includes('SPENT_ENERGY_NOT_ALLOWED'),
  'stored Orb programs cannot read a discarded card-payment context',
);
const synchronousChoicePayment = compile([{
  choose: 'paid_choice',
  options: [
    { id: 'attack', label: '攻击', effects: { damage: 'spent_energy + 1' } },
    { id: 'guard', label: '防御', effects: { block: 'spent_energy + 1' } },
  ],
}]);
assert.equal(
  validateEffectProgramPolicy(synchronousChoicePayment, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowSpentEnergy: true,
  }).ok,
  true,
  'a synchronous choice remains inside the current card resolution and may read its payment',
);

const directSummoner = compile([{ summoner_effects: { block: 4 } }]);
assert.ok(
  codes(validateEffectProgramPolicy(directSummoner, { modifierPolicy: 'forbid' })).includes('SUMMONER_EFFECTS_NOT_ALLOWED'),
  'ordinary cards and combatant abilities cannot pretend to have an active summon context',
);

const summonProgram = compile([{
  spawn_summon: {
    id: 'helper', name: '助手', emoji: '⚙️', max_hp: 5,
    actions: [{ id: 'support', name: '支援', effects: { summoner_effects: { block: 4 } } }],
  },
}]);
assert.equal(
  validateEffectProgramPolicy(summonProgram, { modifierPolicy: 'forbid' }).ok,
  true,
  'summoner_effects remains legal inside a real summon action',
);

const summonWithIllegalContinuousRule = compile([{
  spawn_summon: {
    id: 'broken_helper', name: '错误助手', emoji: '⚙️', max_hp: 5,
    actions: [{ id: 'bad_aura', name: '错误光环', effects: { modify: 'damage', add: 2 } }],
  },
}]);
assert.ok(
  codes(validateEffectProgramPolicy(summonWithIllegalContinuousRule, { modifierPolicy: 'forbid' })).includes('MODIFIER_NOT_ALLOWED'),
  'summon actions cannot smuggle persistent modifiers into one-shot execution',
);

const passiveOneShot = compile([{ patch_card: 'damage', add: 1, from: 'hand', pick: 'all' }]);
assert.ok(
  codes(validateEffectProgramPolicy(passiveOneShot, { modifierPolicy: 'only' })).includes('ONLY_MODIFIERS_ALLOWED'),
  'every non-modifier root is rejected from passive programs, including early-return policy branches',
);

const source = await readFile(resolve('src/game-core/effectProgramPolicy.ts'), 'utf8');
assert.doesNotMatch(source, /from ['"].*(fish|runtime|ui|tavern|jquery)/i);
assert.doesNotMatch(source, /\b(document|window|localStorage|eval|Function)\b/);

console.log('Portable effect-program policy owns trigger, context, modifier, Event, and status usage rules.');
