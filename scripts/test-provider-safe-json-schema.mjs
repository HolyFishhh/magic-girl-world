import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
import './test-provider-effect-context.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const {
  createTowerInitialContentJsonSchema,
  createTowerInitialRootRepairJsonSchema,
  createTowerInitialSlotRepairJsonSchema,
  createTowerNodeBatchJsonSchema,
  createTowerNodeJsonSchema,
  createTowerOpeningJsonSchema,
} = require(resolve('src/game-core/towerRequest.ts'));
const {
  createGlobalTowerGenerationPorts,
  createProviderSafeJsonSchema,
} = require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));
const { createInitialDraftJsonSchema } = require(resolve('src/game-core/initialDraftSchema.ts'));
const { createInitialDraftRegistryRepairJsonSchema } = require(resolve('src/game-core/initialDraftRepair.ts'));

const registrySchema = createInitialDraftJsonSchema({ includeNarrative: false });
const registryRepairSchema = createInitialDraftRegistryRepairJsonSchema({ slots: [
  { token: 'r0', kind: 'templates', id: 'spark', references: [['player', 'cards', 0, 'effects', 0, 'add_card']] },
] });
for (const source of [registrySchema, registryRepairSchema]) {
  const projected = createProviderSafeJsonSchema(source);
  assert.equal(JSON.stringify(projected.value).includes('"creates"'), false, 'finite summon/effect outlines cannot reintroduce inline draft templates');
  assert.deepEqual(projected.value.required, source.value.required);
  assert.equal(JSON.stringify(projected.value).includes('"$ref"'), false);
}
const registryTransport = createProviderSafeJsonSchema(registrySchema);
assert.deepEqual(registryTransport.value.properties.registry.required, ['statuses', 'resources', 'templates']);
assert.equal(registryTransport.value.properties.narrative, undefined);
assert.equal(registryTransport.value.properties.player.properties.statuses, undefined);
assert.equal(registryTransport.value.properties.player.properties.core.properties.resources, undefined);
assert.equal(registryTransport.value.properties.spec.const, 'mwg.initial-draft/v1');

const job = {
  nodeId: 'act-1-floor-2-col-1',
  requestId: 'request-1',
  basedOnRevision: 3,
  kind: 'battle',
  act: 1,
  floor: 2,
  contentSeed: 11,
  rewardSeed: 12,
  difficultyMultiplier: 1,
};
const schemas = [
  createTowerInitialContentJsonSchema(),
  createTowerInitialRootRepairJsonSchema([
    { token: 'r0', kind: 'opening_choice', preserveId: 'gift_alpha' },
    { token: 'r1', kind: 'player_ability', preserveId: 'ability_alpha', nullable: true },
  ]),
  createTowerInitialSlotRepairJsonSchema([{
    token: 'r0',
    slots: [
      { token: 's0', kind: 'status_trigger_effect_item', action: 'replace_effect' },
      { token: 's1', kind: 'status_hold_effect_item', action: 'replace_effect' },
      { token: 's2', kind: 'resource_payment_strategy', action: 'replace_value', preserveId: 'charge' },
      { token: 's3', kind: 'status_next_attack_modifier_strategy', action: 'replace_trigger', preserveId: 'hardening' },
      {
        token: 's4', kind: 'card_quantity_strategy', action: 'replace_value', preserveId: 'placeholder',
        allowedModes: ['set_owned_quantity', 'remove_unowned_card'],
      },
      { token: 's5', kind: 'unknown_effect_item_strategy', action: 'replace_effect' },
      { token: 's6', kind: 'skill_trigger_classification_strategy', action: 'replace_value', preserveId: 'loop' },
      { token: 's7', kind: 'condition_alias_strategy', action: 'replace_value', allowedModes: ['use_when_condition'] },
      { token: 's8', kind: 'add_card_destination', action: 'replace_value' },
    ],
  }]),
  createTowerOpeningJsonSchema(),
  createTowerNodeJsonSchema('battle', { nodeId: job.nodeId, act: job.act, floor: job.floor }),
  createTowerNodeBatchJsonSchema('batch-1', [job]),
];

