import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

const enemy = id => ({
  id, name: id, emoji: 'E', maxHp: 20, currentHp: 20, maxLust: 100, currentLust: 0,
  energy: 0, maxEnergy: 0, block: 0, statusEffects: [], intent: { type: 'special', description: '', emoji: '?' },
  actions: [], nextAction: null, dialogue: '',
});
const state = core.createEmptyBattleState();
state.currentTurn = 3;
state.enemies = [enemy('left'), enemy('right')];
state.activeEnemyId = 'right';
const store = new core.BattleStateStore(state);

const sequence = [];
const executor = Object.create(UnifiedEffectExecutor.prototype);
executor.gameStateManager = store;
executor.executionContext = { sourceIsPlayer: true, cardContext: { id: 'mode_card', name: '模式切换', type: 'Skill' } };
executor.presentation = { addLog: (message, type) => sequence.push(['log', type, message]) };
executor.executeEffectProgram = async (program, sourceIsPlayer, context) => {
  sequence.push([
    'program', context.triggerType, sourceIsPlayer,
    context.abilityContext?.id,
    context.orbValue,
    program.steps.map(step => step.op).join(','),
  ]);
};

const calm = {
  id: 'calm', name: '静心',
  enterEffects: [{ op: 'gain_block', target: 'self', amount: 2 }],
  exitEffects: [{ op: 'gain_energy', target: 'self', amount: 1 }],
  passiveEffects: [{ op: 'modify', target: 'self', stat: 'block', operator: 'add', value: 1 }],
};
const rage = {
  id: 'rage', name: '激怒',
  enterEffects: [{ op: 'gain_energy', target: 'self', amount: 2 }],
};

await executor.executeSpecialCombatCommand({ type: 'set_stance', target: 'self', stance: calm }, true);
assert.equal(store.getPlayer().stance.id, 'calm');
assert.deepEqual(sequence.filter(entry => entry[0] === 'program').map(entry => entry[1]), ['stance_enter']);
sequence.length = 0;
await executor.executeSpecialCombatCommand({ type: 'set_stance', target: 'self', stance: { ...calm, name: '同 ID' } }, true);
assert.equal(sequence.length, 0, 'the same stance ID is a complete no-op');
await executor.executeSpecialCombatCommand({ type: 'set_stance', target: 'self', stance: rage }, true);
assert.equal(store.getPlayer().stance.id, 'rage');
assert.deepEqual(sequence.filter(entry => entry[0] === 'program').map(entry => entry[1]), ['stance_exit', 'stance_enter']);

sequence.length = 0;
store.setActiveEnemy('left');
store.setCombatantStance('enemy', calm);
await executor.processInitialStance('enemy');
assert.deepEqual(sequence.filter(entry => entry[0] === 'program').map(entry => [entry[1], entry[2]]), [['stance_enter', false]]);
assert.equal(store.getGameState().eventJournal.events.at(-1).actorId, 'left');
store.setActiveEnemy('right');

sequence.length = 0;
await executor.executeSpecialCombatCommand({ type: 'set_orb_slots', target: 'opponent', amount: 2 }, true);
const orbA = {
  id: 'spark', name: '火花', value: 3,
  passiveEffects: [{ op: 'gain_block', target: 'self', amount: { op: 'var', path: 'context.orb_value' } }],
  evokeEffects: [{ op: 'damage', target: 'opponent', amount: { op: 'var', path: 'context.orb_value' } }],
};
const orbB = { ...orbA, id: 'frost', name: '冰霜', value: 5 };
const orbC = { ...orbA, id: 'dark', name: '黑暗', value: 7 };
await executor.executeSpecialCombatCommand({ type: 'channel_orb', target: 'opponent', orb: orbA }, true);
await executor.executeSpecialCombatCommand({ type: 'channel_orb', target: 'opponent', orb: orbB }, true);
await executor.executeSpecialCombatCommand({ type: 'channel_orb', target: 'opponent', orb: orbC }, true);
assert.deepEqual(store.getEnemyById('right').orbs.orbs.map(orb => orb.id), ['frost', 'dark']);
assert.deepEqual(
  sequence.filter(entry => entry[0] === 'program').map(entry => [entry[1], entry[2], entry[4]]),
  [['orb_evoke', false, 3]],
  'evicting the oldest enemy Orb executes its evoke program from the enemy perspective',
);

sequence.length = 0;
await executor.processOrbPassives('enemy');
assert.deepEqual(
  sequence.filter(entry => entry[0] === 'program').map(entry => [entry[1], entry[4]]),
  [['orb_passive', 5], ['orb_passive', 7]],
  'Orb passives resolve in stable left-to-right slot order with their own values',
);
await executor.executeSpecialCombatCommand({
  type: 'modify_orbs', target: 'opponent', selector: { pick: 'last' }, operator: 'multiply', value: 1.5,
}, true);
assert.deepEqual(store.getEnemyById('right').orbs.orbs.map(orb => orb.value), [5, 10.5]);

sequence.length = 0;
await executor.executeSpecialCombatCommand({ type: 'set_orb_slots', target: 'opponent', amount: 1 }, true);
assert.deepEqual(store.getEnemyById('right').orbs.orbs.map(orb => orb.id), ['frost']);
assert.deepEqual(sequence.filter(entry => entry[0] === 'program').map(entry => [entry[1], entry[4]]), [['orb_evoke', 10.5]]);

await executor.executeSpecialCombatCommand({ type: 'evoke_orbs', target: 'opponent', selector: { pick: 'all' } }, true);
assert.equal(store.getEnemyById('right').orbs.orbs.length, 0);
await executor.executeSpecialCombatCommand({ type: 'grant_extra_turn', target: 'opponent', amount: 2 }, true);
await executor.executeSpecialCombatCommand({ type: 'force_end_turn', target: 'opponent' }, true);
assert.equal(store.getGameState().turnControl.extraEnemyTurns, 2);
assert.equal(store.getGameState().turnControl.forceEndEnemy, true);

const journal = store.getGameState().eventJournal.events;
assert.equal(journal.some(event => event.kind === 'stance_changed' && event.nextStanceId === 'calm'), true);
assert.equal(journal.some(event => event.kind === 'orb_channeled' && event.actorId === 'right'), true);
assert.equal(journal.some(event => event.kind === 'orb_evoked' && event.orbId === 'spark'), true);
assert.equal(journal.some(event => event.kind === 'orb_value_changed' && event.nextValue === 10.5), true);
assert.equal(journal.some(event => event.kind === 'turn_control_changed' && event.actorId === 'right'), true);
for (const event of journal.filter(event => ['stance_changed', 'orb_channeled', 'orb_evoked', 'orb_value_changed', 'turn_control_changed'].includes(event.kind))) {
  if (event.cause.source.id === 'initial_stance') {
    assert.equal(event.kind, 'stance_changed', 'only the battle-start stance may use the synthetic initial source');
  } else {
    assert.equal(event.cause.source.id, 'mode_card');
  }
}

console.log('Stance transitions, Orb passives/evokes, multi-enemy identity, causal logs, and turn control integrate correctly.');
