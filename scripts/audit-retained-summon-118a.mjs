// Read-only replay of retained sample 64. Never starts an AI request or writes a save.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { compileInitialDraftToMvu } = require('../src/game-core/initialDraft.ts');
const { normalizeMvuPlayerAuthoredContent } = require('../src/runtime/mvuBattleContentNormalizer.ts');
const { createBattleRequestFromMvu } = require('../src/fish/core/battleContractAdapter.ts');
const { convertMvuCards } = require('../src/fish/core/mvuBattleAdapter.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const rawPath = 'tmp/initial64-mechanism-final-v120.json';
const savedPath = 'tmp/initial64-final-browser-v120.json';
const rawBytes = readFileSync(rawPath, 'utf8'), savedBytes = readFileSync(savedPath, 'utf8');
const responses = JSON.parse(rawBytes);
assert.equal(responses.length, 1);
const raw = responses[0].value;
const saved = JSON.parse(savedBytes).root.stat_data.battle;
const compiled = compileInitialDraftToMvu(normalizeMvuPlayerAuthoredContent({ ...raw,
  narrative: 'Offline compilation stub, never a replacement for the preset story.',
}));
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
for (const id of ['summon_wisp', 'lantern_ritual', 'wisp_empower']) {
  const authored = raw.player.cards.find(c => c.id === id);
  assert.ok(authored);
  assert.deepEqual(compiled.value.player.cards.find(c => c.id === id).effects, authored.effects);
  assert.deepEqual(saved.cards.find(c => c.id === id).effects, authored.effects);
}
const summon = raw.player.cards.find(c => c.id === 'summon_wisp').effects.spawn_summon;
assert.equal(summon.abilities, undefined, 'independent ability absent in original response, not lost by compiler');
const battle = { ...structuredClone(saved), enemy: {
  id: 'audit_dummy', name: 'Offline target', emoji: '◇', hp: 100, max_hp: 100,
  lust: 0, max_lust: 100, actions: [{ name: 'wait', effects: { block: 1 } }],
} };
const store = GameStateManager.getInstance();
store.convertMVUToGameState(createBattleRequestFromMvu({ stat_data: { battle } }, battle));
store.setCurrentTurn(1);
store.setPhase('player_turn');
const executor = UnifiedEffectExecutor.getInstance();
executor.presentation = new Proxy({}, { get: () => async () => undefined });
async function effect(id) {
  const [card] = convertMvuCards([battle.cards.find(c => c.id === id)]);
  assert.ok(card?.effectProgram);
  await executor.executeEffectProgram(card.effectProgram, true, { cardContext: card });
}
await effect('summon_wisp');
assert.equal(store.getSummons('player').length, 1);
assert.equal(store.getSummons('player')[0].currentHp, 2);
await executor.processSummonActions('player');
assert.equal(store.getEnemy().currentHp, 97);
await effect('wisp_empower');
store.replaceState(JSON.parse(JSON.stringify(store.getGameState())));
await executor.processSummonActions('player');
assert.equal(store.getEnemy().currentHp, 92, 'authored +2 survives state restoration and modifies real summon damage');
assert.equal(readFileSync(rawPath, 'utf8'), rawBytes);
assert.equal(readFileSync(savedPath, 'utf8'), savedBytes);
console.log('PASS retained64 provenance and offline execution: summon/action/upgrade survive compile, persistence and state restoration. Independent ability absent already in AI output. No live acceptance or general capability claim.');