// The provider outline is not the gameplay contract. DeepSeek's SillyTavern
// adapter appends it as ordinary prompt text, so keep this duplicate transport
// description bounded while the complete public mechanics contract remains in
// the natural-language request and runtime validator.
// Protection metadata is repeated at status/ability/spawn sites. Keep its
// public shape and explanations rather than silently dropping new mechanics.
const PROVIDER_SCHEMA_BUDGET = 66_000;
// Full initial authoring combines player mechanics, three gifts and deck
// transforms. Keep a separate measured cap without dropping any grammar:
// 1.0.2 baseline ~77k, six independent repair roots ~73k. Node caps stay 66k.
const INITIAL_SCHEMA_BUDGET = 80_000;

for (const schema of schemas) {
  const transport = createProviderSafeJsonSchema(schema);
  assert.ok(transport);
  const serialized = JSON.stringify(transport);
  const budget = schema.name === 'mwg_tower_single_floor_initial_content' ? INITIAL_SCHEMA_BUDGET : PROVIDER_SCHEMA_BUDGET;
  assert.ok(serialized.length < budget, `${schema.name} transport schema is still too large: ${serialized.length}`);
  assert.equal(serialized.includes('"$ref"'), false, `${schema.name} still contains a reference`);
  assert.equal(serialized.includes('"$defs"'), false, `${schema.name} still contains definitions`);
  assert.deepEqual(transport.value.required, schema.value.required);
  assert.equal(transport.strict, false);
}

const slotRepairSource = schemas.find(schema => schema.name === 'mwg_tower_initial_slot_repair');
const slotRepairTransport = createProviderSafeJsonSchema(slotRepairSource);
const eventRepairValue = slotRepairTransport.value.properties.roots.properties.r0
  .properties.slots.properties.s0.properties.value;
const holdRepairValue = slotRepairTransport.value.properties.roots.properties.r0
  .properties.slots.properties.s1.properties.value;
const resourceStrategyValue = slotRepairTransport.value.properties.roots.properties.r0
  .properties.slots.properties.s2.properties.value;
const nextAttackStrategyValue = slotRepairTransport.value.properties.roots.properties.r0
  .properties.slots.properties.s3.properties.value;
const quantityStrategyValue = slotRepairTransport.value.properties.roots.properties.r0
  .properties.slots.properties.s4.properties.value;
const unknownEffectValue = slotRepairTransport.value.properties.roots.properties.r0
  .properties.slots.properties.s5.properties.value;
const skillTriggerValue = slotRepairTransport.value.properties.roots.properties.r0
  .properties.slots.properties.s6.properties.value;
const conditionAliasValue = slotRepairTransport.value.properties.roots.properties.r0
  .properties.slots.properties.s7.properties.value;
const addCardDestinationValue = slotRepairTransport.value.properties.roots.properties.r0
  .properties.slots.properties.s8.properties.value;
