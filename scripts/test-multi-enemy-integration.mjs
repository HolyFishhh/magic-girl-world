import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { inspectBattleDataContract } = require(resolve('src/fish/core/battleDataContract.ts'));
const { preflightBattleContent } = require(resolve('src/fish/core/battleContentPreflight.ts'));
const { convertMvuEnemies } = require(resolve('src/fish/core/mvuBattleAdapter.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

const mvuEnemy = (id, hp = 12, extra = {}) => ({
  id,
  name: `敌人${id}`,
  emoji: '👾',
  hp,
  max_hp: hp,
  lust: 0,
  max_lust: 100,
  actions: [{ name: '攻击', weight: 1, effects: { damage: 3 } }],
  abilities: [],
  status_effects: [],
  lust_effect: { name: '失控', effects: { damage: 2 } },
  action_mode: 'random',
  action_config: {},
  ...extra,
});

const battle = {
  core: { emoji: '🧙', hp: 30, max_hp: 30, lust: 0, max_lust: 100 },
  cards: [{ id: 'strike', name: '打击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 10, effects: { damage: 6 } }],
  artifacts: [],
  items: [],
  statuses: [],
  player_status_effects: [],
  player_abilities: [],
  player_lust_effect: { name: '反击', effects: { damage: 3 } },
  enemies: [
    mvuEnemy('front', 10, { action_priority: 2, speed: 1 }),
    mvuEnemy('back', 14, { action_priority: 1, speed: 4 }),
  ],
};

const inspected = inspectBattleDataContract({ stat_data: { battle } });
assert.equal(inspected.ok, true, inspected.ok ? '' : JSON.stringify(inspected.issue));
const duplicate = structuredClone(battle);
duplicate.enemies[1].id = 'front';
const duplicateResult = inspectBattleDataContract({ stat_data: { battle: duplicate } });
assert.equal(duplicateResult.ok, false);
assert.equal(duplicateResult.issue.path, 'battle.enemies[1].id');

const invalidSecond = structuredClone(battle);
invalidSecond.enemies[1].actions[0].effects = { unsupported_effect: 3 };
const invalidSecondResult = preflightBattleContent(invalidSecond);
assert.equal(invalidSecondResult.ok, false);
assert.ok(
  invalidSecondResult.issues.some(issue => issue.path.startsWith('battle.enemies[1].actions[0]')),
  JSON.stringify(invalidSecondResult.issues),
);

const validPreflight = preflightBattleContent(battle);
assert.equal(validPreflight.ok, true, JSON.stringify(validPreflight.issues));
const converted = convertMvuEnemies(battle.enemies, () => 0);
assert.deepEqual(converted.map(enemy => enemy.id), ['front', 'back']);
assert.equal(converted[0].actionPriority, 2);
assert.equal(converted[1].speed, 4);

const state = core.createEmptyBattleState();
state.player.currentHp = 30;
state.player.maxHp = 30;
const store = new core.BattleStateStore(state);
store.setEnemies(converted, 'front');

// Exercise the Tavern coordinator without DOM dependencies. A lethal hit makes
// the legacy active alias advance immediately, so the executor must retain the
// original enemy ID for death processing and the event journal.
const executor = Object.create(UnifiedEffectExecutor.prototype);
executor.gameStateManager = store;
executor.executionContext = {
  sourceIsPlayer: true,
  cardContext: { id: 'finisher', name: '终结', type: 'Attack' },
};
executor.pendingDeaths = new Set();
executor.currentResolvedEnemyId = null;
executor.presentation = {
  addLog: () => {},
  showBlockAbsorption: () => {},
  showHealthChange: () => {},
  showLustChange: () => {},
  refreshPlayerEnergy: () => {},
};
let defeated = null;
executor.completeBattleEnd = async result => { defeated = result; };
executor.battleEffectRuntime = {
  execute: async (_command, options) => {
    const victim = store.getEnemy();
    assert.ok(victim);
    store.updateEnemyById(victim.id, { currentHp: 0 });
    executor.presentBattleEffectRuntimeEvent({
      type: 'damage_resolved',
      source: options.source,
      target: 'enemy',
      damageKind: options.damageKind,
      requested: victim.currentHp,
      modified: victim.currentHp,
      blocked: 0,
      hpLost: victim.currentHp,
    });
    return { applied: true, target: 'enemy', pendingDeath: true };
  },
};

await executor.executeModernBattleCommand({ type: 'damage', target: 'opponent', amount: 99 }, true);
assert.deepEqual([...executor.pendingDeaths], ['front']);
assert.equal(store.getGameState().eventJournal.lastDamage.targetId, 'front');
assert.equal(store.getGameState().eventJournal.lastDamage.fatal, true);
await executor.processPendingDeaths();
assert.deepEqual(store.getEnemies().map(enemy => enemy.id), ['back']);
assert.equal(store.getEnemy().id, 'back');
assert.equal(defeated, null, 'the battle continues while another enemy lives');

await executor.executeModernBattleCommand({ type: 'damage', target: 'opponent', amount: 99 }, true);
assert.deepEqual([...executor.pendingDeaths], ['back']);
assert.equal(store.getGameState().eventJournal.lastDamage.targetId, 'back');
await executor.processPendingDeaths();
assert.equal(store.getEnemies().length, 0);
assert.equal(defeated, 'victory', 'only the last enemy death ends the battle');

console.log('Multi-enemy MVU, preflight paths, conversion, lethal target identity, death removal, and final victory integrate correctly.');
