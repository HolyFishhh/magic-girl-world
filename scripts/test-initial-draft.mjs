import assert from 'node:assert/strict';
import './test-initial-envelope.mjs';
import './test-initial-timing-examples.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
import { canonicalInitialFixtureToDraft } from './lib/initial-draft-fixture.mjs';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { compileInitialDraftToMvu, inspectInitialDraft, INITIAL_DRAFT_SPEC } = require(resolve('src/game-core/initialDraft.ts'));
const { createInitialDraftJsonSchema } = require(resolve('src/game-core/initialDraftSchema.ts'));
const { initialDraftSourcePath } = require(resolve('src/game-core/initialDraftSourcePath.ts'));
const {
  planInitialDraftRegistryRepair, createInitialDraftRegistryRepairJsonSchema,
  applyInitialDraftRegistryRepair, INITIAL_DRAFT_REGISTRY_REPAIR_SPEC,
} = require(resolve('src/game-core/initialDraftRepair.ts'));
const { createTowerInitialContentJsonSchema } = require(resolve('src/game-core/towerRequest.ts'));
const { createContentPack } = require(resolve('src/game-core/contentPack.ts'));
const { validateContentPackContract } = require(resolve('src/game-core/contentContract.ts'));
const { collectRewardCandidateContractIssues } = require(resolve('src/game-core/rewardCandidateValidation.ts'));