assert.match(JSON.stringify(eventRepairValue), /"damage"/);
assert.doesNotMatch(JSON.stringify(eventRepairValue), /"modify"/);
assert.match(JSON.stringify(holdRepairValue), /"modify"/);
assert.match(JSON.stringify(holdRepairValue), /"card_rule"/);
const repairAjv = new Ajv2020({ strict: false, allErrors: true });
assert.equal(repairAjv.compile(eventRepairValue)({ damage: 3 }), true);
assert.equal(repairAjv.compile(eventRepairValue)({ modify: 'damage', add: 2 }), false);
assert.equal(repairAjv.compile(holdRepairValue)({ modify: 'damage', add: 2 }), true);
assert.equal(repairAjv.compile(holdRepairValue)({ damage: 3 }), false);
const validateResourceStrategy = repairAjv.compile(resourceStrategyValue);
assert.equal(validateResourceStrategy({ mode: 'pay_resource', resource_id: 'charge', amount: 2 }), true);
assert.equal(validateResourceStrategy({ mode: 'pay_resource', resource_id: 'mana', amount: 2 }), false);
assert.equal(validateResourceStrategy({ mode: 'read_current_resource' }), true);
assert.equal(repairAjv.compile(nextAttackStrategyValue)({ mode: 'hold_until_next_attack' }), true);
assert.equal(repairAjv.compile(nextAttackStrategyValue)({ mode: 'rewrite_damage', amount: 999 }), false);
const validateQuantityStrategy = repairAjv.compile(quantityStrategyValue);
assert.equal(validateQuantityStrategy({ mode: 'set_owned_quantity', quantity: 2 }), true);
assert.equal(validateQuantityStrategy({ mode: 'set_owned_quantity', quantity: 0 }), false);
assert.equal(validateQuantityStrategy({ mode: 'remove_unowned_card' }), true);
assert.equal(repairAjv.compile(unknownEffectValue)({ block: 3 }), true);
assert.equal(repairAjv.compile(unknownEffectValue)({ card_rule: 'retain_hand' }), false);
assert.equal(repairAjv.compile(skillTriggerValue)({ mode: 'promote_to_power' }), true);
assert.equal(repairAjv.compile(conditionAliasValue)({ mode: 'use_when_condition' }), true);
assert.equal(repairAjv.compile(conditionAliasValue)({ mode: 'combine_and' }), false);
assert.equal(repairAjv.compile(addCardDestinationValue)('deck'), true);
assert.equal(repairAjv.compile(addCardDestinationValue)('draw'), false);

const initialTransport = createProviderSafeJsonSchema(createTowerInitialContentJsonSchema());
const initialCardEffect = initialTransport.value.properties.player.properties.cards.items
  .properties.effects.anyOf[1].items;
