import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/index.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const { TavernBattleEffectPresenter } = require('../src/fish/ui/battleEffectPresenter.ts');

const condition = core.compileCompactCondition('self.ally_count == 0');
assert.equal(condition.ok, true, 'escape uses the shared CEL condition compiler');
const enemy = {
  id: 'runner', name: '逃跑者', emoji: '🏃', maxHp: 20, currentHp: 20, maxLust: 100, currentLust: 0,
  energy: 0, maxEnergy: 0, block: 0, statusEffects: [], actions: [], nextAction: null,
  intent: { type: 'special', description: '准备行动', emoji: '？' }, dialogue: '', escapeCondition: condition.value,
};
const marked = core.markPendingEnemyEscapes([enemy], 1, value => value.id === 'runner');
assert.equal(marked[0].escapePending, true);
assert.equal(marked[0].escapeReadyTurn, 1, 'the warning persists until the following enemy turn');
assert.equal(marked[0].nextAction, null);
assert.deepEqual(core.pendingEnemyEscapeIds(marked, 0), [], 'a warning never removes an enemy in the same turn');
assert.deepEqual(core.pendingEnemyEscapeIds(marked, 1), ['runner']);

const afterLastAllyDefeated = core.markPendingEnemyEscapes(
  [enemy],
  4,
  value => value.id === 'runner',
);
assert.equal(afterLastAllyDefeated[0].escapePending, true, 'the survivor is marked as soon as its last ally is gone');
assert.deepEqual(core.pendingEnemyEscapeIds(afterLastAllyDefeated, 3), [], 'enemy-turn condition changes still grant the next player turn');
assert.deepEqual(core.pendingEnemyEscapeIds(afterLastAllyDefeated, 4), ['runner']);

// Production execution: an outer player effect defeats the last teammate and
// the executor marks the survivor immediately, but its ready turn preserves a
// full player response window. The marker survives a save-shaped clone.
const runtimeEnemy = id => ({ ...enemy, id, nextAction: null, escapePending: undefined, escapeReadyTurn: undefined });
const manager = GameStateManager.getInstance();
const executor = UnifiedEffectExecutor.getInstance();
const presenter = TavernBattleEffectPresenter.getInstance();
const previousAddLog = presenter.addLog;
const previousDefeat = presenter.showEnemyDefeat; presenter.showEnemyDefeat = async () => {};

presenter.addLog = () => {};
try {
  manager.resetGame();
  manager.setEnemies([runtimeEnemy('opening-runner')], 'opening-runner');
  manager.setCurrentTurn(0);
  executor.refreshEnemyEscapeWarnings();
  assert.equal(manager.getEnemyById('opening-runner')?.escapePending, true, 'an opening condition is visible before the first player turn');
  assert.deepEqual(core.pendingEnemyEscapeIds(manager.getEnemies({ livingOnly: true }), 0), []);

  manager.resetGame();
  manager.setEnemies([runtimeEnemy('runner'), { ...runtimeEnemy('escort'), escapeCondition: undefined }], 'escort');
  manager.setCurrentTurn(7);
  manager.setPhase('player_turn');
  await executor.executeEffectProgram({
    spec: 'mwg.effect/v1',
    steps: [{ op: 'kill', target: 'opponent', targetSelector: { mode: 'by_id', id: 'escort' } }],
  }, true);
  const warnedAfterKill = manager.getEnemyById('runner');
  assert.equal(warnedAfterKill?.escapePending, true, 'outer kill resolution immediately exposes the escape warning');
  assert.equal(warnedAfterKill?.escapeReadyTurn, 9);
  assert.deepEqual(core.pendingEnemyEscapeIds(manager.getEnemies({ livingOnly: true }), 7), []);
  assert.deepEqual(core.pendingEnemyEscapeIds(manager.getEnemies({ livingOnly: true }), 9), ['runner']);
  const warningState = {
    ...core.createEmptyBattleState(),
    enemies: [warnedAfterKill], activeEnemyId: 'runner', enemy: warnedAfterKill, currentTurn: 7,
    battle: { player_lust_effect: { effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] } } },
  };
  const warningSnapshot = core.createBattleSessionSnapshot('warning-fixture', warningState, 1);
  const restoredWarning = core.readBattleSessionSnapshot(warningSnapshot);
  assert.equal(restoredWarning?.state.enemies[0].escapeReadyTurn, 9, 'save/restore preserves the delayed departure turn');

  manager.resetGame();
  manager.setEnemies([runtimeEnemy('enemy-turn-runner'), { ...runtimeEnemy('enemy-turn-escort'), escapeCondition: undefined }], 'enemy-turn-escort');
  manager.setCurrentTurn(11);
  manager.setPhase('enemy_turn');
  await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'kill', target: 'self' }] }, false);
  const warnedDuringEnemyTurn = manager.getEnemyById('enemy-turn-runner');
  assert.equal(warnedDuringEnemyTurn?.escapeReadyTurn, 13, 'an enemy-turn condition cannot depart in that same queue');
  assert.deepEqual(core.pendingEnemyEscapeIds(manager.getEnemies({ livingOnly: true }), 11), []);
  assert.deepEqual(core.pendingEnemyEscapeIds(manager.getEnemies({ livingOnly: true }), 13), ['enemy-turn-runner']);
} finally {
  presenter.addLog = previousAddLog; presenter.showEnemyDefeat = previousDefeat;
}

