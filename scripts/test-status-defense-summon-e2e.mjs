import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));
const { GameStateManager } = require(resolve('src/fish/core/gameStateManager.ts'));
const { DynamicStatusManager } = require(resolve('src/fish/combat/dynamicStatusManager.ts'));

const defenseDefinitions = [
  { id: 'test_cap', name: '测试无实体', emoji: '👻', type: 'buff', stacks_change: 'keep', defense: { damage_cap: 1 }, triggers: {} },
  { id: 'test_buffer', name: '测试缓冲', emoji: '🫧', type: 'buff', stacks_change: 'keep', defense: { prevent_hp_loss: true }, triggers: {} },
  { id: 'test_thorns', name: '测试荆棘', emoji: '🌵', type: 'buff', stacks_change: 'keep', defense: { retaliate_attack: 'stacks' }, triggers: {} },
];
DynamicStatusManager.getInstance().replaceDefinitions(defenseDefinitions);

const status = (id, stacks) => ({
  id, name: defenseDefinitions.find(entry => entry.id === id).name,
  emoji: defenseDefinitions.find(entry => entry.id === id).emoji,
  type: 'buff', description: '', stacks,
});
const enemy = (id, hp = 20, block = 0, statusEffects = []) => ({
  id, name: id, emoji: 'E', maxHp: hp, currentHp: hp,
  maxLust: 100, currentLust: 0, energy: 0, maxEnergy: 0, block,
  statusEffects, intent: { type: 'attack', description: '', emoji: '' },
  actions: [], nextAction: null, dialogue: '',
});

const store = GameStateManager.getInstance();
const executor = UnifiedEffectExecutor.getInstance();
executor.presentation = {
  addLog: () => {}, logStatusEffect: () => {}, showSummonAction: () => {},
  showHealthChange: () => {}, showBlockAbsorption: () => {}, showBlockChange: () => {},
  showEnergyChange: () => {}, showLustChange: () => {}, showResourceChange: () => {},
  refreshPlayerEnergy: () => {},
};

// A fully blocked player attack still receives retaliation from the exact enemy.
store.resetGame();
store.updatePlayer({ currentHp: 40, maxHp: 40, block: 0 });
store.setEnemies([enemy('enemy_a'), enemy('enemy_b', 20, 20, [status('test_thorns', 3)])], 'enemy_a');
await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 5 }] }, true, {
  boundEnemyTargetId: 'enemy_b', cardContext: { type: 'Attack' },
});
assert.equal(store.getEnemyById('enemy_b').currentHp, 20);
assert.equal(store.getEnemyById('enemy_a').currentHp, 20);
assert.equal(store.getPlayer().currentHp, 37, 'enemy B retaliates against the player even while active enemy is A');

// A fully blocked enemy attack retaliates against enemy B rather than active enemy A.
store.updatePlayer({ currentHp: 40, block: 20, statusEffects: [status('test_thorns', 2)] });
store.updateEnemyById('enemy_a', { currentHp: 20 });
store.updateEnemyById('enemy_b', { currentHp: 20, block: 0, statusEffects: [] });
await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 5 }] }, false, {
  battleContext: { enemyId: 'enemy_b', intent: { id: 'strike', name: '攻击' } },
});
assert.equal(store.getPlayer().currentHp, 40);
assert.equal(store.getEnemyById('enemy_a').currentHp, 20);
assert.equal(store.getEnemyById('enemy_b').currentHp, 18);

// A summon attacker is an independent source. Retaliation damages that exact instance and does not recurse.
const attacker = store.spawnSummons('enemy', {
  id: 'thorn_attacker', name: '荆棘攻击者', emoji: 'S', maxHp: 10,
  statusEffects: [status('test_thorns', 9)],
  actionProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 4 }] },
}, 1, undefined, undefined, 'enemy_b').spawned[0];
store.updatePlayer({ currentHp: 40, block: 20, statusEffects: [status('test_thorns', 2)] });
await executor.executeEffectProgram(attacker.actionProgram, false, {
  triggerType: 'summon_action', summonContext: attacker, abilityContext: attacker,
});
assert.equal(store.getPlayer().currentHp, 40, 'retaliation never recursively triggers the attacker thorns');
assert.equal(store.getSummonById(attacker.instanceId).currentHp, 8, 'player retaliates against the exact summon attacker');