const status = (id, triggers = { hold: [{ modify: 'block', add: 1 }] }) => ({
  id, name: id, emoji: '✨', type: 'buff', stacks_change: 'keep', triggers,
});
const card = (id, effects) => ({ id, name: id, emoji: '🃏', type: 'Skill', rarity: 'Common', cost: 0, quantity: 1, effects });
const fixture = () => ({
  spec: INITIAL_DRAFT_SPEC,
  narrative: '依照酒馆剧情继续。',
  player: {
    status: { time: '午夜', location: '高塔', profession: { name: '编程者', ability: '编织规则' } },
    core: { emoji: '🧙', hp: 60, max_hp: 60, lust: 0, max_lust: 100 },
    cards: [card('start', [{ apply_status: 'alpha', stacks: 1 }, { add_card: 'spark', count: 1 }]), card('second', [{ add_card: 'spark' }])],
  },
  opening: { title: '起步', narrative: '挑选一件馈赠。', choices: [{
    id: 'gift', label: '未来馈赠', description: '获得新能力',
    outcome: { reward: { cards: [card('future', [{ apply_status: 'reward_only', stacks: 1 }])] } },
  }] },
  registry: {
    statuses: [status('alpha', { turn_end: [{ apply_status: 'beta', stacks: 1, to: 'self' }] }), status('beta'), status('reward_only', { turn_end: [{ apply_status: 'beta', stacks: 2, to: 'self' }] })],
    resources: [{ id: 'charge', name: '充能', emoji: '⚡', start: 1, max: 3, refresh: 'retain' }],
    templates: [{ id: 'spark', name: '火花', type: 'Attack', rarity: 'Common', cost: 0, effects: [{ damage: 3 }] }],
  },
});
const source = fixture();
// Conditional groups retain registry ownership; wrapping cannot hide dependencies.
const guarded = fixture();
guarded.player.cards[0].effects = [{ guard: 'self.resource.charge.current >= 1', effects: [
  { apply_status: 'alpha', stacks: 1 }, { add_card: 'spark', count: 1 },
] }];
const guardedBefore = structuredClone(guarded);
assert.equal(compileInitialDraftToMvu(guarded).ok, true);
assert.deepEqual(guarded, guardedBefore);
for (const [collection, id, code] of [
  ['statuses', 'alpha', 'UNKNOWN_STATUS_REF'],
  ['templates', 'spark', 'UNKNOWN_TEMPLATE_REF'],
  ['resources', 'charge', 'UNKNOWN_RESOURCE_REF'],
]) {
  const missing = structuredClone(guarded);
  missing.registry[collection] = missing.registry[collection].filter(entry => entry.id !== id);
  const result = inspectInitialDraft(missing, () => []);
  assert.ok(result.references.some(issue => issue.code === code && issue.ref === id), `${collection} hidden inside guard`);
  assert.equal(compileInitialDraftToMvu(missing).ok, false);
}
const incomplete = fixture();
incomplete.registry.statuses = incomplete.registry.statuses.filter(s => s.id !== 'beta');
incomplete.registry.statuses[0].triggers.hold = [{ modify: 'energy', add: 1 }];
const incompleteBefore = structuredClone(incomplete);
const inspected = inspectInitialDraft(incomplete, preview => {
  assert.equal(preview.player.statuses.some(s => s.id === 'beta'), false, 'never invent missing definitions for validation');
  const validation = validateContentPackContract(createContentPack({ cards: preview.player.cards, statuses: preview.player.statuses }), { requireExecutable: true });
  preview.player.cards.length = 0;
  return validation.ok ? [] : validation.issues;
});
assert.equal(inspected.inspected, true);
assert.ok(inspected.references.some(issue => issue.code === 'UNKNOWN_STATUS_REF' && issue.ref === 'beta'));
assert.ok(inspected.rules.length > 0, 'existing invalid rules remain inspectable alongside unresolved references');
assert.ok(inspected.rules.some(issue => /Unsupported modifier: energy/.test(issue.message)), 'hold energy failure is collected, not just the missing reference again');
assert.equal(Object.hasOwn(inspected, 'value'), false, 'diagnostic report cannot masquerade as publishable content');
assert.deepEqual(incomplete, incompleteBefore);
assert.equal(compileInitialDraftToMvu(incomplete).ok, false, 'inspection never relaxes acceptance');
let invalidEnvelopeVisited = false;
assert.equal(inspectInitialDraft({}, () => { invalidEnvelopeVisited = true; return []; }).inspected, false);
assert.equal(invalidEnvelopeVisited, false);
assert.throws(() => inspectInitialDraft(incomplete, () => { throw new Error('validator unavailable'); }), /validator unavailable/);
const before = structuredClone(source);
const result = compileInitialDraftToMvu(source);
assert.equal(result.ok, true, JSON.stringify(result));
const summonGeneratedCard = fixture();
summonGeneratedCard.registry.resources.push({ id: 'mind', name: '心智', emoji: '🧠', start: 2, max: 3, refresh: 'retain' });
summonGeneratedCard.registry.templates = [
  { id: 'clear_shard', name: '澄明碎片', type: 'Skill', rarity: 'Common', cost: { mind: 1 }, effects: [{ add_card: 'echo_shard' }] },
  { id: 'echo_shard', name: '回响碎片', type: 'Attack', rarity: 'Common', cost: { mind: 1 }, effects: [{ damage: '2 + self.resource.mind.current' }] },
];
summonGeneratedCard.player.cards = [card('scribe', [{ spawn_summon: {
  id: 'scribe_pet', name: '抄写灵', emoji: '📜', max_hp: 3,
  actions: [{ id: 'write', name: '抄写', effects: [{ add_card: 'clear_shard', to: 'hand' }] }],
} }])];
assert.equal(compileInitialDraftToMvu(summonGeneratedCard).ok, true,
  'a card generated by a summon action later spends and reads the player resource pool, including nested templates');