assert.equal(initialCardEffect.type, 'object');
assert.equal(initialCardEffect.minProperties, 1);
const spawnSummon = initialCardEffect.properties.spawn_summon;
assert.ok(spawnSummon, 'initial card effects must expose the public spawn_summon shape');
assert.equal(spawnSummon.additionalProperties, false);
assert.deepEqual(spawnSummon.required, ['id', 'name', 'emoji']);
assert.ok(spawnSummon.properties.max_hp);
assert.ok(spawnSummon.properties.actions);
assert.ok(spawnSummon.properties.abilities);
assert.match(spawnSummon.description, /hp\/power\/根 trigger\/on_destroyed/);
assert.deepEqual(spawnSummon.oneOf[1].required, ['slot']);
assert.deepEqual(spawnSummon.oneOf[1].anyOf, [{ required: ['on_existing'] }, { required: ['on_defeated'] }]);
assert.deepEqual(
  Object.keys(spawnSummon.properties.capabilities.properties),
  ['selectable', 'accepts_status', 'acts', 'intercepts'],
);
assert.equal(spawnSummon.properties.capabilities.additionalProperties, false);
assert.equal(spawnSummon.properties.hp, undefined);
assert.equal(spawnSummon.properties.power, undefined);
assert.equal(spawnSummon.properties.trigger, undefined);
const validateInitialEffect = new Ajv2020({ strict: false, allErrors: true }).compile(initialCardEffect);
assert.equal(validateInitialEffect({ damage: 7 }), true, 'ordinary compact effects remain shallow');
assert.equal(validateInitialEffect({ damage: 7, hits: 3 }), true, 'literal positive hits remain available');
assert.equal(validateInitialEffect({ damage: 7, hits: 'self.summon_count' }), false, 'formula hits are rejected by the provider outline');
assert.equal(validateInitialEffect({ discard: 1, from: 'top', pick: 'top' }), false, 'pile position cannot be emitted as a from value');
assert.equal(validateInitialEffect({ discard: 1, from: 'draw', pick: 'top' }), true, 'the canonical pile and position fields remain available');
assert.equal(validateInitialEffect({ trigger: { on: 'turn_start', effects: { damage: 3 } } }), false, 'a trigger cannot be nested in an effect item');
assert.equal(validateInitialEffect({ operation: 'damage', value: 7, target: 'opponent' }), false, 'generic effect envelopes are rejected');
assert.equal(validateInitialEffect({
  spawn_summon: { id: 'familiar', name: '使魔', emoji: '🐈', max_hp: 12 },
}), true);
assert.equal(validateInitialEffect({
  spawn_summon: {
    id: 'familiar', name: '使魔', emoji: '🐈', max_hp: 12,
    slot: 'front_familiar', on_defeated: 'revive_reset',
  },
}), true, 'an explicit lifecycle branch requires a stable slot and a public lifecycle enum');
assert.equal(validateInitialEffect({
  spawn_summon: { id: 'familiar', name: '使魔', emoji: '🐈', max_hp: 12, slot: 'front_familiar' },
}), false, 'a provider-facing ordinary summon cannot emit an unused lifecycle slot');
assert.equal(validateInitialEffect({
  spawn_summon: { id: 'familiar', name: '使魔', emoji: '🐈', max_hp: 12, on_existing: 'replace' },
}), false, 'a lifecycle policy cannot be emitted without its stable slot');
assert.equal(validateInitialEffect({
  spawn_summon: {
    id: 'familiar', name: '使魔', emoji: '🐈', max_hp: 12,
    hp: 12, power: 3, trigger: { on: 'turn_start', effects: { damage: 3 } },
  },
}), false, 'the exact first-pass summon regression must be impossible in the provider outline');
assert.equal(validateInitialEffect({
  spawn_summon: { id: 'familiar', name: '使魔', emoji: '🐈', on_destroyed: 'default' },
}), false, 'on_destroyed is not a public summon lifecycle field');
assert.equal(validateInitialEffect({
  spawn_summon: { id: 'familiar', name: '使魔', emoji: '🐈', capabilities: { block: true } },
}), false, 'summon capabilities expose only the four runtime-supported booleans');
assert.equal(
  initialTransport.value.properties.player.properties.cards.items.properties.effects.description,
  undefined,
  'the provider outline must not repeat the public card DSL or runtime-only completion fields',
);
assert.equal(
  JSON.stringify(initialCardEffect).includes('operation'),
  true,
  'the provider outline names the generic operation envelope only to reject it',
);
const validateInitialCard = new Ajv2020({ strict: false, allErrors: true }).compile(
  initialTransport.value.properties.player.properties.cards.items,
);
const cardBase = { id: 'test_card', name: '测试卡', rarity: 'Common', quantity: 1, cost: 1 };
assert.equal(validateInitialCard({ ...cardBase, type: 'Skill', effects: { spawn_summon: { id: 'familiar', name: '使魔', emoji: '🐈' } } }), true);
assert.equal(validateInitialCard({ ...cardBase, type: 'Skill', rarity: 'Starter', effects: { damage: 7 } }), false, 'Starter is never a card rarity');
assert.equal(validateInitialCard({ ...cardBase, type: 'Power', effects: { spawn_summon: { id: 'familiar', name: '使魔', emoji: '🐈' } } }), false, 'an immediate-only summon card cannot be Power');
assert.equal(validateInitialCard({ ...cardBase, type: 'Power', effects: { apply_status: 'lasting_power', stacks: 1, to: 'self' } }), true, 'a status-registering Power may omit its trigger');
assert.equal(validateInitialCard({ ...cardBase, type: 'Power', trigger: { on: 'turn_start', effects: { energy: 1 } } }), true, 'an event Power remains valid');
assert.equal(validateInitialCard({ ...cardBase, type: 'Power', trigger: { on: 'summon_spawned', effects: { energy: 1 } } }), false, 'summon_spawned is not a public card trigger');
const initialCardTrigger = initialTransport.value.properties.player.properties.cards.items.properties.trigger;
const passiveTriggerBranch = initialCardTrigger.oneOf.find(branch => branch.properties?.on?.const === 'passive');
assert.ok(passiveTriggerBranch, 'provider schema must preserve the passive trigger branch');
const passiveSchemaText = JSON.stringify(passiveTriggerBranch.properties.effects);
assert.match(passiveSchemaText, /"modify"/);
assert.match(passiveSchemaText, /"card_rule"/);
assert.match(passiveSchemaText, /"card_rule":\{"const":"replay"\}/);
const validatePassiveTriggerEffects = repairAjv.compile(passiveTriggerBranch.properties.effects);
assert.equal(validatePassiveTriggerEffects({ card_rule: 'replay', limit: 1, extra: 'stacks' }), true);
assert.equal(validatePassiveTriggerEffects({ card_rule: 'replay', limit: 1 }), false);
assert.equal(validatePassiveTriggerEffects({ card_rule: 'retain_hand', limit: 1 }), false);
assert.doesNotMatch(passiveSchemaText, /"apply_status"/);
assert.doesNotMatch(passiveSchemaText, /"damage"\s*:/);
const nonPassiveTriggerBranch = initialCardTrigger.oneOf.find(branch => Array.isArray(branch.properties?.on?.enum));
assert.deepEqual(nonPassiveTriggerBranch.properties.ordinal.enum, ['first', 'nth', 'every_n']);
assert.match(nonPassiveTriggerBranch.properties.ordinal.description, /first 无 n/);
const validateEventTriggerEffects = repairAjv.compile(nonPassiveTriggerBranch.properties.effects);
for (const effect of [{ modify: 'block', add: 1 }, { card_rule: 'retain_hand' }]) {
  assert.equal(validateEventTriggerEffects(effect), false);
  assert.equal(validateEventTriggerEffects([effect]), false);
}
assert.equal(validateEventTriggerEffects([{ block: 1 }]), true);
const generatedTemplateTrigger = initialTransport.value.properties.player.properties.cards.items
  .properties.creates.items;