const state = {
  ...core.createEmptyBattleState(), enemies: marked, activeEnemyId: 'runner', enemy: marked[0], currentTurn: 0,
  battle: { player_lust_effect: { effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] } } },
};
const store = new core.BattleStateStore(state);
const escaped = store.removeEscapingEnemy('runner');
assert.equal(escaped?.id, 'runner');
assert.equal(store.getEnemies({ livingOnly: true }).length, 0);
assert.equal(store.getGameState().defeatedEnemies.length, 0, 'escape never becomes a defeat receipt');
assert.equal(store.getGameState().escapedEnemies[0].id, 'runner');
assert.equal(store.getGameState().eventJournal.events.some(event => event.kind === 'entity_defeated'), false);

const snapshot = core.createBattleSessionSnapshot('escape-fixture', store.getGameState(), 1);
assert.ok(core.readBattleSessionSnapshot(snapshot), 'escaped ledger and compiled condition survive a battle snapshot');
assert.equal(core.compileCompactCondition('self.ally_count = 0').ok, false, 'invalid escape syntax is rejected by the shared compiler');

console.log('Enemy escape warning, departure ledger, and snapshot contract passed.');

const {BattleManager}=require('../src/fish/combat/battleManager.ts');
const {EnemyIntentPresenter}=require('../src/fish/ui/enemyIntentPresenter.ts');
const intent=EnemyIntentPresenter.getInstance(), battleManager=BattleManager.getInstance();
const originalShow=intent.showEscape,originalLog=intent.addLog,originalComplete=executor.completeBattleAfterEnemyDeparture;
let release,completed=0;
try {
 intent.showEscape=()=>new Promise(r=>release=r);intent.addLog=()=>{};executor.completeBattleAfterEnemyDeparture=async()=>{completed++};
 for(const others of [true,false]) {
  manager.resetGame();manager.setCurrentTurn(9);manager.setEnemies([{...enemy,escapePending:true,escapeReadyTurn:9},...(others?[{...enemy,id:'stays',escapeCondition:undefined}]:[])],'runner');
  const pending=battleManager.executeTurnFlowStep('enemy_escape');
  await Promise.resolve();assert.ok(manager.getEnemyById('runner'));assert.equal(completed,0);
  release();await pending;assert.equal(manager.getEnemyById('runner'),null);assert.equal(completed,others?0:1);
 }
} finally {intent.showEscape=originalShow;intent.addLog=originalLog;executor.completeBattleAfterEnemyDeparture=originalComplete;}
console.log('Escape animation completes before removal; living teammates prevent terminal settlement.');
