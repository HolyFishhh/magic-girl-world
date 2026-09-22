import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createContentPack, validateContentPackContract } = require('../src/game-core/index.ts');
const { compileCompactEffectList } = require('../src/game-core/compactEffectDsl.ts');
const { convertMvuCards } = require('../src/fish/core/mvuBattleAdapter.ts');
const { BattleStateStore, createEmptyBattleState } = require('../src/game-core/battleState.ts');
const { finalizeRuntimeCardProgression } = require('../src/fish/core/battleEndHost.ts');
const { applyPersistentDeckMutation, migratePersistentRunDeck } = require('../src/game-core/cardProgression.ts');
const { transformCardInstance } = require('../src/game-core/advancedCardZoneTransaction.ts');
const { planNonCombatDeckAction } = require('../src/game-core/nonCombatDeckActions.ts');
const { executeUnifiedRunTransactionInStat } = require('../src/common/runTransactions.ts');
const { PendingCardRemoval } = require('../src/common/pendingCardRemoval.ts');
const { describeCardTraits } = require('../src/game-core/cardLifecycle.ts');
const { presentCompactContent } = require('../src/game-core/contentPresentation.ts');
const { effectProgramToDisplayTags } = require('../src/game-core/effectDisplay.ts');
const { CardSystem } = require('../src/fish/combat/cardSystem.ts');
const { applyOpeningDeckTransforms, describeOpeningDeckTransforms } = require('../src/game-core/towerOpeningTransforms.ts');
const { withAiContentDefinitions } = require('../src/game-core/aiContentJsonSchema.ts');
const runApi = require('../src/game-core/runState.ts');
const { extractArchetypeEvidence } = require('../src/game-core/archetypeEvidence.ts');
const locked = { id: 'oath', name: '不灭誓约', type: 'Skill', rarity: 'Common', cost: 0, quantity: 1,
  effects: { block: 2 }, lifecycle: { removable: false, transformable: false, on_discard: 'purge' } };
const free = { ...locked, id: 'free', name: '散页', lifecycle: {} };
assert.equal(validateContentPackContract(createContentPack({ cards: [locked] })).ok, true);
assert.equal(validateContentPackContract(createContentPack({ cards: [{ ...locked, lifecycle: { removable: 'false' } }] })).ok, false);
const { quantity, ...template } = locked;
const program = compileCompactEffectList({ add_card: locked.id }, { creates: [template] });
assert.equal(program.ok, true, JSON.stringify(program.issues));
assert.deepEqual(program.value.steps[0].card.lifecycle, locked.lifecycle);
const authoredSchema = JSON.parse(await readFile('schemas/mwg-card-effects-v1.schema.json', 'utf8'));
const astSchema = JSON.parse(await readFile('schemas/mwg-effect-v1.schema.json', 'utf8'));
const ajv = new Ajv2020({ strict: false });
const validate = ajv.compile(astSchema);
assert.equal(validate(program.value), true, JSON.stringify(validate.errors));
const validateTemplate = new Ajv2020({ strict: false }).compile({ $defs: authoredSchema.$defs, $ref: '#/$defs/cardTemplate' });
assert.equal(validateTemplate(template), true, JSON.stringify(validateTemplate.errors));
const validatePublicCard = new Ajv2020({ strict: false }).compile(withAiContentDefinitions({ $ref: '#/$defs/mwgCard' }));
assert.equal(validatePublicCard(locked), true, JSON.stringify(validatePublicCard.errors));
assert.match(presentCompactContent(locked, 'card').rulesText, /不可移除/);
assert.match(effectProgramToDisplayTags(program.value).map(tag => tag.reference?.rules || '').join(' '), /不可变形/);
assert.ok(describeCardTraits(locked).some(trait => trait.name === '遗忘·本场'));
const operations = extractArchetypeEvidence(createContentPack({ cards: [locked] }).cards[0]).operations;
assert.ok(operations.includes('discard_remove'));
assert.ok(!operations.includes('discard_purge'), 'scoring must not report permanent card loss for a protected card');
const deck = migratePersistentRunDeck([locked, free]);
const before = structuredClone(deck);
for (const kind of ['remove', 'transform']) {
  assert.throws(() => applyPersistentDeckMutation(deck, { kind, runInstanceId: deck[0].runInstanceId, replacement: free }), /不可/);
  const plan = planNonCombatDeckAction(deck, { id: 'event', kind, count: 1, pick: 'choose', ...(kind === 'transform' ? { replacement: free } : {}) }, 'seed');
  assert.deepEqual(plan.candidates.map(card => card.id), ['free']);
}
assert.deepEqual(deck, before);
const replacement = { ...free, id: 'renewed', name: '新生' };
const transformAll = [{ filter: { types: ['Skill'] }, replacement }];
assert.deepEqual(applyOpeningDeckTransforms(deck, transformAll, value => value).map(card => card.id), ['oath', 'renewed']);
assert.match(describeOpeningDeckTransforms(transformAll, deck).join(' '), /当前1张可变形/);
assert.equal(applyPersistentDeckMutation(deck, { kind: 'remove', runInstanceId: deck[1].runInstanceId }).cards.length, 1);
const independentlyBound = [{ ...deck[0], lifecycle: { removable: false } }];
assert.equal(applyPersistentDeckMutation(independentlyBound, { kind: 'transform', runInstanceId: deck[0].runInstanceId, replacement: free }).cards[0].id, 'free');
const stat = { battle: { core: { card_removal_count: 2 }, cards: deck }, run_transaction_revision: 0 };
const statBefore = structuredClone(stat);
assert.throws(() => executeUnifiedRunTransactionInStat(stat, { kind: 'allowance_remove_card', runInstanceId: deck[0].runInstanceId, expectedRevision: 0, source: { kind: 'player', id: 'test' } }), /不可永久移除/);
assert.deepEqual(stat, statBefore, 'failed deletion must not spend allowance, change revision or rewrite the deck');
const initialRun = runApi.createRunState({ seed: 7, routeMode: 'map' });
let shopRun;
searchShop: for (const path of initialRun.map.acts[0].paths) {
  let run = initialRun;
  for (const nodeId of path) {
    const choice = run.choices.find(entry => entry.id === nodeId);
    if (!choice) break;
    run = runApi.enterRunNode(run, nodeId);
    if (choice.kind === 'shop') { shopRun = run; break searchShop; }
    run = runApi.completeRunNode(run, { outcome: 'cleared' });
  }
}
assert.ok(shopRun);
const shopStat = { ...structuredClone(stat), run: { ...shopRun, gold: 1000 }, run_shop: { removal_used: false } };
const shopBefore = structuredClone(shopStat);
assert.throws(() => executeUnifiedRunTransactionInStat(shopStat, { kind: 'shop_remove_card', runInstanceId: deck[0].runInstanceId,
  source: { kind: 'player', id: 'shop-test' } }), /不可永久移除/);