const summonLocalMind = structuredClone(summonGeneratedCard);
summonLocalMind.player.cards[0].effects[0].spawn_summon.actions[0].effects = [{ resource: { id: 'mind', amount: 1 } }];
const summonLocalMindResult = compileInitialDraftToMvu(summonLocalMind);
assert.equal(summonLocalMindResult.ok, false, 'a summon action cannot directly use a player-only resource');
assert.ok(summonLocalMindResult.diagnostics.some(issue => issue.code === 'UNKNOWN_RESOURCE_REF' && issue.ref === 'mind'));
assert.deepEqual(initialDraftSourcePath(source, result.value, ['player','cards',0,'creates',0,'effects',0,'damage']), ['registry','templates',0,'effects',0,'damage']);
assert.deepEqual(initialDraftSourcePath(source, result.value, ['player','cards',1,'creates',0,'effects',0,'damage']), ['registry','templates',0,'effects',0,'damage'], 'two compiled copies resolve to one authored slot');
assert.deepEqual(initialDraftSourcePath(source, result.value, ['player','statuses',0,'triggers','turn_end',0,'stacks']), ['registry','statuses',0,'triggers','turn_end',0,'stacks']);
assert.deepEqual(initialDraftSourcePath(source, result.value, ['player','core','resources',0,'start']), ['registry','resources',0,'start']);
assert.deepEqual(initialDraftSourcePath(source, result.value, ['opening','choices',0,'outcome','reward','cards',0,'statuses',0,'triggers','turn_end',0,'stacks']), ['registry','statuses',2,'triggers','turn_end',0,'stacks']);
assert.equal(initialDraftSourcePath(source, result.value, ['player','cards',0,'creates']), null, 'generated containers cannot become whole-subtree write targets');
assert.equal(initialDraftSourcePath(source, result.value, ['__proto__']), null);
const alteredPreview = structuredClone(result.value);
alteredPreview.player.cards[0].creates[0].effects[0].damage = 99;
assert.equal(initialDraftSourcePath(source, alteredPreview, ['player','cards',0,'creates',0,'effects',0,'damage']), null, 'stale or normalized unequal leaves fail closed');
const referencedDraft = fixture();
referencedDraft.opening.choices[0].outcome.reward.cards = [{card_ref:'start',quantity:3}];
const referencedPreview = compileInitialDraftToMvu(referencedDraft);
assert.equal(referencedPreview.ok, true);
assert.deepEqual(initialDraftSourcePath(referencedDraft, referencedPreview.value, ['opening','choices',0,'outcome','reward','cards',0,'effects',0,'stacks']), ['player','cards',0,'effects',0,'stacks']);
assert.deepEqual(initialDraftSourcePath(referencedDraft, referencedPreview.value, ['opening','choices',0,'outcome','reward','cards',0,'quantity']), ['opening','choices',0,'outcome','reward','cards',0,'quantity']);
assert.deepEqual(source, before, 'compilation never mutates authoring input');
assert.deepEqual(result.value.player.statuses.map(s => s.id), ['alpha', 'beta'], 'reward-only definitions are not acquired early');
const reward = result.value.opening.choices[0].outcome.reward.cards[0];
assert.deepEqual(reward.statuses.map(s => s.id), ['reward_only'], 'reward keeps its non-global closure');
assert.deepEqual(result.value.player.cards[0].creates, source.registry.templates);
assert.deepEqual(result.value.player.cards[1].creates, source.registry.templates, 'shared definition resolves to each concrete owner');
assert.deepEqual(result.value.player.core.resources, source.registry.resources);
assert.deepEqual(result.value.player.status, source.player.status, 'AI story state is preserved');
assert.deepEqual(result.value.player.cards[0].effects, source.player.cards[0].effects, 'effects are never rewritten');
assert.deepEqual(compileInitialDraftToMvu(source), result, 'same draft produces the same output');
const lifted = canonicalInitialFixtureToDraft(result.value);
assert.equal(lifted.ok, true);
assert.deepEqual(compileInitialDraftToMvu(lifted.draft), result, 'offline fixture lifting round-trips canonical ownership without inventing mechanics');
const reordered = fixture();
reordered.registry.statuses.reverse();
assert.deepEqual(compileInitialDraftToMvu(reordered), result, 'registry ordering has no gameplay effect');
const packResult = validateContentPackContract(createContentPack({ cards: result.value.player.cards, statuses: result.value.player.statuses }), { requireExecutable: true });
assert.equal(packResult.ok, true, JSON.stringify(packResult));
assert.deepEqual(collectRewardCandidateContractIssues('cards', reward, { statusDefinitions: result.value.player.statuses }), []);

