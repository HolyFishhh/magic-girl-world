import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/index.ts');
const { createBattleRequestFromMvu } = require('../src/fish/core/battleContractAdapter.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { DynamicStatusManager } = require('../src/fish/combat/dynamicStatusManager.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const { CardSystem } = require('../src/fish/combat/cardSystem.ts');
const { BattleManager } = require('../src/fish/combat/battleManager.ts');

// Captured AI mechanics stay byte-identical. Enemy and presentation are test
// fixtures; this test neither connects to Tavern nor writes a live save.
const path = 'tmp/initial97-final-browser-v176.json';
const bytes = readFileSync(path);
const capture = JSON.parse(bytes);
const original = JSON.parse(capture.evidence.find(e => e.stage === 'compiled-result').text);
const battle = { ...structuredClone(original.player), enemy: {
  id: 'lifecycle_fixture', name: '测试机关', emoji: '⚙️', hp: 100, max_hp: 100,
  lust: 0, max_lust: 30, actions: [{ name: '轻敲', effects: { damage: 2 } }],
} };
const store = GameStateManager.getInstance();
const executor = UnifiedEffectExecutor.getInstance();
const cards = CardSystem.getInstance();
const manager = BattleManager.getInstance();
const quiet = new Proxy({}, { get: () => async () => undefined });
executor.presentation = quiet;
cards.presentation = quiet;
manager.relicTriggerHost.presentation = quiet;
manager.enemyIntentPresenter = quiet;
store.convertMVUToGameState(createBattleRequestFromMvu({ stat_data: { battle } }, battle));
assert.deepEqual(DynamicStatusManager.getInstance().registry.replace(battle.statuses).rejected, []);
manager.prepareInitialPlayerTurn();
await manager.relicTriggerHost.triggerRelics('battle_start');
await manager.beginInitialPlayerTurn();
// Draw remaining cards through the real executor to remove opening RNG from
// the trigger test. This is a test setup, not a claim about opening draw odds.
const draw = core.compileCompactEffectList({ draw: 20 });
assert.equal(draw.ok, true);
await executor.executeEffectProgram(draw.value, true);
const skill = store.getPlayer().hand.find(c => c.templateId === 'echo_weave');
assert.ok(skill);
assert.equal(await cards.playCard(skill.id), true);
const observations = [];
const result = await core.runBattleTurnFlow({
  isTerminal: () => store.isGameOver(),
  beginEnemyTurn: () => store.beginEnemyTurn(),
  consumeExtraTurn: actor => store.consumeExtraTurn(actor),
  execute: async step => {
    await manager.executeTurnFlowStep(step);
    observations.push({ step, hand: store.getPlayer().hand.filter(c => c.templateId === 'scrap_page').map(c => c.id),
      stacks: store.getPlayer().statusEffects.find(s => s.id === 'echo_weave')?.stacks ?? 0 });
  },
});
assert.equal(result.completed, true);
const cleanup = observations.find(o => o.step === 'player_cards_end');
const generated = observations.find(o => o.step === 'player_statuses_end');
assert.equal(cleanup.hand.length, 0);
assert.equal(observations.find(o => o.step === 'player_abilities_end').hand.length, 1);
assert.equal(generated.hand.length, 1);
assert.equal(cleanup.stacks, 2);
assert.equal(generated.stacks, 1);
assert.ok(store.getPlayer().hand.some(c => c.id === generated.hand[0]));
assert.deepEqual(readFileSync(path), bytes);
console.log(JSON.stringify({ sample: 97, result: 'PASS', observations,
  scope: 'Production turn steps: status generates after cleanup and the same card survives into the next turn. Not a full gameplay or requirement-completion test.' }));