assert.deepEqual(generatedTemplateTrigger, { type: 'object', minProperties: 1 });
const initialRewardStatuses = initialTransport.value.properties.opening.properties.choices.items
  .properties.outcome.properties.reward.properties.artifacts.items.properties.statuses;
assert.match(
  initialTransport.value.properties.opening.properties.choices.items.properties.outcome.description,
  /禁止 status\/statuses.*具体 card\/artifact\/item 候选对象/,
);
assert.equal(initialRewardStatuses.type, 'array');
assert.equal(initialRewardStatuses.minItems, 1);
assert.equal(initialRewardStatuses.maxItems, 16);
assert.deepEqual(initialRewardStatuses.items.required, ['id', 'name', 'emoji', 'type', 'triggers']);
assert.equal(initialRewardStatuses.items.additionalProperties, false);
assert.match(initialTransport.value.description, /hold 只写 modify\/card_rule/);
assert.match(initialTransport.value.description, /stacks_change.*每回合减少1层写 -1/);
assert.equal(initialRewardStatuses.items.properties.triggers.description, undefined, 'identical status notes are sent once at the root');
const validateInitialRewardStatus = new Ajv2020({ strict: false, allErrors: true }).compile(initialRewardStatuses.items);
const rewardStatusBase = {
  id: 'weakness', name: '虚弱', emoji: '💫', type: 'debuff', triggers: {},
};
assert.equal(
  validateInitialRewardStatus({ ...rewardStatusBase, stacks_change: 'decrement' }),
  false,
  'natural-language stack decay aliases must be rejected by the provider outline',
);
assert.equal(validateInitialRewardStatus({ ...rewardStatusBase, stacks_change: -1 }), true);
assert.equal(validateInitialRewardStatus({ ...rewardStatusBase, stacks_change: 'reset' }), true);
assert.equal(validateInitialRewardStatus({ ...rewardStatusBase, stacks_change: 'x0.5' }), true);
assert.equal(
  validateInitialRewardStatus({
    ...rewardStatusBase,
    stacks_change: -1,
    triggers: { hold: { modify: 'actions_per_activation', add: 1 } },
  }),
  false,
  'summon-only stats must not appear as continuous status modifiers',
);
assert.equal(validateInitialRewardStatus({
  ...rewardStatusBase,
  stacks_change: -1,
  triggers: { hold: { modify: 'damage', add: 1 } },
}), true);
const rewardStatusHold = JSON.stringify(initialRewardStatuses.items.properties.triggers.properties.hold);
assert.match(rewardStatusHold, /"modify"/);
assert.match(rewardStatusHold, /"card_rule"/);
const validateRewardStatusEvent = repairAjv.compile(initialRewardStatuses.items.properties.triggers.additionalProperties);
for (const effect of [{ modify: 'block', add: 1 }, { card_rule: 'retain_hand' }]) {
  assert.equal(validateRewardStatusEvent(effect), false);
  assert.equal(validateRewardStatusEvent([effect]), false);
}
assert.equal(validateRewardStatusEvent({ block: 1 }), true);

