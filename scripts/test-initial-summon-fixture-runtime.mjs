// Execute sample 16's unchanged AI mechanics in the real battle host, offline.
// No live save writes, new model requests, or independent-success claim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/index.ts');
const { INITIAL_DRAFT_SPEC, compileInitialDraftToMvu } = require('../src/game-core/initialDraft.ts');
const { normalizeMvuPlayerAuthoredContent } = require('../src/runtime/mvuBattleContentNormalizer.ts');
const { createBattleRequestFromMvu } = require('../src/fish/core/battleContractAdapter.ts');
const { convertMvuCards } = require('../src/fish/core/mvuBattleAdapter.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const raw = JSON.parse(readFileSync(new URL('./fixtures/initial-draft-summon-missing-spec.json', import.meta.url), 'utf8'));
const before = structuredClone(raw);
const draft = compileInitialDraftToMvu(normalizeMvuPlayerAuthoredContent({
  ...raw, spec: INITIAL_DRAFT_SPEC, narrative: '隔离执行测试，不替代真实 preset 正文。',
}));
assert.equal(draft.ok, true, JSON.stringify(draft.diagnostics));
const battle = { ...draft.value.player, enemy: {
  id: 'audit_dummy', name: '隔离审计目标', emoji: '◇', hp: 100, max_hp: 100,
  lust: 0, max_lust: 100, actions: [{ name: '等待', effects: { block: 1 } }],
} };
const store = GameStateManager.getInstance();
store.convertMVUToGameState(createBattleRequestFromMvu({ stat_data: { battle } }, battle));
store.setCurrentTurn(1);
store.setPhase('player_turn');
const executor = UnifiedEffectExecutor.getInstance();
executor.presentation = new Proxy({}, { get: () => async () => undefined });
async function effect(id) {
  const card = battle.cards.find(entry => entry.id === id);
  assert.ok(card, id);
  const [runtimeCard] = convertMvuCards([card]);
  assert.ok(runtimeCard?.effectProgram, id);
  await executor.executeEffectProgram(runtimeCard.effectProgram, true, { cardContext: runtimeCard });
}

await effect('warden_flash');
assert.equal(store.getEnemy().currentHp, 97, 'no summon: the authored formula deals 3');
await effect('call_lantern_warden');
assert.equal(store.getSummons('player').length, 1);
const summonId = store.getSummons('player')[0].instanceId;
assert.equal(store.getSummonById(summonId).currentHp, 12);
await executor.processSummonActions('player');
assert.equal(store.getEnemy().currentHp, 95, 'the actual summon independently deals 2');
assert.equal(store.getPlayer().block, 2, 'summoner_effects grants the owner, not the summon, 2 block');
assert.equal(store.getSummonById(summonId).block, 0);
await effect('warden_flash');
assert.equal(store.getEnemy().currentHp, 90, 'one summon: the same formula deals 5');

// Guardian intercepts before the original recipient's block, at most three attacks this turn.
const attack = core.compileCompactEffectList({ damage: 3 });
assert.equal(attack.ok, true);
async function incoming() {
  await executor.executeEffectProgram(attack.value, false, {
    battleContext: { enemyId: 'audit_dummy', intent: { id: 'probe_attack', name: '隔离攻击' } },
  });
}
await incoming();
assert.equal(store.getPlayer().currentHp, 72);
assert.equal(store.getPlayer().block, 2, 'intercepted damage does not spend the protected player block');
assert.equal(store.getSummonById(summonId).currentHp, 9, 'the guardian receives the entire attack before player block');
await incoming();
await incoming();
assert.equal(store.getSummonById(summonId).currentHp, 3);
assert.equal(store.getSummonById(summonId).interceptionsThisTurn, 3);
store.replaceState(JSON.parse(JSON.stringify(store.getGameState())));
await incoming();
assert.equal(store.getPlayer().currentHp, 71, 'the fourth attack bypasses the exhausted limit and spends player block, even after restore');
assert.equal(store.getPlayer().block, 0);
assert.equal(store.getSummonById(summonId).currentHp, 3);

await effect('light_pact_resonance');
await effect('starfire_strike');
assert.equal(store.getEnemy().currentHp, 83, 'the authored passive Power adds exactly 1 to player damage');
await effect('lamp_shell_ward');
assert.equal(store.getPlayer().block, 7, 'the same Power adds exactly 1 to player block');
assert.deepEqual(raw, before, 'execution never mutates the stored authored fixture');
console.log('PASS actual sample16 offline mechanics: 12 HP summon, independent action, summoner routing, live formula, interception before recipient block, three-hit limit after restore, passive Power. No live writes or new initial sample.');