const expectFailure = (change, code, verify = () => {}) => {
  const input = fixture(); change(input);
  const original = structuredClone(input);
  const compiled = compileInitialDraftToMvu(input);
  assert.equal(compiled.ok, false, `must reject ${code}`);
  assert.equal('value' in compiled, false, 'an invalid draft has no committable partial output');
  const diagnostic = compiled.diagnostics.find(d => d.code === code);
  assert.ok(diagnostic, JSON.stringify(compiled));
  verify(diagnostic);
  assert.deepEqual(input, original, 'failed compilation is also non-mutating');
};
expectFailure(d => d.player.cards[0].effects[0].apply_status = 'missing', 'UNKNOWN_STATUS_REF', d => {
  assert.deepEqual(d.owner, ['player', 'cards', 0]);
  assert.deepEqual(d.path, ['player', 'cards', 0, 'effects', 0, 'apply_status']);
  assert.equal(d.ref, 'missing');
});
expectFailure(d => d.registry.statuses.push(structuredClone(d.registry.statuses[0])), 'DUPLICATE_DEFINITION', d => assert.deepEqual(d.relatedPath, ['registry', 'statuses', 0]));
expectFailure(d => d.registry.templates.push({ ...d.registry.templates[0], effects: [{ damage: 99 }] }), 'DUPLICATE_DEFINITION');
expectFailure(d => d.player.cards[0].creates = [], 'INLINE_DEFINITION');
expectFailure(d => d.player.core.resources = [], 'INLINE_DEFINITION');
expectFailure(d => d.player.statuses = [], 'INLINE_DEFINITION');
expectFailure(d => d.player.cards[0].effects[1].add_card = 'missing', 'UNKNOWN_TEMPLATE_REF');
expectFailure(d => d.player.cards[0].effects[1].add_card = { id: 'spark' }, 'INVALID_REFERENCE');
expectFailure(d => d.player.cards[0].effects[0].apply_status = { id: 'alpha', stacks: 1 }, 'INVALID_REFERENCE');
expectFailure(d => d.player.cards[0].cost = { missing: 1 }, 'UNKNOWN_RESOURCE_REF');
expectFailure(d => d.player.cards[0].effects = [{ resource: { id: 'missing', amount: 1 } }], 'UNKNOWN_RESOURCE_REF');
expectFailure(d => d.player.cards[0].effects[0].when = 'self.resource.missing.current > 0', 'UNKNOWN_RESOURCE_REF');
expectFailure(d => d.player.cards[0].effects[0].when = 'self.status.missing.stacks > 0', 'UNKNOWN_STATUS_REF');
expectFailure(d => d.player.player_status_effects = [{ id: 'missing', stacks: 1 }], 'UNKNOWN_STATUS_REF');
expectFailure(d => d.registry.templates[0].effects = [{ add_card: 'spark' }], 'TEMPLATE_CYCLE');
expectFailure(d => d.player.core.effects = { add_card: 'spark' }, 'UNSUPPORTED_TEMPLATE_OWNER');
expectFailure(d => d.registry.resources[0].start = 9, 'INVALID_REGISTRY');
expectFailure(d => d.spec = 'future', 'INVALID_DRAFT');
expectFailure(d => d.unrecognized = true, 'UNKNOWN_FIELD');

const prose = fixture();
prose.player.cards[0].description = 'apply_status missing; self.status.phantom.stacks; self.resource.ghost.current; add_card imaginary';
prose.player.cards[0].name = '不存在的状态引用 self.status.fake.stacks';
const proseResult = compileInitialDraftToMvu(prose);
assert.equal(proseResult.ok, true);
assert.deepEqual(proseResult.value.player.cards[0].effects, result.value.player.cards[0].effects);
assert.equal(proseResult.value.player.cards[0].description, prose.player.cards[0].description, 'prose is retained as data, never executed');

