import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const adapter = require(resolve('src/fish/core/battleContentAdapter.ts'));
const mvu = require(resolve('src/fish/core/mvuBattleAdapter.ts'));
const schema = require(resolve('src/game-core/aiContentJsonSchema.ts'));
const initial = require(resolve('src/game-core/initialDraftSchema.ts'));

const card = (id, name) => ({ id, name, type: 'Skill', rarity: 'Common', quantity: 1, cost: 0, effects: { block: 2 } });
const item = { id: 'acquire_tonic', name: '定影药剂', count: 1, effects: { heal: 3 } };
const pickupOnly = {
  id: 'archive_key', name: '档案密钥', rarity: 'Rare', emoji: '🗝️',
  on_acquire: {
    max_hp: 3, gold: 11, card_removals: 1, resources: { spark: 2 },
    cost: { gold: 2, resources: { spark: 1 } },
    gain_cards: [card('archive_note', '档案残页')],
    deck_actions: [{ id: 'reforge', kind: 'transform', count: 1, pick: 'choose', replacement: card('archive_form', '档案重构') }],
    grant: { cards: [card('archive_choice', '档案抉择'), card('archive_backup', '档案备份')], items: [item], limits: { cards: 1, items: 1 } },
  },
};
const dual = { ...structuredClone(pickupOnly), id: 'battle_archive_key', name: '战斗档案密钥', trigger: { on: 'battle_start', effects: { block: 4 } } };

const publicSchema = schema.withAiContentDefinitions({ $ref: '#/$defs/mwgArtifact' });
const artifactSchema = publicSchema.$defs.mwgArtifact;
assert.ok(!artifactSchema.required.includes('trigger'));
assert.deepEqual(artifactSchema.anyOf, [{ required: ['trigger'] }, { required: ['on_acquire'] }]);
assert.ok(artifactSchema.properties.on_acquire.properties.grant.properties.cards);
assert.equal(artifactSchema.properties.on_acquire.properties.grant.properties.artifacts, undefined);
assert.ok(initial.createInitialDraftJsonSchema().value.$defs.mwgArtifact.properties.on_acquire,
  'initial draft and repair projections inherit the shared artifact field');

const pack = core.createContentPack({
  relics: [pickupOnly],
  playerResources: [{ id: 'spark', name: '火花', emoji: '✨', max: 9, start: 1, refresh: 'retain' }],
});
assert.equal(core.validateContentPackContract(pack, { requireExecutable: true, knownStatusIds: [] }).ok, true);
assert.equal(core.validateRewardCandidate('artifacts', pickupOnly).ok, true);
assert.equal(core.validateRewardCandidateAgainstLibrary('artifacts', pickupOnly, { knownResourceIds: ['spark'], statusDefinitions: [] }).ok, true);
assert.match(core.validateRewardCandidateAgainstLibrary('artifacts', pickupOnly, { knownResourceIds: [], statusDefinitions: [] }).message, /未注册资源/);

const normalized = adapter.normalizeRelicDefinition(pickupOnly);
assert.ok(normalized, 'pickup-only relic is retained in battle state');
assert.equal(normalized.trigger, undefined);
assert.equal(normalized.effectProgram, undefined);
assert.ok(normalized.onAcquire);
assert.equal(core.resolveRelicTriggerPlan(normalized, 'battle_start'), null, 'pickup-only relic cannot invent a battle trigger');
assert.deepEqual(adapter.normalizeRelicDefinition(JSON.parse(JSON.stringify(pickupOnly))), normalized, 'JSON restoration preserves acquisition semantics');
assert.equal(mvu.convertMvuRelics([JSON.parse(JSON.stringify(pickupOnly))]).length, 1, 'MVU restore keeps pickup-only owned relic');

const dualNormalized = adapter.normalizeRelicDefinition(dual);
assert.ok(dualNormalized?.effectProgram);
assert.ok(dualNormalized?.onAcquire);
assert.equal(core.resolveRelicTriggerPlan(dualNormalized, 'battle_start')?.program.steps[0].op, 'gain_block');

const compact = core.describeCompactContent(pickupOnly, { resourceNames: { spark: '火花' } });
const tags = core.compactContentToDisplayTags(pickupOnly, { resourceNames: { spark: '火花' } });
const normalizedTags = core.compactContentToDisplayTags(normalized, { resourceNames: { spark: '火花' } });
for (const text of [compact, tags.map(tag => tag.text).join('；'), normalizedTags.map(tag => tag.text).join('；')]) {
  assert.match(text, /获得时：/);
  assert.match(text, /支付2金币/);
  assert.match(text, /获得1次删牌机会/);
  assert.match(text, /变形为“档案重构”/);
  assert.match(text, /从2张卡牌中选择1张卡牌获得/);
}
assert.ok(tags.find(tag => tag.references?.some(ref => ref.name === '档案残页')), 'acquisition cards keep navigable references');
const {presentCompactContent}=require('../src/game-core/contentPresentation.ts');
const pillReferences=[];
const face=presentCompactContent(pickupOnly,'content',{onSummonReference:ref=>pillReferences.push(ref)});
assert.ok(face.rulesGroups.some(group=>group.includes('获得时：')),'actual card-face pills include pickup-only rules');
assert.equal(face.rulesGroups.filter(group=>group.includes('获得时：')).length,1);
assert.ok(pillReferences.some(ref=>ref.name==='档案残页'&&ref.card),'compact card-face references retain the full granted card');
assert.match(pillReferences.find(ref=>ref.name==='定影药剂').rules,/3点生命/);
assert.equal(pillReferences.find(ref=>ref.name==='定影药剂').card,undefined,'items open as item rules, not a fabricated card face');

const nestedArtifact = structuredClone(pickupOnly);
nestedArtifact.on_acquire.grant.artifacts = [{ id: 'loop', name: '递归遗物', rarity: 'Common', trigger: { on: 'battle_start', effects: { block: 1 } } }];
assert.match(core.validateRewardCandidate('artifacts', nestedArtifact).message, /artifacts|不支持字段/);
assert.equal(core.validateContentPackContract(core.createContentPack({ relics: [nestedArtifact] }), { requireExecutable: true }).ok, false);

console.log('Relic on_acquire schema, validation, battle no-op adapter, presentation, and JSON restoration contracts passed.');
