import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

assert.equal(
  core.contentPathToBattlePath('desireEffects.player.effects[1].status'),
  'battle.player_lust_effect.effects[1].status',
);
assert.equal(
  core.contentPathToBattlePath('desireEffects.enemy.effects[0].status'),
  'battle.enemy.lust_effect.effects[0].status',
);

const content = core.createContentPack({
  cards: [{ id: 'strike', name: '斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: [{ damage: 8 }] }],
  statuses: [{ id: 'focus', name: '专注', emoji: '✦', type: 'buff', triggers: { hold: [{ modify: 'block', add: 'stacks' }] } }],
  activeStatuses: [{ id: 'focus', stacks: 2 }],
  relics: [{ id: 'guard', name: '守护石', trigger: 'battle_start', effects: [{ block: 3 }] }],
  items: [{ id: 'tonic', name: '补剂', count: 1, effects: [{ heal: 5 }] }],
  abilities: [],
  enemy: { name: '训练靶', actions: [{ name: '攻击', effects: [{ damage: 4 }] }] },
});

assert.equal(core.validateContentPackContract(content, { requireEnemy: true, requireExecutable: true }).ok, true);

const playerLustWithoutOverflow = core.createContentPack({
  ...content,
  cards: [{ id: 'pressure', name: '欲望施压', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { lust: 8 } }],
});
const playerLustWithoutOverflowResult = core.validateContentPackContract(playerLustWithoutOverflow, {
  requireEnemy: true, requireExecutable: true,
});
assert.equal(playerLustWithoutOverflowResult.ok, false);
assert.ok(playerLustWithoutOverflowResult.issues.some(issue =>
  issue.path === 'desireEffects.player' && issue.code === 'MISSING_LUST_OVERFLOW_EFFECT',
));

const referencedLustStatusWithoutOverflow = core.createContentPack({
  ...content,
  cards: [{
    id: 'mark', name: '烙印', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { apply_status: 'pressure_mark' },
  }],
  statuses: [{
    id: 'pressure_mark', name: '欲望烙印', emoji: '◈', type: 'debuff',
    triggers: { tick: { lust: 3 } },
  }],
});
assert.ok(core.validateContentPackContract(referencedLustStatusWithoutOverflow, {
  requireEnemy: true, requireExecutable: true,
}).issues.some(issue => issue.path === 'desireEffects.player' && issue.code === 'MISSING_LUST_OVERFLOW_EFFECT'));

const unusedLustStatusDoesNotRequireOverflow = core.createContentPack({
  ...content,
  activeStatuses: [],
  statuses: [{
    id: 'unused_pressure', name: '闲置欲望烙印', emoji: '◈', type: 'debuff',
    triggers: { tick: { lust: 3 } },
  }],
});
assert.equal(core.validateContentPackContract(unusedLustStatusDoesNotRequireOverflow, {
  requireEnemy: true, requireExecutable: true,
}).ok, true, 'an unreferenced shared status must not create a false overflow requirement');

const lustCostDoesNotRequireOverflow = core.createContentPack({
  ...content,
  cards: [{
    id: 'lust_cost', name: '欲望费用', type: 'Skill', rarity: 'Common', cost: { lust: 2 }, quantity: 1,
    effects: { block: 4 },
  }],
});
assert.equal(core.validateContentPackContract(lustCostDoesNotRequireOverflow, {
  requireEnemy: true, requireExecutable: true,
}).ok, true, 'a lust payment is not a gain_lust operation');

const unreachableLustTemplateDoesNotRequireOverflow = core.createContentPack({
  ...content,
  cards: [{
    id: 'template_holder', name: '模板容器', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { block: 4 },
    creates: [{ id: 'unused_lust_template', name: '未调用模板', type: 'Skill', rarity: 'Common', cost: 0, effects: { lust: 9 } }],
  }],
});
assert.equal(core.validateContentPackContract(unreachableLustTemplateDoesNotRequireOverflow, {
  requireEnemy: true, requireExecutable: true,
}).ok, true, 'creates entries are inert until a reachable card operation references them');

const activeLustStatusWithoutOverflow = core.createContentPack({
  ...content,
  statuses: [{ id: 'active_pressure', name: '活动欲望', emoji: '◈', type: 'debuff', triggers: { tick: { lust: 3 } } }],
  activeStatuses: [{ id: 'active_pressure', stacks: 1 }],
});
assert.ok(core.validateContentPackContract(activeLustStatusWithoutOverflow, {
  requireEnemy: true, requireExecutable: true,
}).issues.some(issue => issue.path === 'desireEffects.player' && issue.code === 'MISSING_LUST_OVERFLOW_EFFECT'),
'an active status must be resolved through its id before checking its triggers');

const summonStatusLustWithoutOverflow = core.createContentPack({
  ...content,
  cards: [{
    id: 'mark_summon', name: '召唤烙印', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { apply_summon_status: { selector: { owner: 'self', pick: 'all' }, id: 'summon_pressure', stacks: 1 } },
  }],
  statuses: [{ id: 'summon_pressure', name: '使魔欲望', emoji: '◈', type: 'debuff', triggers: { tick: { lust: 3 } } }],
});
assert.ok(core.validateContentPackContract(summonStatusLustWithoutOverflow, {
  requireEnemy: true, requireExecutable: true,
}).issues.some(issue => issue.path === 'desireEffects.player' && issue.code === 'MISSING_LUST_OVERFLOW_EFFECT'),
'apply_summon_status must follow its id into the referenced status');

const spawnedEnemyLustWithoutOverflow = core.createContentPack({
  ...content,
  cards: [{
    id: 'call_enemy', name: '召来魅影', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { spawn_enemy: {
      id: 'spawned_wisp', name: '增援魅影', emoji: '👁️', hp: 10, max_hp: 10, lust: 0, max_lust: 100,
      actions: [{ name: '侵蚀', effects: { lust: 5 } }],
    } },
  }],
});
assert.ok(core.validateContentPackContract(spawnedEnemyLustWithoutOverflow, {
  requireEnemy: true, requireExecutable: true,
}).issues.some(issue => issue.path === 'cards[0].effects.spawn_enemy.lust_effect'
  && issue.code === 'MISSING_LUST_OVERFLOW_EFFECT'), 'spawned enemies receive their own precisely located overflow requirement');

const playerAndSpawnedEnemyBothRequireOverflow = core.createContentPack({
  ...spawnedEnemyLustWithoutOverflow,
  cards: [{
    ...spawnedEnemyLustWithoutOverflow.cards[0],
    effects: [{ lust: 4 }, spawnedEnemyLustWithoutOverflow.cards[0].effects],
  }],
});
const playerAndSpawnedEnemyBothIssues = core.validateContentPackContract(playerAndSpawnedEnemyBothRequireOverflow, {
  requireEnemy: true, requireExecutable: true,
}).issues;
assert.ok(playerAndSpawnedEnemyBothIssues.some(issue => issue.path === 'desireEffects.player'
  && issue.code === 'MISSING_LUST_OVERFLOW_EFFECT'));
assert.ok(playerAndSpawnedEnemyBothIssues.some(issue => issue.path === 'cards[0].effects[1].spawn_enemy.lust_effect'
  && issue.code === 'MISSING_LUST_OVERFLOW_EFFECT'), 'a player pressure finding must not short-circuit spawned-enemy coverage');

const enemyLustWithoutOverflow = core.createContentPack({
  ...content,
  enemy: { name: '魅影', actions: [{ name: '侵蚀', effects: { lust: 7 } }] },
});
assert.ok(core.validateContentPackContract(enemyLustWithoutOverflow, {
  requireEnemy: true, requireExecutable: true,
}).issues.some(issue => issue.path === 'enemy.lust_effect' && issue.code === 'MISSING_LUST_OVERFLOW_EFFECT'));

const completeLustCoverage = core.createContentPack({
  ...playerLustWithoutOverflow,
  playerDesireEffect: { name: '满溢反击', effects: { damage: 12 } },
  enemy: {
    name: '魅影', actions: [{ name: '侵蚀', effects: { lust: 7 } }],
    lust_effect: { name: '失控拥抱', effects: { damage: 12 } },
  },
});
assert.equal(core.validateContentPackContract(completeLustCoverage, {
  requireEnemy: true, requireExecutable: true,
}).ok, true);

const inertCurseContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'sealed_fragment', name: '封印残片', type: 'Curse', rarity: 'Corrupt', quantity: 2,
    description: '无法被打出，只会占据手牌位置。',
  }],
});
assert.equal(
  core.validateContentPackContract(inertCurseContent, { requireEnemy: true, requireExecutable: true }).ok,
  true,
  'an inert Curse is executable through its unplayable card-type rule and may omit effects',
);
const invalidInertAttackContent = core.createContentPack({
  ...content,
  cards: [{ id: 'empty_attack', name: '空攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1 }],
});
assert.equal(
  core.validateContentPackContract(invalidInertAttackContent, { requireEnemy: true, requireExecutable: true }).ok,
  false,
  'non-Curse cards still require executable effects or a legal Power trigger',
);
const invalidCurseEffectContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'false_story_curse', name: '伪叙事诅咒', type: 'Curse', rarity: 'Corrupt', quantity: 1,
    effects: { narrate: '不能用叙事冒充诅咒机制。' },
  }],
});
assert.equal(
  core.validateContentPackContract(invalidCurseEffectContent, { requireEnemy: true, requireExecutable: true }).ok,
  false,
  'a Curse that authors effects must pass the ordinary DSL instead of bypassing validation',
);

const inertGeneratedCurseContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'seal_writer', name: '封印写入', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { add_card: 'sealed_token', to: 'hand' },
    creates: [{
      id: 'sealed_token', name: '封印碎片', type: 'Curse', rarity: 'Corrupt',
      description: '无法被打出，只会占据手牌位置。',
    }],
  }],
});
assert.equal(
  core.validateContentPackContract(inertGeneratedCurseContent, { requireEnemy: true, requireExecutable: true }).ok,
  true,
  'creates templates use the same inert-Curse exception as persistent cards',
);

for (const [label, mutate, expectedPath] of [
  ['card wrapper', pack => { pack.cards[0].cooldown = 2; }, 'cards[0].cooldown'],
  ['relic wrapper', pack => { pack.relics[0].cooldown = 2; }, 'relics[0].cooldown'],
  ['item wrapper', pack => { pack.items[0].cooldown = 2; }, 'items[0].cooldown'],
  ['enemy action wrapper', pack => { pack.enemy.actions[0].cooldown = 2; }, 'enemy.actions[0].cooldown'],
  ['enemy desire wrapper', pack => { pack.enemy.lust_effect = { name: '失控', effects: { damage: 1 }, cooldown: 2 }; }, 'enemy.lust_effect.cooldown'],
]) {
  const candidate = structuredClone(content);
  mutate(candidate);
  const result = core.validateContentPackContract(candidate, { requireEnemy: true, requireExecutable: true });
  assert.equal(result.ok, false, `${label} must not silently discard an unknown executable field`);
  assert.ok(result.issues.some(issue => issue.path === expectedPath && issue.code === 'UNKNOWN_FIELD'));
}