const summonEffect = () => ({ spawn_summon: {
  id: 'drone', name: '机械鸟', emoji: '🐦', has_hp: true, max_hp: 10,
  description: '文字不是依赖 self.status.phantom.stacks',
  resources: { fuel: { name: '燃料', emoji: '🔥', start: 1, max: 3, refresh: 'retain' } },
  actions: [{ id: 'fly', name: '振翅', effects: [{ resource: { id: 'fuel', amount: -1 } }, { summoner_effects: [{ resource: { id: 'charge', amount: 1 } }] }] }],
} });
const summoned = fixture();
summoned.player.cards[0].effects = [summonEffect()];
assert.equal(compileInitialDraftToMvu(summoned).ok, true, 'summon local resources are not taken from player pool');
expectFailure(d => {
  d.player.cards[0].effects = [summonEffect()];
  d.player.cards[0].effects[0].spawn_summon.actions[0].effects[0].resource.id = 'charge';
}, 'UNKNOWN_RESOURCE_REF', d => assert.deepEqual(d.owner, ['player', 'cards', 0, 'effects', 0, 'spawn_summon', 'actions', 0]));
expectFailure(d => {
  d.registry.templates[0].effects = [summonEffect()];
  d.registry.templates[0].effects[0].spawn_summon.actions[0].effects = [{ add_card: 'spark' }];
}, 'TEMPLATE_CYCLE');

const statusCycle = fixture();
statusCycle.registry.statuses[1].triggers = { turn_end: [{ apply_status: 'alpha', stacks: 1 }] };
assert.equal(compileInitialDraftToMvu(statusCycle).ok, true, 'finite status dependency cycles do not cause compiler recursion');