assert.deepEqual(shopStat, shopBefore, 'blocked shop removal must not spend gold or mark the service used');
let offered = false;
await new PendingCardRemoval().offer({ read: () => ({ battle: { core: { card_removal_count: 1 }, cards: [locked] } }), active: () => true,
  choose: async () => { offered = true; return null; }, commit: async () => assert.fail('cannot commit'), changed: async () => {} }, true);
assert.equal(offered, false, 'no empty removal popup when every card is protected');
for (const reason of ['effect', 'player_choice', 'turn_cleanup']) {
  const cards = convertMvuCards([locked, free]);
  const state = createEmptyBattleState();
  state.phase = 'player_turn'; state.player.deck = cards; state.player.hand = [cards[0]];
  const store = new BattleStateStore(state);
  assert.throws(() => transformCardInstance(cards[0], cards[1]), /不可变形/);
  const host = Object.create(CardSystem.prototype);
  host.gameStateManager = store; host.triggerDiscardEffect = async () => {}; host.dispatchPlayerTrigger = async () => {};
  host.relicTriggerHost = { triggerRelics: async () => {} };
  const logs = [];
  host.presentation = { animateCardDeparture() {}, logDiscardCardDetail() {}, addLog(text) { logs.push(text); } };
  if (reason === 'turn_cleanup') {
    const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
    const previousInstance = UnifiedEffectExecutor.getInstance;
    try {
      UnifiedEffectExecutor.getInstance = () => ({ getCardPlayRules: () => [] });
      await host.discardHand();
    } finally { UnifiedEffectExecutor.getInstance = previousInstance; }
    assert.equal(store.getPlayer().discardPile.length, 0, 'protected forget still leaves the battle on cleanup');
  } else await host.discardCard(cards[0].id, reason);
  assert.equal(store.getPlayer().hand.length, 0);
  assert.equal(store.getPlayer().deck.length, 2);
  assert.equal(store.getGameState().purgedRunInstanceIds?.length || 0, 0);
  assert.ok(logs.some(text => text.includes('原持有牌组保留')));
  // A transformed combat incarnation cannot evade the original's protection.
  store.purgeOwnedCard({ ...cards[0], lifecycle: {} });
  const restored = new BattleStateStore(JSON.parse(JSON.stringify(store.getGameState())));
  const final = finalizeRuntimeCardProgression(restored, { stat_data: { battle: { cards: [locked, free] } } }, false);
  assert.equal(final.length, 2);
  assert.equal(final.find(card => card.id === locked.id).lifecycle.removable, false);
}
console.log('PASS card removal permissions: schemas, compile, execution, discard/cleanup, transactions, selection, save/recovery and both displays');
