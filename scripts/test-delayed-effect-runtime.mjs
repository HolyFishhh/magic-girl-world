import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { TavernEffectCommandHost } = require(resolve('src/fish/core/effectCommandHost.ts'));
const { BattleManager } = require(resolve('src/fish/combat/battleManager.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

const compiled = core.compileCompactEffectList([
  {
    schedule: 1,
    phase: 'turn_start',
    priority: -2,
    repeat_every: 1,
    repeats: 2,
    effects: [{ block: 4 }, { draw: 1 }],
  },
]);
assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.issues));
const scheduledNode = compiled.value.steps[0];
assert.equal(scheduledNode.op, 'schedule_effect');
assert.equal(scheduledNode.afterTurns, 1);
assert.equal(scheduledNode.repeatEvery, 1);
assert.equal(scheduledNode.repeats, 2);
assert.deepEqual(scheduledNode.effects.map(node => node.op), ['gain_block', 'draw_cards']);
assert.match(core.effectProgramToDisplayTags(compiled.value)[0].text, /1回合后/);
assert.match(core.effectProgramToDisplayTags(compiled.value)[0].text, /合计2次/);

for (const effects of [
  [{ schedule: -1, effects: { block: 1 } }],
  [{ schedule: 1, phase: 'invalid', effects: { block: 1 } }],
  [{ schedule: 1, repeat_every: 1, effects: { block: 1 } }],
  [{ schedule: 1, effects: [] }],
]) {
  assert.equal(core.compileCompactEffectList(effects).ok, false, JSON.stringify(effects));
}
assert.equal(core.validateEffectProgram({
  spec: core.EFFECT_PROGRAM_SPEC,
  steps: [{ op: 'schedule_effect', afterTurns: 1, phase: 'turn_start', repeatEvery: 1, effects: [{ op: 'gain_block', target: 'self', amount: 1 }] }],
}).ok, false, 'internal repeat fields are an atomic pair');

const baseState = {
  self: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  opponent: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
  currentTurn: 2,
  cardsPlayedThisTurn: 0,
  attacksPlayedThisTurn: 0,
  skillsPlayedThisTurn: 0,
};
const commands = [];
await core.runEffectCommandProgram(compiled.value, { spentEnergy: 0 }, {
  readState: () => structuredClone(baseState),
  execute: command => commands.push(command),
});
assert.equal(commands.length, 1);
assert.equal(commands[0].type, 'schedule_effect');
assert.equal(commands[0].priority, -2);

const hosted = [];
const host = new TavernEffectCommandHost({
  readState: () => structuredClone(baseState),
  isTerminal: () => false,
  executeCardCommand: async () => {},
  presentCommand: () => {},
  executeBattleCommand: async () => {},
  forEachEnemyTarget: async () => {},
  applyStatus: async () => {},
  removeStatuses: async () => {},
  registerAbility: async () => {},
  scheduleEffect: async (command, sourceIsPlayer) => hosted.push({ command, sourceIsPlayer }),
  narrate: async () => {},
});
await host.executeProgram(compiled.value, true);
assert.equal(hosted.length, 1);
assert.equal(hosted[0].sourceIsPlayer, true);

const state = core.createEmptyBattleState();
state.currentTurn = 2;
const store = new core.BattleStateStore(state);
const schedulerExecutor = Object.create(UnifiedEffectExecutor.prototype);
schedulerExecutor.gameStateManager = store;
schedulerExecutor.executionContext = {
  sourceIsPlayer: true,
  cardContext: { id: 'future_guard', name: '未来防御', type: 'Skill' },
};
await schedulerExecutor.scheduleEffectCommand(commands[0], true);
assert.equal(store.readEffectScheduler().queue.length, 1);
assert.equal(store.readEffectScheduler().queue[0].dueTurn, 3);
assert.equal(store.readEffectScheduler().queue[0].source.id, 'future_guard');

const manager = Object.create(BattleManager.prototype);
manager.gameStateManager = store;
const executed = [];
const originalGetInstance = UnifiedEffectExecutor.getInstance;
UnifiedEffectExecutor.getInstance = () => ({
  executeEffectProgram: async (program, sourceIsPlayer, context) => executed.push({ program, sourceIsPlayer, context }),
});
try {
  await manager.executeScheduledPhase('turn_start');
  assert.equal(executed.length, 0, 'not-yet-due entries remain queued');
  store.setCurrentTurn(3);
  store.createSnapshot('before-first-due');
  await manager.executeScheduledPhase('turn_start');
  assert.equal(executed.length, 1);
  assert.equal(store.readEffectScheduler().queue[0].dueTurn, 4);
  assert.equal(store.restoreSnapshot('before-first-due'), true);
  await manager.executeScheduledPhase('turn_start');
  assert.equal(executed.length, 2, 'rollback restores the due occurrence exactly once');
  store.setCurrentTurn(4);
  await manager.executeScheduledPhase('turn_start');
  assert.equal(executed.length, 3);
  assert.equal(store.readEffectScheduler().queue.length, 0);
} finally {
  UnifiedEffectExecutor.getInstance = originalGetInstance;
}

const failedStore = new core.BattleStateStore(state);
failedStore.scheduleEffect(store.readEffectScheduler().queue[0] || {
  source: { kind: 'test', id: 'retry' }, owner: 'player', createdTurn: 2, dueTurn: 2,
  phase: 'turn_end', priority: 0,
  payload: { type: 'effect_program', program: { spec: core.EFFECT_PROGRAM_SPEC, steps: [{ op: 'gain_block', target: 'self', amount: 1 }] }, sourceIsPlayer: true },
});
const failedManager = Object.create(BattleManager.prototype);
failedManager.gameStateManager = failedStore;
UnifiedEffectExecutor.getInstance = () => ({ executeEffectProgram: async () => { throw new Error('expected failure'); } });
try {
  await assert.rejects(() => failedManager.executeScheduledPhase('turn_end'), /expected failure/);
  assert.equal(failedStore.readEffectScheduler().queue.length, 1, 'failed phase keeps the original scheduler entry for retry');
} finally {
  UnifiedEffectExecutor.getInstance = originalGetInstance;
}

console.log('Delayed compact effects compile, persist, execute at ordered phases, repeat, restore, and remain retryable after failure.');