const canonicalSchemaBefore = createTowerInitialContentJsonSchema();
const draftSchema = createInitialDraftJsonSchema();
assert.deepEqual(createTowerInitialContentJsonSchema(), canonicalSchemaBefore, 'draft projection never changes the canonical schema');
const ajv = new Ajv2020({ strict: false, inlineRefs: false });
const validateDraft = ajv.compile(draftSchema.value);
const complete = fixture();
complete.opening.choices = [0, 1, 2].map(i => ({ ...structuredClone(complete.opening.choices[0]), id: `gift_${i}` }));
complete.opening.choices[0].outcome.max_lust = 5;
assert.equal(validateDraft(complete), true, JSON.stringify(validateDraft.errors));
for (const cap of [-100, 1000, 1.5, '5']) {
  const invalidCap = structuredClone(complete);
  invalidCap.opening.choices[0].outcome.max_lust = cap;
  assert.equal(validateDraft(invalidCap), false, 'desire cap changes use the same bounded integer contract');
}
const liveSchema = createInitialDraftJsonSchema({ includeNarrative: false });
const validateLive = new Ajv2020({ strict: false, inlineRefs: false }).compile(liveSchema.value);
const liveDraft = structuredClone(complete);
delete liveDraft.narrative;
assert.equal(validateLive(liveDraft), true, JSON.stringify(validateLive.errors));
const noVersion=structuredClone(liveDraft);delete noVersion.spec;
assert.equal(validateLive(noVersion),true,'the live request owns the omitted fixed protocol version');
assert.equal(validateLive({...noVersion,spec:'mwg.initial-draft/v2'}),false,'explicit incompatible versions still fail');
const standaloneNoVersion=structuredClone(complete);delete standaloneNoVersion.spec;
assert.equal(validateDraft(standaloneNoVersion),false,'standalone draft validation remains strict');
assert.equal(validateLive(complete), false, 'mechanism authoring cannot re-author the preset narrative');
assert.deepEqual(createInitialDraftJsonSchema(), draftSchema, 'live projection does not mutate offline/canonical schemas');
const invalidInline = structuredClone(complete);
invalidInline.player.cards[0].creates = structuredClone(complete.registry.templates);
assert.equal(validateDraft(invalidInline), false, 'draft schema requires one centralized definition site');
assert.equal(validateDraft({ ...complete, registry: { ...complete.registry, templates: [{ ...complete.registry.templates[0], quantity: 1 }] } }), false, 'technical template quantity stays forbidden');
const validateCanonical = ajv.compile(canonicalSchemaBefore.value);
const compiledComplete = compileInitialDraftToMvu(complete);
assert.equal(compiledComplete.ok, true);
assert.equal(validateCanonical(compiledComplete.value), true, JSON.stringify(validateCanonical.errors));
const missing = fixture();
const missingBefore = structuredClone(missing);
missing.registry.statuses = missing.registry.statuses.filter(definition => definition.id !== 'alpha');
missing.registry.templates = [];
missing.registry.resources = [];
missing.player.cards[1].cost = { charge: 1 };
const planning = planInitialDraftRegistryRepair(missing);
assert.equal(planning.kind, 'repair');
assert.deepEqual(planning.plan.slots.map(slot => [slot.kind, slot.id]), [['resources', 'charge'], ['statuses', 'alpha'], ['templates', 'spark']]);
assert.equal(planning.plan.slots[2].references.length, 2, 'repeated references share one fixed repair token');
const response = { spec: INITIAL_DRAFT_REGISTRY_REPAIR_SPEC, additions: Object.fromEntries(planning.plan.slots.map(slot => [
  slot.token, structuredClone(missingBefore.registry[slot.kind].find(definition => definition.id === slot.id)),
])) };
const repairSchema = new Ajv2020({ strict: false, inlineRefs: false }).compile(createInitialDraftRegistryRepairJsonSchema(planning.plan).value);
assert.equal(repairSchema(response), true, JSON.stringify(repairSchema.errors));
const repaired = applyInitialDraftRegistryRepair(planning.plan, response);
assert.equal(repaired.ok, true);
assert.deepEqual(repaired.draft.player, missing.player, 'repair cannot change authored player mechanics or story state');
assert.deepEqual(repaired.draft.opening, missing.opening, 'repair cannot change gifts');
assert.equal(repaired.draft.narrative, missing.narrative);
assert.equal(compileInitialDraftToMvu(repaired.draft).ok, true);
assert.equal(planInitialDraftRegistryRepair(repaired.draft).kind, 'not_needed');
for (const invalid of [
  { ...response, player: {} },
  { ...response, additions: {} },
  { ...response, additions: { ...response.additions, rogue: status('rogue') } },
  { ...response, additions: { ...response.additions, r0: { ...response.additions.r0, id: 'other_resource' } } },
]) assert.equal(applyInitialDraftRegistryRepair(planning.plan, invalid).ok, false);
assert.equal(compileInitialDraftToMvu(missing).ok, false, 'neither planning nor merge mutates the rejected original');
const nestedMissing = fixture();
nestedMissing.player.cards[0].effects = [summonEffect()];
nestedMissing.player.cards[0].effects[0].spawn_summon.actions[0].effects[0].resource.id = 'charge';
assert.equal(planInitialDraftRegistryRepair(nestedMissing).kind, 'unsupported', 'a summon-local missing resource cannot be repaired by adding to the player registry');
const invalidOriginal = fixture();
invalidOriginal.registry.statuses.push(structuredClone(invalidOriginal.registry.statuses[0]));
assert.equal(planInitialDraftRegistryRepair(invalidOriginal).kind, 'unsupported', 'conflicting registry structure is not a missing-definition addition');
const newDanglingResponse = structuredClone(response);
newDanglingResponse.additions.r1.triggers = { turn_start: { apply_status: 'new_unplanned_status' } };
const danglingMerge = applyInitialDraftRegistryRepair(planning.plan, newDanglingResponse);
assert.equal(danglingMerge.ok, true, 'merge is not content acceptance');
assert.equal(compileInitialDraftToMvu(danglingMerge.draft).ok, false, 'a new dangling reference must fail the mandatory final compilation, not initiate an unbounded repair');
const badDefinitionResponse = structuredClone(response);
badDefinitionResponse.additions.r1.triggers = { hold: { damage: 999 } };
assert.equal(repairSchema(badDefinitionResponse), false, 'repair definitions still use the authoritative effect grammar');
console.log('Initial draft registry and fixed-token missing-definition repair preserve ownership, authored units and bounded diagnostics; final compilation/content gates remain mandatory.');
