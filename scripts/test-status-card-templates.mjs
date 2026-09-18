import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/index.ts');
const { compileInitialDraftToMvu } = require('../src/game-core/initialDraft.ts');
const { createInitialDraftJsonSchema } = require('../src/game-core/initialDraftSchema.ts');
const { normalizeMvuPlayerAuthoredContent } = require('../src/runtime/mvuBattleContentNormalizer.ts');
const { createBattleRequestFromMvu } = require('../src/fish/core/battleContractAdapter.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { DynamicStatusManager } = require('../src/fish/combat/dynamicStatusManager.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const { CardSystem } = require('../src/fish/combat/cardSystem.ts');
const { BattleManager } = require('../src/fish/combat/battleManager.ts');
const { settleTavernBattleVariables } = require('../src/runtime/battleSettlementAdapter.ts');
const { prepareTowerBattleForActivation } = require('../src/runtime/towerContentActivation.ts');

// Exact final AI output from the failed fifth independent start. The test
// supplies an explicit narrative stub; it is never written into a live save.
const raw = JSON.parse(readFileSync(new URL('./fixtures/initial-draft-paper-discard.json', import.meta.url), 'utf8'));
const original = structuredClone(raw);
const draft = normalizeMvuPlayerAuthoredContent({ ...raw, narrative: '测试桩：已由 preset 生成的正文。' });
const result = compileInitialDraftToMvu(draft);
assert.equal(result.ok, true, JSON.stringify(result));
assert.deepEqual(raw, original);
const status = result.value.player.statuses[0];
const token = raw.registry.templates[0];
assert.deepEqual(status.creates, [token]);
assert.deepEqual(result.value.player.artifacts[0].creates, [token]);
assert.deepEqual(status.triggers, raw.registry.statuses[0].triggers);
assert.deepEqual(result.value.player.cards, raw.player.cards);
assert.deepEqual(result.value.player.status, raw.player.status);
const schema = new Ajv2020({ strict: false, inlineRefs: false }).compile(createInitialDraftJsonSchema().value);
assert.equal(schema(draft), true, JSON.stringify(schema.errors));
const runtimeDefinition = core.normalizeRuntimeStatusDefinition(status);
assert.ok(runtimeDefinition);
assert.equal(runtimeDefinition.triggers.on_discard[0].steps[0].card.id, token.id);
assert.match(runtimeDefinition.description, /纸边/);
assert.doesNotMatch(runtimeDefinition.description, /edge_scrap/);
const uiSource = readFileSync(new URL('../src/common/index.ts', import.meta.url), 'utf8');
const uiFunctions = ['escapeHtml', 'effectTagsHtml', 'compactStatusEffectTagsHtml'].map(name => {
  const found = uiSource.match(new RegExp(`function ${name}\\([^]*?(?=\\n(?:async )?function )`))?.[0];
  assert.ok(found, `real status UI function ${name}`);
  return found;
}).join('\n');
const rendered = {};
runInNewContext(ts.transpileModule(`${uiFunctions}\nrendered.html=compactStatusEffectTagsHtml(status);`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, {
  rendered, status, compactContentToDisplayTags: core.compactContentToDisplayTags,
  contentDescriptionStatusNames: () => ({}),
  contentDescriptionEnemyNames: () => ({}),
});
assert.match(rendered.html, /纸边/);
assert.doesNotMatch(rendered.html, /edge_scrap/);
const hostile = structuredClone(status);
hostile.creates[0].name = '<img src=x onerror="alert(1)">纸边';
runInNewContext(ts.transpileModule(`${uiFunctions}\nrendered.html=compactStatusEffectTagsHtml(status);`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, {
  rendered, status: hostile, compactContentToDisplayTags: core.compactContentToDisplayTags,
  contentDescriptionStatusNames: () => ({}),
  contentDescriptionEnemyNames: () => ({}),
});
assert.match(rendered.html, /&lt;img/);
assert.doesNotMatch(rendered.html, /<img/);

const rejected = change => {
  const candidate = structuredClone(status);
  change(candidate);
  const snapshot = structuredClone(candidate);
  assert.equal(core.validateCompactStatusDefinition(candidate).ok, false, JSON.stringify(candidate));
  assert.equal(core.normalizeRuntimeStatusDefinition(candidate), null);
  assert.deepEqual(candidate, snapshot);
};
rejected(s => delete s.creates);
rejected(s => s.creates = {});
rejected(s => s.creates = Array.from({ length: 33 }, (_, i) => ({ ...token, id: `paper_${i}` })));
rejected(s => s.creates.push(structuredClone(token)));
rejected(s => s.creates[0].quantity = 1);
rejected(s => s.creates[0].retain = 'true');
rejected(s => s.creates[0].type = 'Curse'); // Authored cost may not be silently discarded.
rejected(s => s.creates[0].effects = { damage: 'stacks' }); // No captured status context in a future card.
rejected(s => s.creates[0].effects = { add_card: token.id });
rejected(s => s.triggers = { hold: s.triggers.on_discard });
rejected(s => s.triggers = { threshold_execute: s.triggers.on_discard });
rejected(s => s.triggers.on_discard = { on: 'turn_end', damage: 2 });
rejected(s => s.creates.push({ ...token, id: 'unused_bad', effects: { unsupported_operation: 1 } }));

// A generated Power has its own lifecycle. Its valid passive modifier must
// not be mistaken for an immediate status modifier. It remains a Power.
const power = structuredClone(status);
power.creates[0] = { id: token.id, name: '纸刃磨具', type: 'Power', cost: 1,
  trigger: { on: 'passive', effects: { modify: 'damage', add: 1 } } };
assert.equal(core.validateCompactStatusDefinition(power).ok, true);
assert.equal(core.normalizeRuntimeStatusDefinition(power).triggers.on_discard[0].steps[0].card.type, 'Power');

const dependency = structuredClone(status);
dependency.creates[0].effects = { apply_status: 'missing_status', stacks: 1 };
assert.ok(core.collectCompactStatusDefinitionReferences(dependency).has('missing_status'));
assert.equal(core.validateContentPackContract(core.createContentPack({ statuses: [dependency] })).ok, false);
const missing = structuredClone(draft);
missing.registry.templates = [];
const failure = compileInitialDraftToMvu(missing);
assert.equal(failure.ok, false);
assert.ok(failure.diagnostics.some(issue => issue.code === 'UNKNOWN_TEMPLATE_REF' && issue.owner[1] === 'statuses'));
assert.equal('value' in failure, false);

// Reward-only states retain their own template closure, never becoming held
// player statuses before a reward is selected.
const rewardOnly = structuredClone(draft);
rewardOnly.player.artifacts = [];
rewardOnly.opening.choices[0].outcome.reward.cards[0].effects = { apply_status: status.id, stacks: 1 };
const rewardResult = compileInitialDraftToMvu(rewardOnly);
assert.equal(rewardResult.ok, true);
assert.deepEqual(rewardResult.value.player.statuses, []);
assert.deepEqual(rewardResult.value.opening.choices[0].outcome.reward.cards[0].statuses[0].creates, [token]);

// Production Tavern battle classes, real card identities and real event
// dispatch. Only presentation and the MVU definition source are isolated.
const store = GameStateManager.getInstance();
const statusManager = DynamicStatusManager.getInstance();
const executor = UnifiedEffectExecutor.getInstance();
const cards = CardSystem.getInstance();
const manager = BattleManager.getInstance();
const quiet = new Proxy({}, { get: () => async () => undefined });
executor.presentation = quiet;
cards.presentation = quiet;
manager.relicTriggerHost.presentation = quiet;
manager.enemyIntentPresenter = quiet;
const enemy = { id: 'paper_test_enemy', name: '试验机关', emoji: '⚙️', hp: 100, max_hp: 100,
  lust: 0, max_lust: 30, actions: [{ name: '轻敲', effects: { damage: 2 } }] };
let battle = { ...structuredClone(result.value.player), enemy };
const battleBefore = structuredClone(battle);
async function effect(value) {
  const compiled = core.compileCompactEffectList(value);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  await executor.executeEffectProgram(compiled.value, true);
}
for (let encounter = 1; encounter <= 2; encounter++) {
  const request = createBattleRequestFromMvu({ stat_data: { battle } }, battle);
  store.convertMVUToGameState(request);
  assert.deepEqual(statusManager.registry.replace(battle.statuses).rejected, []);
  await manager.relicTriggerHost.triggerRelics('battle_start');
  await manager.beginInitialPlayerTurn();
  assert.equal(store.getPlayer().statusEffects.find(s => s.id === status.id).stacks, 1);
  assert.equal(store.getPlayer().hand.length, 6, 'generated opening card does not replace normal starting draw');
  const firstToken = store.getPlayer().hand.find(c => c.templateId === token.id);
  assert.ok(firstToken);
  assert.equal(firstToken.origin, 'generated');
  const previousBlock = store.getPlayer().block;
  await effect({ discard: 1, from: 'hand', pick: 'left', template_id: token.id });
  assert.ok(store.getPlayer().discardPile.some(c => c.id === firstToken.id));
  assert.equal(store.getPlayer().block, previousBlock + 3, 'the real discarded template grants its authored block');
  const nextToken = store.getPlayer().hand.find(c => c.templateId === token.id);
  assert.ok(nextToken, 'the active status creates an actual new hand instance');
  assert.notEqual(nextToken.id, firstToken.id);
  assert.equal(store.getPlayer().hand.filter(c => c.templateId === token.id).length, 1);
  const hp = store.getEnemy().currentHp;
  assert.equal(await cards.playCard(nextToken.id), true);
  assert.equal(store.getEnemy().currentHp, hp - 3, 'generated Attack targets the opponent, not its creating status holder');
  await effect({ recover: 'all', from: 'discard', pick: 'all', template_id: token.id });
  assert.ok(store.getPlayer().hand.some(c => c.id === firstToken.id), 'recovery preserves the discarded concrete identity');
  const afterEffects = store.getGameState().eventJournal.events.filter(e => e.kind === 'status_triggered' && e.statusId === status.id).length;
  assert.equal(afterEffects, 1, 'one real discarded card causes exactly one status trigger');
  const blockBeforeCleanup = store.getPlayer().block;
  await cards.discardHand();
  assert.equal(store.getPlayer().hand.length, 0, 'turn cleanup cannot accidentally generate another token');
  assert.equal(store.getPlayer().block, blockBeforeCleanup, 'turn cleanup does not run discard rewards');
  assert.equal(store.getGameState().eventJournal.events.filter(e => e.kind === 'status_triggered' && e.statusId === status.id).length, afterEffects);
  const variables = { stat_data: { battle: structuredClone(battle) } };
  settleTavernBattleVariables(variables, { result: 'victory', request, turns: 1,
    player: { currentHp: 70, currentLust: 0, resources: store.getPlayer().resources } });
  assert.deepEqual(variables.stat_data.battle.artifacts, battleBefore.artifacts);
  assert.deepEqual(variables.stat_data.battle.statuses, battleBefore.statuses);
  assert.deepEqual(variables.stat_data.battle.player_status_effects, []);
  assert.equal(variables.stat_data.battle.cards.some(c => c.id === token.id), false, 'temporary cards do not leak into the saved deck');
  // Serialize/reload exactly what the settlement kept; no fake persistent ability.
  battle = prepareTowerBattleForActivation(JSON.parse(JSON.stringify(variables.stat_data.battle)), { enemies: [enemy] });
}
// A failure after the real generated-card command must roll back the whole
// status transaction, including random state, identities and journal entries.
const beforeFailure = structuredClone(store.getGameState());
const executeProgram = executor.executeEffectProgram;
let injectedFailures = 0;
executor.executeEffectProgram = async function (program, sourceIsPlayer, context) {
  await executeProgram.call(this, program, sourceIsPlayer, context);
  if (context?.statusContext?.id === status.id) {
    injectedFailures++;
    throw new Error('injected failure after generated status card');
  }
};
try {
  // Status reactions intentionally recover-and-continue after rollback.
  await executor.processAbilitiesByTrigger('player', 'on_discard', {
    actorId: 'player', reason: 'effect',
  });
} finally { executor.executeEffectProgram = executeProgram; }
assert.equal(injectedFailures, 1);
assert.deepEqual(store.getPlayer(), beforeFailure.player);
assert.deepEqual(store.getGameState().random, beforeFailure.random);
assert.deepEqual(store.getGameState().eventJournal, beforeFailure.eventJournal);
assert.deepEqual(raw, original);
console.log('Recorded paper-discard draft: schemas, reference closure, bounded template policy, real status/card dispatch, discard/recovery, cleanup and second-battle persistence passed (offline, no live-save writes).');