const sixRootRepairTargets = [
  { token: 'r0', kind: 'opening_choice', preserveId: 'gift_alpha' },
  { token: 'r1', kind: 'player_card', preserveId: 'card_alpha' },
  { token: 'r2', kind: 'player_card', preserveId: 'card_beta' },
  { token: 'r3', kind: 'player_core' },
  { token: 'r4', kind: 'player_ability', preserveId: 'ability_alpha', nullable: true },
  { token: 'r5', kind: 'player_status_definition', preserveId: 'status_alpha' },
];
const sixRootRepairTransport = createProviderSafeJsonSchema(
  createTowerInitialRootRepairJsonSchema(sixRootRepairTargets),
);
assert.ok(
  JSON.stringify(sixRootRepairTransport).length < INITIAL_SCHEMA_BUDGET,
  `six-root repair transport schema is still too large: ${JSON.stringify(sixRootRepairTransport).length}`,
);
assert.deepEqual(sixRootRepairTransport.value.properties.roots.required, sixRootRepairTargets.map(target => target.token));
assert.equal(sixRootRepairTransport.value.properties.roots.additionalProperties, false);
assert.equal(sixRootRepairTransport.value.properties.roots.properties.r0.allOf[1].properties.id.const, 'gift_alpha');
assert.equal(
  sixRootRepairTransport.value.properties.roots.properties.r4.anyOf.some(branch => branch.type === 'null'),
  true,
  'only explicitly optional roots expose null in the provider schema',
);

