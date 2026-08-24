import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

assert.equal(new Set(core.ABILITY_TRIGGERS).size, core.ABILITY_TRIGGERS.length);
assert.equal(new Set(core.STATUS_TRIGGERS).size, core.STATUS_TRIGGERS.length);
assert.equal(core.normalizeAbilityTrigger(' CARD_PLAYED '), 'card_played');
for (const removedAlias of [
  'on_card_played',
  'on_attack_played',
  'on_skill_played',
  'on_power_played',
  'on_take_damage',
  'card_discarded',
  'card_exhausted',
  'card_drawn',
  'deck_shuffled',
]) assert.equal(core.normalizeAbilityTrigger(removedAlias), null);
assert.equal(core.REGISTERABLE_EFFECT_TRIGGER_SET.has('on_exhaust'), true);
assert.equal(core.REGISTERABLE_EFFECT_TRIGGER_SET.has('on_draw'), true);
assert.equal(core.REGISTERABLE_EFFECT_TRIGGER_SET.has('on_shuffle'), true);
assert.deepEqual(core.resolvePlayedCardTriggers('Attack'), ['card_played', 'attack_played']);
assert.deepEqual(core.resolvePlayedCardTriggers('Skill'), ['card_played', 'skill_played']);
assert.deepEqual(core.resolvePlayedCardTriggers('Power'), ['card_played', 'power_played']);
assert.deepEqual(core.resolvePlayedCardTriggers('Event'), ['card_played']);
assert.deepEqual(core.resolvePlayedCardTriggers(null), ['card_played']);
assert.equal(core.normalizeAbilityTrigger('tick'), null);
assert.equal(core.isStatusTrigger(' STACK '), true);
assert.equal(core.isStatusTrigger('turn_start'), false);

assert.equal(core.REGISTERABLE_EFFECT_TRIGGER_SET.has('battle_start'), false);
assert.equal(core.REGISTERABLE_EFFECT_TRIGGER_SET.has('passive'), false);
for (const trigger of core.ABILITY_TRIGGERS) {
  assert.equal(
    core.REGISTERABLE_EFFECT_TRIGGER_SET.has(trigger),
    trigger !== 'battle_start' && trigger !== 'passive',
    `${trigger} registerability must match its lifecycle role`,
  );
}

assert.deepEqual(core.resolveStatusOwnershipTriggers('buff', 'gain'), {
  owner: 'gain_buff',
  observer: 'enemy_gain_buff',
});
assert.deepEqual(core.resolveStatusOwnershipTriggers('debuff', 'lose'), {
  owner: 'lose_debuff',
  observer: 'enemy_lose_debuff',
});
assert.equal(core.resolveStatusOwnershipTriggers('neutral', 'gain'), null);

const triggerConsumers = await Promise.all(
  [
    'src/game-core/effectDsl.ts',
    'src/game-core/compactEffectDsl.ts',
    'src/game-core/rewardCandidateValidation.ts',
    'src/game-core/statusDefinitionValidation.ts',
    'src/fish/combat/effectDefinitions.ts',
    'src/game-core/statusDefinitionRuntime.ts',
    'src/game-core/statusLifecycleRuntime.ts',
    'src/fish/core/battleTriggerHost.ts',
  ].map(path => readFile(resolve(path), 'utf8')),
);
for (const source of triggerConsumers.slice(0, 4)) {
  assert.match(source, /from '.\/battleTriggers'/, 'core consumers must read the shared trigger catalog');
}
assert.match(triggerConsumers[4], /from '\.\.\/\.\.\/game-core\/battleTriggers'/);
assert.match(triggerConsumers[5], /STATUS_TRIGGERS/);
assert.match(triggerConsumers[6], /resolveStatusOwnershipTriggerDispatch/);
assert.doesNotMatch(
  triggerConsumers[7],
  /resolveStatusOwnershipTriggerDispatch|resolveStatusOwnershipTriggers\(/,
  'the Tavern trigger host must delegate status ownership routing to the portable lifecycle',
);
for (const source of triggerConsumers.slice(0, 4)) {
  assert.doesNotMatch(
    source,
    /new Set(?:<[^>]+>)?\(\[\s*'battle_start'/,
    'core consumers must not recreate the ability trigger catalog',
  );
  assert.doesNotMatch(
    source,
    /new Set(?:<[^>]+>)?\(\[\s*'apply'\s*,\s*'stack'/,
    'core consumers must not recreate the status trigger catalog',
  );
}

const registeredBattleStart = core.compileCompactEffectList([{ block: 5 }], { trigger: 'battle_start' });
assert.equal(registeredBattleStart.ok, false, 'outer lifecycle triggers must not compile as nested AST registrations');
assert.equal(
  core.validateRewardCandidate('artifacts', {
    id: 'life_stone',
    name: '生命之石',
    rarity: 'Common',
    trigger: 'battle_start',
    effects: [{ block: 5 }],
  }).ok,
  true,
  'relics may still use battle_start as their outer lifecycle trigger',
);

console.log('One portable trigger catalog owns canonical lifecycle boundaries and status ownership events.');