const conditionalNamedEffectContent = structuredClone(content);
conditionalNamedEffectContent.desireEffects.player = {
  name: '临界反击', when: 'self.hp < self.max_hp / 2', effects: { damage: 3 },
};
assert.equal(
  core.validateContentPackContract(conditionalNamedEffectContent, { requireEnemy: true, requireExecutable: true }).ok,
  true,
  'the canonical named-effect when field must pass the direct MVU content contract',
);

const passivePowerContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'echo_form', name: '回响形态', type: 'Power', rarity: 'Rare', cost: 2, quantity: 1,
    trigger: { on: 'passive', effects: { card_rule: 'replay', limit: 1, extra: 1 } },
  }],
});
assert.equal(
  core.validateContentPackContract(passivePowerContent, { requireEnemy: true, requireExecutable: true }).ok,
  true,
  'Power cards may register a passive continuous rule when played',
);
const immediateAndTriggeredPowerContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'guarded_echo', name: '护持回响', type: 'Power', rarity: 'Rare', cost: 2, quantity: 1,
    effects: { block: 5 },
    trigger: { on: 'turn_start', effects: { block: 2 } },
  }],
});
assert.equal(
  core.validateContentPackContract(immediateAndTriggeredPowerContent, { requireEnemy: true, requireExecutable: true }).ok,
  true,
  'Power cards may combine one on-play effect with a separately registered event ability',
);
const invalidCurrentReplayPowerContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'invalid_current_replay_power', name: '错误能力重放', type: 'Power', rarity: 'Rare', cost: 2, quantity: 1,
    effects: [{ block: 5 }, { replay_current: 1 }],
    trigger: { on: 'turn_start', effects: { block: 2 } },
  }],
});
const invalidCurrentReplayPowerResult = core.validateContentPackContract(invalidCurrentReplayPowerContent, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(invalidCurrentReplayPowerResult.ok, false);
assert.ok(invalidCurrentReplayPowerResult.issues.some(issue => (
  issue.path === 'cards[0].effects[1]' && issue.code === 'CURRENT_CARD_REPLAY_NOT_ALLOWED'
)));
const invalidPassivePowerContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'bad_echo_form', name: '错误回响', type: 'Power', rarity: 'Rare', cost: 2, quantity: 1,
    trigger: { on: 'passive', effects: { damage: 9 } },
  }],
});
const invalidPassivePowerResult = core.validateContentPackContract(invalidPassivePowerContent, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(invalidPassivePowerResult.ok, false);
assert.ok(invalidPassivePowerResult.issues.some(issue => (
  issue.path === 'cards[0].trigger.effects' && issue.code === 'ONLY_MODIFIERS_ALLOWED'
)));

const independentlyBrokenPowerSources = core.createContentPack({
  ...content,
  cards: [{
    id: 'broken_two_sources', name: '双路径错误', type: 'Power', rarity: 'Rare', cost: 1, quantity: 1,
    effects: [{ damage: 1, extra: true }],
    trigger: {
      on: 'passive',
      effects: { card_rule: 'free', limit: 1, card_type: 'Skill', when: 'self.has_buff' },
    },
  }],
});
const independentlyBrokenPowerResult = core.validateContentPackContract(independentlyBrokenPowerSources, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(independentlyBrokenPowerResult.ok, false);
assert.ok(independentlyBrokenPowerResult.issues.some(issue => (
  issue.path === 'cards[0].effects[0].extra' && issue.code === 'UNKNOWN_FIELD'
)));
assert.ok(independentlyBrokenPowerResult.issues.some(issue => (
  issue.path === 'cards[0].trigger.effects.when' && issue.code === 'UNKNOWN_FIELD'
)), 'an invalid immediate source must not hide an independently invalid trigger source from the only repair pass');

const redundantFirstOrdinalContent = core.createContentPack({
  ...content,
  abilities: [{
    id: 'first_attack_energy', name: '首次攻击充能',
    trigger: { on: 'attack_played', scope: 'turn', ordinal: 'first', n: 1, effects: { energy: 1 } },
  }],
});
const redundantFirstOrdinalResult = core.validateContentPackContract(redundantFirstOrdinalContent, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(redundantFirstOrdinalResult.ok, false);
assert.ok(redundantFirstOrdinalResult.issues.some(issue => (
  issue.path === 'abilities[0].trigger.n' && issue.code === 'INVALID_EVENT_ORDINAL'
)), 'public diagnostics must point to trigger.n instead of the internal eventQuery path');

const generatedPowerTemplateContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'signal_maker', name: '信标制造', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { add_card: 'signal_power', to: 'hand' },
    creates: [{
      id: 'signal_power', name: '信标', type: 'Power', rarity: 'Uncommon', cost: 1,
      trigger: { on: 'passive', effects: [{ apply_status: 'focus', stacks: 1 }] },
    }],
  }],
});
const generatedPowerTemplateResult = core.validateContentPackContract(generatedPowerTemplateContent, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(generatedPowerTemplateResult.ok, false);
assert.ok(generatedPowerTemplateResult.issues.some(issue => (
  issue.path === 'cards[0].creates[0].trigger.effects[0]' && issue.code === 'ONLY_MODIFIERS_ALLOWED'
)));
assert.equal(
  generatedPowerTemplateResult.issues.some(issue => issue.path.includes('.card.program.steps')),
  false,
  'public contract errors must never expose the internal generated-card AST path',
);

const directStatusPowerTemplateContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'status_maker', name: '状态制造', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
    effects: { add_card: 'status_power', to: 'hand' },
    creates: [{
      id: 'status_power', name: '状态能力', type: 'Power', rarity: 'Uncommon', cost: 1,
      effects: [{ apply_status: 'focus', stacks: 1, to: 'self' }],
    }],
  }],
});
assert.equal(
  core.validateContentPackContract(directStatusPowerTemplateContent, {
    requireEnemy: true,
    requireExecutable: true,
  }).ok,
  true,
  'a Power may apply one registered persistent status from its root on-play effects',
);
const nullOptionalTriggerStatusPowerContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'nullable_status_power', name: '空触发状态能力', type: 'Power', rarity: 'Uncommon', cost: 1, quantity: 1,
    effects: [{ apply_status: 'focus', stacks: 1, to: 'self' }],
    trigger: null,
  }],
});
assert.equal(
  core.validateContentPackContract(nullOptionalTriggerStatusPowerContent, {
    requireEnemy: true,
    requireExecutable: true,
  }).ok,
  true,
  'a schema transport null for an unused optional trigger is canonicalized to omission',
);
const statusPowerWithImmediateBenefitContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'charged_status_power', name: '充能状态能力', type: 'Power', rarity: 'Uncommon', cost: 1, quantity: 1,
    effects: [
      { energy: 1, to: 'self' },
      { apply_status: 'focus', stacks: 1, to: 'self' },
    ],
  }],
});
assert.equal(
  core.validateContentPackContract(statusPowerWithImmediateBenefitContent, {
    requireEnemy: true,
    requireExecutable: true,
  }).ok,
  true,
  'a Power that installs a registered persistent status may also resolve immediate on-play effects',
);
const filteredPassivePowerContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'filtered_echo_form', name: '错误筛选回响', type: 'Power', rarity: 'Rare', cost: 2, quantity: 1,
    trigger: {
      on: 'passive', scope: 'turn', ordinal: 'first',
      effects: { card_rule: 'replay', limit: 1, extra: 1 },
    },
  }],
});
const passivePowerWithEmptyOptionalRootContent = core.createContentPack({
  ...content,
  cards: [{
    id: 'empty_root_echo', name: '空根回响', type: 'Power', rarity: 'Uncommon', cost: 1, quantity: 1,
    effects: [],
    trigger: { on: 'turn_start', effects: { block: 2 } },
  }],
});
assert.equal(
  core.validateContentPackContract(passivePowerWithEmptyOptionalRootContent, {
    requireEnemy: true,
    requireExecutable: true,
  }).ok,
  true,
  'an empty optional root effect beside a valid structured trigger is equivalent to omission',
);
const normalizedOverflowEffect = core.normalizeCompactNamedEffectInput({
  name: '满溢',
  effects: { damage: 5 },
  when: 'lust >= max_lust',
}, '欲望满溢');
assert.equal(normalizedOverflowEffect.when, undefined, 'the desire lifecycle already guarantees the bare overflow guard');
assert.equal(normalizedOverflowEffect.effects.damage, 5);
const filteredPassivePowerResult = core.validateContentPackContract(filteredPassivePowerContent, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(filteredPassivePowerResult.ok, false);
assert.ok(filteredPassivePowerResult.issues.some(issue => issue.code === 'PASSIVE_TRIGGER_FILTER_NOT_ALLOWED'));

const structuredPassiveEnemyAbility = core.createContentPack({
  ...content,
  enemy: {
    name: '巡卫',
    actions: [{ name: '压杀', effects: [{ damage: 4 }] }],
    abilities: [{
      id: 'rail_pressure',
      name: '轨压',
      trigger: { on: 'passive', effects: [{ modify: 'damage', add: 1 }] },
    }],
  },
});
assert.equal(
  core.validateContentPackContract(structuredPassiveEnemyAbility, {
    requireEnemy: true,
    requireExecutable: true,
  }).ok,
  true,
  'enemy abilities must accept the same structured passive trigger used by player abilities and relics',
);

const invalidTimedEnemyModifier = core.createContentPack({
  ...structuredPassiveEnemyAbility,
  enemy: {
    ...structuredPassiveEnemyAbility.enemy,
    abilities: [{
      id: 'invalid_timed_modifier',
      name: '错误时序',
      trigger: { on: 'turn_start', effects: [{ modify: 'damage', add: 1 }] },
    }],
  },
});
const invalidTimedEnemyModifierResult = core.validateContentPackContract(invalidTimedEnemyModifier, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(invalidTimedEnemyModifierResult.ok, false);
assert.ok(invalidTimedEnemyModifierResult.issues.some(issue => issue.code === 'MODIFIER_NOT_ALLOWED'));

const malformed = core.createContentPack({
  ...content,
  cards: [{ id: 'bad', effects: [{ damage: 'unknown()' }] }],
});
const malformedResult = core.validateContentPackContract(malformed, { requireEnemy: true, requireExecutable: true });
assert.equal(malformedResult.ok, false);
assert.match(core.formatContentContractIssues(malformedResult.issues), /cards\[0\]\.effects/);

const fixedEnergyContext = core.createContentPack({
  ...content,
  cards: [{
    id: 'paid_strike', name: '蓄力斩', type: 'Attack', rarity: 'Common', cost: 2, quantity: 1,
    effects: { damage: 'spent_energy * 4' },
  }],
});
assert.equal(
  core.validateContentPackContract(fixedEnergyContext, { requireEnemy: true, requireExecutable: true }).ok,
  true,
  'fixed-cost cards have a real spent-energy context and may read the amount paid',
);
const fixedEnergyPretendsX = core.createContentPack({
  ...content,
  cards: [{
    id: 'false_x', name: '伪 X 斩', type: 'Attack', rarity: 'Common', cost: 2, quantity: 1,
    effects: { damage: 'x_value * 4' },
  }],
});
const fixedEnergyPretendsXResult = core.validateContentPackContract(fixedEnergyPretendsX, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(fixedEnergyPretendsXResult.ok, false);
assert.ok(fixedEnergyPretendsXResult.issues.some(issue => issue.code === 'X_VALUE_NOT_ALLOWED'));
const trueXEnergyContext = core.createContentPack({
  ...content,
  cards: [{
    id: 'true_x', name: 'X 斩', type: 'Attack', rarity: 'Common', cost: 'energy', quantity: 1,
    effects: { damage: 'x_value * 4 + spent_energy' },
  }],
});
assert.equal(
  core.validateContentPackContract(trueXEnergyContext, { requireEnemy: true, requireExecutable: true }).ok,
  true,
  'energy-X cards may read both the resolved X value and actual energy payment',
);

const duplicate = core.createContentPack({
  ...content,
  cards: [
    { id: 'same', effects: [{ damage: 1 }] },
    { id: 'same', effects: [{ block: 1 }] },
  ],
});
const duplicateResult = core.validateContentPackContract(duplicate, { requireEnemy: true, requireExecutable: true });
assert.equal(duplicateResult.ok, false);
assert.ok(duplicateResult.issues.some(issue => issue.code === 'DUPLICATE_ID'));

const persistentOwnedCopies = core.createContentPack({
  ...content,
  cards: [
    {
      id: 'same_owned_card', runInstanceId: 'same_owned_card__run__1', name: '鎸佷箙鍓湰 1',
      type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: [{ damage: 1 }],
    },
    {
      id: 'same_owned_card', runInstanceId: 'same_owned_card__run__2', name: '鎸佷箙鍓湰 2',
      type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: [{ damage: 1 }],
    },
  ],
});
assert.equal(
  core.validateContentPackContract(persistentOwnedCopies, { requireEnemy: true, requireExecutable: true }).ok,
  true,
  'one record per owned card may share a template id when every run identity is unique',
);

const duplicateOwnedIdentity = core.createContentPack({
  ...persistentOwnedCopies,
  cards: persistentOwnedCopies.cards.map(card => ({ ...card, runInstanceId: 'same_owned_card__run__1' })),
});
const duplicateOwnedIdentityResult = core.validateContentPackContract(duplicateOwnedIdentity, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(duplicateOwnedIdentityResult.ok, false);
assert.ok(duplicateOwnedIdentityResult.issues.some(issue => issue.code === 'DUPLICATE_RUN_INSTANCE_ID'));

const incompleteModern = core.createContentPack({
  ...content,
  cards: [{ id: 'bad_card', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 3 }, innate: 'true' }],
  relics: [{ id: 'bad_relic', name: '无触发遗物', rarity: 'Common', effects: { block: 2 } }],
});
const incompleteResult = core.validateContentPackContract(incompleteModern, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(incompleteResult.ok, false);
assert.ok(incompleteResult.issues.some(issue => issue.path === 'cards[0].name' && issue.code === 'INVALID_NAME'));
assert.ok(incompleteResult.issues.some(issue => issue.path === 'cards[0].innate' && issue.code === 'INVALID_BOOLEAN'));
assert.ok(incompleteResult.issues.some(issue => issue.path === 'relics[0].trigger' && issue.code === 'MISSING_TRIGGER'));

const lifecycleContent = core.createContentPack({
  ...content,
  relics: [
    { id: 'draw_guard', name: '抽牌护幕', rarity: 'Uncommon', trigger: 'on_draw', effects: { block: 1 } },
    { id: 'recycle_focus', name: '回洗专注', rarity: 'Rare', trigger: 'on_shuffle', effects: { energy: 1 } },
  ],
});
assert.equal(
  core.validateContentPackContract(lifecycleContent, { requireEnemy: true, requireExecutable: true }).ok,
  true,
);
const recursiveDrawContent = core.createContentPack({
  ...content,
  relics: [{ id: 'loop', name: '循环', rarity: 'Rare', trigger: 'on_draw', effects: { draw: 1 } }],
});
const recursiveDrawResult = core.validateContentPackContract(recursiveDrawContent, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(recursiveDrawResult.ok, true, 'draw triggers are executable under the runtime re-entry guard');

const removedDiscardPayment = core.createContentPack({
  ...content,
  cards: [{ id: 'old_payment', name: '旧弃牌费用', type: 'Attack', rarity: 'Common', cost: 1, discard_requirement: 1, effects: { damage: 8 } }],
});
const removedDiscardPaymentResult = core.validateContentPackContract(removedDiscardPayment, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(removedDiscardPaymentResult.ok, false);
assert.ok(removedDiscardPaymentResult.issues.some(issue => issue.code === 'REMOVED_CARD_FIELD'));

const malformedEntryPack = core.createContentPack({ ...content, cards: ['bad-entry', content.cards[0]] });
const malformedEntryResult = core.validateContentPackContract(malformedEntryPack, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(malformedEntryResult.ok, false);
assert.equal(malformedEntryResult.issues[0].path, 'cards[0]');

let contractError = null;
try {
  core.createBattleRequest({ content: malformed, player: { hp: 10, maxHp: 20, lust: 0, maxLust: 100, level: 1 } });
} catch (error) {
  contractError = error;
}
assert.ok(contractError instanceof core.BattleContentContractError);
assert.match(contractError.message, /battle content contract is invalid/);
assert.ok(contractError.issues.some(issue => issue.path.startsWith('cards[0].effects')));

for (const value of ['0', '-1', 0, -1]) {
  const pack = core.createContentPack({ cards: [{ id: 'no_increase', name: '归零', type: 'Skill', rarity: 'Common', cost: 0, effects: { lust: value } }] });
  const result = core.validateContentPackContract(pack);
  assert.equal(result.ok || !result.issues.some(issue => issue.code === 'MISSING_LUST_OVERFLOW_EFFECT'), true, 'zero and negative literal gains do not require overflow');
}
const initialAcquireBase = {
  id: 'initial_acquire', name: '初始结算遗物', rarity: 'Rare',
  on_acquire: { cost: { resources: { missing_charge: 1 } } },
};
const initialAcquireUnknownResource = core.validateContentPackContract(core.createContentPack({
  relics: [initialAcquireBase], playerResources: [{ id: 'known_charge', name: '已知', max: 3, start: 1 }],
}), { requireExecutable: true });
assert.equal(initialAcquireUnknownResource.ok, false);
assert.ok(initialAcquireUnknownResource.issues.some(issue => issue.path === 'relics[0].on_acquire' && /未注册资源.*missing_charge/.test(issue.message)));
for (const [field, settlement] of [
  ['gain_cards', { gain_cards: [{ id: 'bad_gain', name: '坏赠卡', type: 'Skill', rarity: 'Common', cost: { missing_charge: 1 }, effects: { block: 1 } }] }],
  ['grant', { grant: { cards: [{ id: 'bad_grant', name: '坏候选', type: 'Skill', rarity: 'Common', cost: { missing_charge: 1 }, effects: { block: 1 } }], items: [], limits: { cards: 1, items: 0 } } }],
  ['transform', { deck_actions: [{ id: 'bad_transform', kind: 'transform', count: 1, pick: 'choose', replacement: { id: 'bad_replace', name: '坏替换', type: 'Skill', rarity: 'Common', cost: { missing_charge: 1 }, effects: { block: 1 } } }] }],
]) {
  const result = core.validateContentPackContract(core.createContentPack({
    relics: [{ ...initialAcquireBase, on_acquire: settlement }], playerResources: [{ id: 'known_charge', name: '已知', max: 3, start: 1 }],
  }), { requireExecutable: true });
  assert.equal(result.ok, false, `${field} must be validated before an initial pending receipt is written`);
  assert.ok(result.issues.some(issue => issue.path === 'relics[0].on_acquire' && /missing_charge/.test(issue.message)));
}
const externalAcquisitionStatus = { id: 'existing_acquire_mark', name: '既有印记', emoji: '◈', type: 'debuff', triggers: { tick: { damage: 1 } } };
const externalAcquisition = core.validateContentPackContract(core.createContentPack({
  relics: [{
    id: 'external_status_relic', name: '外部状态遗物', rarity: 'Rare', on_acquire: {
      gain_cards: [{ id: 'status_gift', name: '印记赠卡', type: 'Skill', rarity: 'Common', cost: 0, effects: { apply_status: 'existing_acquire_mark' } }],
    },
  }],
}), { requireExecutable: true, referenceStatusDefinitions: [externalAcquisitionStatus] });
assert.equal(externalAcquisition.ok, true, 'nested acquisition candidates inherit the surrounding status library');
console.log('Portable content contract validates modern effects once and protects every BattleRequest host.');
