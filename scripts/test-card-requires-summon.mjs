import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const compiled = core.compileCompactEffectList({ add_card: 'guard_order', to: 'hand' }, { creates: [{
  id: 'guard_order', name: '守卫号令', type: 'Skill', rarity: 'Common', cost: 2,
  requires_summon: 'clock_guard', effects: { damage: 4 },
}] });
assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
const card = compiled.value.steps[0].card;
assert.equal(card.requiresSummonTemplateId, 'clock_guard', 'compact card compilation preserves the required summon template');
const state = (summons = []) => ({
  phase: 'player_turn', hasOpponent: true, hand: [{ ...card, id: 'guard_order__1' }], energy: 3,
  resources: {}, cardsPlayedThisTurn: 0, summonTemplateIds: summons,
});
const absentState = state();
const absent = core.prepareCardPlay('guard_order__1', absentState);
assert.deepEqual(absent, { ok: false, code: 'REQUIRED_SUMMON_MISSING' }, 'missing summon rejects before payment');
assert.equal(absentState.energy, 3, 'a rejected gate has not spent energy');
assert.equal(core.prepareCardPlay('guard_order__1', state(['other_guard'])).code, 'REQUIRED_SUMMON_MISSING', 'a different template does not satisfy the gate');
const present = core.prepareCardPlay('guard_order__1', state(['clock_guard']));
assert.equal(present.ok, true, 'matching living summon permits play');
const restored = JSON.parse(JSON.stringify({ card, summons: ['clock_guard'] }));
const afterRestore = core.prepareCardPlay('guard_order__1', {
  ...state(restored.summons), hand: [{ ...restored.card, id: 'guard_order__1' }],
});
assert.equal(afterRestore.ok, true, 'saved card gate and summon presence retain semantics after JSON restore');
assert.equal(core.prepareCardPlay('guard_order__1', { ...state(), hand: [{ ...restored.card, id: 'guard_order__1' }] }).code, 'REQUIRED_SUMMON_MISSING', 'restored card still rejects when its required summon is absent');
console.log('Card requires_summon compiles, blocks before payment, permits a matching summon, and survives JSON restore.');
const {normalizeCardDefinition}=require('../src/fish/core/battleContentAdapter.ts');
const {describeCompactCard,describeCompactCardRuleGroups}=require('../src/game-core/contentDescription.ts');
const {compactContentToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const {createInitialDraftJsonSchema}=require('../src/game-core/initialDraftSchema.ts');
const {withAiContentDefinitions}=require('../src/game-core/aiContentJsonSchema.ts');
const authored={id:'order',name:'号令',type:'Skill',rarity:'Common',quantity:1,cost:1,requires_summon:'clock_guard',effects:{damage:4}};
const adapted=normalizeCardDefinition(authored);
assert.equal(adapted.requiresSummonTemplateId,'clock_guard','initial/reward cards retain gate in normal battle conversion');
assert.equal(normalizeCardDefinition(JSON.parse(JSON.stringify(authored))).requiresSummonTemplateId,'clock_guard');
const opts={summonNames:{clock_guard:'钟表守卫'}};
for(const text of [describeCompactCard(authored,opts),describeCompactCardRuleGroups(authored,opts).join(''),compactContentToDisplayTags(authored,opts).map(t=>t.text).join('')]) assert.match(text,/仅在我方存在“钟表守卫”召唤物时可打出/);
const schema=createInitialDraftJsonSchema().value;
assert.equal(schema.$defs.mwgCard.properties.requires_summon.type,'string','initial schema inherits gate');
assert.equal(schema.$defs.cardTemplate.properties.requires_summon.type,'string','generated templates inherit gate');
assert.equal(withAiContentDefinitions({}).$defs.mwgRewardCard.properties.requires_summon.type,'string','reward/repair schema inherits gate');
console.log('Initial/reward schema, normal battle conversion and both Chinese presentation chains preserve the gate.');