const batchTransport = createProviderSafeJsonSchema(createTowerNodeBatchJsonSchema('batch-3', [
  job,
  { ...job, nodeId: 'act-1-floor-2-col-2', requestId: 'request-2' },
  { ...job, nodeId: 'act-1-floor-2-col-3', requestId: 'request-3' },
]));
assert.ok(batchTransport);
assert.ok(JSON.stringify(batchTransport).length < PROVIDER_SCHEMA_BUDGET);
const batchNodeOutline = batchTransport.value.properties.results.items;
const enemyOutline = batchNodeOutline.properties.payload.properties.battle.properties.enemies.items;
assert.equal(
  batchNodeOutline.properties.payload.properties.battle.properties.statuses.description,
  undefined,
  'canonical prompt prose is not duplicated into the provider transport schema',
);
assert.deepEqual(enemyOutline.required, ['id', 'name', 'emoji', 'hp', 'max_hp', 'lust', 'max_lust', 'actions']);
assert.equal(enemyOutline.properties.actions.type, 'array');
assert.deepEqual(enemyOutline.properties.actions.items.required, ['name', 'effects']);
const enemyActionEffect = enemyOutline.properties.actions.items.properties.effects.anyOf[1].items;
assert.equal(enemyActionEffect.type, 'object');
assert.equal(enemyActionEffect.minProperties, 1);
assert.match(batchTransport.value.description, /card_rule\/modify 值是字符串/);
assert.equal(enemyOutline.properties.actions.items.properties.effects.description, undefined);
assert.equal(enemyOutline.properties.lust.type, 'number');
assert.equal(enemyOutline.properties.max_lust.type, 'number');
assert.match(
  JSON.stringify(enemyOutline.properties.abilities.items.properties.trigger),
  /trigger 根部禁止 when/,
);
const singleBattleBatchTransport = createProviderSafeJsonSchema(createTowerNodeBatchJsonSchema('batch-single', [job]));
const singleBattleNodeOutline = singleBattleBatchTransport.value.properties.results.items.oneOf[0];
assert.equal(
  singleBattleNodeOutline.properties.reward.description,
  undefined,
  'dynamic reward guidance stays in the authoritative request instead of the transport outline',
);

const mixedBatchTransport = createProviderSafeJsonSchema(createTowerNodeBatchJsonSchema('batch-mixed', [
  { ...job, kind: 'treasure', nodeId: 'act-1-floor-1-col-2', requestId: 'request-treasure' },
  job,
]));
assert.ok(mixedBatchTransport);
assert.ok(JSON.stringify(mixedBatchTransport).length < PROVIDER_SCHEMA_BUDGET);
const mixedPayloads = mixedBatchTransport.value.properties.results.items.properties.payload.anyOf;
assert.ok(Array.isArray(mixedPayloads));
const mixedBattlePayload = mixedPayloads.find(payload => payload.properties?.battle);
assert.ok(mixedBattlePayload, 'mixed batches must retain the battle payload outline');
assert.equal(
  mixedBattlePayload.properties.battle.properties.enemies.items.properties.actions.type,
  'array',
  'a treasure sibling must not erase the enemy action shape from a mixed reachable batch',
);

const triggerProbe = createProviderSafeJsonSchema({
  name: 'trigger-probe',
  value: {
    type: 'object',
    properties: { trigger: { $ref: '#/$defs/mwgCardTrigger' } },
    required: ['trigger'],
    $defs: { mwgCardTrigger: { type: 'object' } },
  },
});
const triggerProbeNonPassive = triggerProbe.value.properties.trigger.oneOf
  .find(branch => Array.isArray(branch.properties?.on?.enum));
assert.ok(triggerProbeNonPassive.properties.on.enum.includes('turn_start'));
assert.equal(triggerProbeNonPassive.properties.on.enum.includes('turn_started'), false);

let forwarded = null;
const ports = createGlobalTowerGenerationPorts({
  async generateRaw(config) {
    forwarded = structuredClone(config);
    return '{}';
  },
  async createChatMessages() {},
  stopGenerationById() { return true; },
}, () => ({ chatId: 'provider-safe-schema' }));
await ports.generate({
  generation_id: 'provider-safe-schema-test',
  user_input: 'author one result',
  should_stream: false,
  should_silence: true,
  json_schema: schemas[0],
});
assert.ok(forwarded);
assert.ok(JSON.stringify(forwarded.json_schema).length < INITIAL_SCHEMA_BUDGET);
assert.equal(JSON.stringify(forwarded.json_schema).includes('"$ref"'), false);
assert.equal(forwarded.max_chat_history, 0);
assert.ok(Array.isArray(forwarded.ordered_prompts));
assert.match(forwarded.ordered_prompts[0].content, /MWG_TOWER_STRUCTURED_REQUEST:provider-safe-schema-test/);

console.log('Provider-safe JSON schemas preserve response envelopes without recursive SillyTavern expansion.');