// Intercepted attacks use the same summon defense path: cap before block, no Buffer use on full block, then retaliation.
store.resetGame();
store.updatePlayer({ currentHp: 40, maxHp: 40, block: 0 });
store.setEnemies([enemy('enemy_a'), enemy('enemy_b')], 'enemy_a');
store.updatePlayer({ statusEffects: [status('test_thorns', 2)] });
const guard = store.spawnSummons('player', {
  id: 'defense_guard', name: '防御守卫', emoji: 'G', maxHp: 10, block: 1,
  statusEffects: [status('test_cap', 1), status('test_buffer', 2), status('test_thorns', 2)],
}, 1).spawned[0];
await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 9 }] }, false, {
  battleContext: { enemyId: 'enemy_b', intent: { id: 'guard_hit', name: '攻击' } },
});
let currentGuard = store.getSummonById(guard.instanceId);
assert.equal(currentGuard.currentHp, 10);
assert.equal(currentGuard.statusEffects.find(entry => entry.id === 'test_buffer').stacks, 2, 'full block does not consume summon Buffer');
assert.equal(store.getEnemyById('enemy_a').currentHp, 20);
assert.equal(store.getEnemyById('enemy_b').currentHp, 18, 'guard retaliation keeps the exact enemy attacker');
assert.equal(store.getPlayer().currentHp, 40);

// hp_loss is capped and then prevented, while direct set_stat bypasses packet defenses.
store.modifySummons([guard.instanceId], 'block', '=', 0);
currentGuard = store.getSummonById(guard.instanceId);
await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'self', amount: 9, damageKind: 'hp_loss' }] }, true, {
  triggerType: 'tick', summonContext: currentGuard, summonStatusContext: { summonId: guard.instanceId },
});
currentGuard = store.getSummonById(guard.instanceId);
assert.equal(currentGuard.currentHp, 10);
assert.equal(currentGuard.statusEffects.find(entry => entry.id === 'test_buffer').stacks, 1, 'hp_loss consumes exactly one Buffer after cap');
await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'set_stat', target: 'self', stat: 'hp', value: 4 }] }, true, {
  summonContext: currentGuard, summonStatusContext: { summonId: guard.instanceId },
});
assert.equal(store.getSummonById(guard.instanceId).currentHp, 4, 'direct HP assignment bypasses packet defenses');

const restored = new core.BattleStateStore(structuredClone(store.getGameState()));
assert.deepEqual(
  restored.getSummonById(guard.instanceId).statusEffects,
  store.getSummonById(guard.instanceId).statusEffects,
  'snapshot restore preserves exact summon defense status stacks',
);


// Preview uses the same cap for attacks and HP loss, without consuming Buffer.
store.resetGame();
store.updatePlayer({ currentHp: 40, maxHp: 40, statusEffects: [status('test_cap', 1), status('test_buffer', 2)] });
store.setEnemies([enemy('preview', 20, 0, [status('test_cap', 1)])], 'preview');
const previewSnapshot = structuredClone(store.getGameState());
for (const kind of ['attack', 'effect', 'hp_loss']) {
  assert.equal(executor.previewPlayerCardDamage(9, 'opponent', kind).value, 1);
  assert.equal(executor.previewEnemyIntentDamage(store.getEnemy(), 9, 'opponent', kind), 1);
}
assert.deepEqual(store.getGameState(), previewSnapshot, 'previews do not consume defenses or mutate state');
await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 9, damageKind: 'attack' }] }, true, { cardContext: { type: 'Attack' } });
assert.equal(store.getEnemy().currentHp, 19, 'preview matches actual capped damage');

// Defeated/kill reactions resolve for both sides before the terminal rule.
executor.battleEndHost = { presentBattleEnd: async () => {} };
store.resetGame();
store.updatePlayer({ currentHp: 5, maxHp: 5, block: 0, statusEffects: [status('test_thorns', 2)] });
store.setEnemies([enemy('mutual_lethal', 2)], 'mutual_lethal');
await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 5 }] }, false, {
  battleContext: { enemyId: 'mutual_lethal', intent: { id: 'lethal', name: '致命攻击' } },
});
assert.equal(store.getPlayer().currentHp, 0);
assert.equal(store.getGameState().battleResult, 'victory');
const defeats = store.getGameState().eventJournal.events.filter(event => event.kind === 'entity_defeated');
assert.deepEqual(new Set(defeats.map(event => event.targetId)), new Set(['player', 'mutual_lethal']));
assert.equal(defeats.length, 2, 'one finalized defeat event per participant');

store.resetGame();
store.updatePlayer({ currentHp: 5, maxHp: 5 });
store.setEnemies([enemy('survivor', 20)], 'survivor');
await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 5 }] }, false, {
  battleContext: { enemyId: 'survivor', intent: { id: 'lethal', name: '致命攻击' } },
});
assert.equal(store.getGameState().battleResult, 'defeat', 'a surviving enemy still defeats the player');

// A nested effect must not finalize the outer damage program's player death:
// the outer program still owns its defeated/revival reactions.
store.resetGame();
store.updatePlayer({ currentHp: 0, maxHp: 5 });
store.setEnemies([enemy('nested_survivor', 20)], 'nested_survivor');
executor.pendingDeaths = new Set();
await executor.processPendingDeaths();
assert.equal(store.getGameState().isGameOver, false, 'only the program owning the fatal player packet may finalize defeat');

console.log('PASS status defense E2E covers exact player/enemy/summon retaliation, non-recursion, summon interception, hp_loss, Buffer, and snapshots');
