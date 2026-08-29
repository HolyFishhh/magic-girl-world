import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const calm = { id: 'calm', name: '静心', passiveEffects: [{ op: 'gain_block', target: 'self', amount: 1 }] };
const rage = { id: 'rage', name: '激怒', enterEffects: [{ op: 'gain_energy', target: 'self', amount: 1 }] };
const first = core.transitionStance(null, calm, 2);
assert.equal(first.changed, true);
assert.equal(first.next.enteredTurn, 2);
const same = core.transitionStance(first.next, { ...calm, name: '不应覆盖已有姿态' }, 3);
assert.equal(same.changed, false, 'reapplying the same stance ID must not repeat exit/enter effects');
assert.equal(same.next.name, '静心', 'a no-op stance application preserves the active instance');
const switched = core.transitionStance(first.next, rage, 4);
assert.equal(switched.changed, true);
assert.equal(switched.previous.id, 'calm');
assert.equal(switched.next.id, 'rage');
assert.equal(core.transitionStance(switched.next, null, 5).next, null);

const orb = (instanceId, id, value) => ({ instanceId, id, name: id, value });
let container = core.normalizeOrbContainer({ slots: 2, orbs: [] });
let channel = core.channelOrb(container, orb('a', 'lightning', 3));
assert.equal(channel.accepted, true);
assert.equal(channel.evicted, null);
container = channel.container;
container = core.channelOrb(container, orb('b', 'frost', 5)).container;
channel = core.channelOrb(container, orb('c', 'dark', 7));
assert.equal(channel.evicted.instanceId, 'a', 'a full container evokes the oldest Orb first');
assert.deepEqual(channel.container.orbs.map(value => value.instanceId), ['b', 'c']);
container = channel.container;

assert.deepEqual(core.selectOrbs(container, { pick: 'first', count: 1 }).map(value => value.instanceId), ['b']);
assert.deepEqual(core.selectOrbs(container, { pick: 'last', count: 1 }).map(value => value.instanceId), ['c']);
assert.deepEqual(core.selectOrbs(container, { pick: 'all', id: 'frost' }).map(value => value.instanceId), ['b']);
const modified = core.modifyOrbValues(container, { pick: 'all' }, 'multiply', 1.5);
assert.deepEqual(modified.container.orbs.map(value => value.value), [7.5, 10.5]);
assert.throws(() => core.modifyOrbValues(container, { pick: 'first' }, 'divide', 0), /divided by zero/);
const resized = core.resizeOrbContainer(container, 1);
assert.deepEqual(resized.container.orbs.map(value => value.instanceId), ['b']);
assert.deepEqual(resized.overflow.map(value => value.instanceId), ['c']);

let turnControl = core.normalizeTurnControl();
turnControl = core.addExtraTurns(turnControl, 'player', 2);
turnControl = core.addExtraTurns(turnControl, 'enemy', 1);
let consumed = core.consumeExtraTurn(turnControl, 'player');
assert.equal(consumed.consumed, true);
assert.equal(consumed.state.extraPlayerTurns, 1);
turnControl = core.setForceEndTurn(consumed.state, 'enemy', true);
assert.equal(turnControl.forceEndEnemy, true);
assert.equal(turnControl.forceEndPlayer, false);

const enemy = id => ({
  id, name: id, emoji: 'E', maxHp: 20, currentHp: 20, maxLust: 100, currentLust: 0,
  energy: 0, maxEnergy: 0, block: 0, statusEffects: [], intent: { type: 'special', description: '', emoji: '?' },
  actions: [], nextAction: null, dialogue: '',
});
const state = core.createEmptyBattleState();
state.enemies = [enemy('left'), enemy('right')];
state.activeEnemyId = 'left';
const store = new core.BattleStateStore(state);
store.setCombatantStance('player', calm);
store.setCombatantOrbSlots('player', 2);
store.channelCombatantOrb('player', { id: 'lightning', name: '雷', value: 3 });
store.setCombatantStance('enemy', rage);
store.setCombatantOrbSlots('enemy', 1);
store.channelCombatantOrb('enemy', { id: 'dark', name: '暗', value: 4 });
store.setActiveEnemy('right');
store.setCombatantStance('enemy', calm);
store.setCombatantOrbSlots('enemy', 1);
store.channelCombatantOrb('enemy', { id: 'frost', name: '霜', value: 5 });
assert.equal(store.getEnemyById('left').stance.id, 'rage');
assert.equal(store.getEnemyById('right').stance.id, 'calm');
assert.equal(store.getEnemyById('left').orbs.orbs[0].id, 'dark');
assert.equal(store.getEnemyById('right').orbs.orbs[0].id, 'frost');

store.queueExtraTurns('player', 2);
store.requestForceEndTurn('enemy');
store.createSnapshot('special');
store.setCombatantStance('player', rage);
store.modifyCombatantOrbValues('player', { pick: 'all' }, 'add', 9);
store.consumeExtraTurn('player');
store.consumeForceEndTurn('enemy');
assert.equal(store.restoreSnapshot('special'), true);
assert.equal(store.getPlayer().stance.id, 'calm');
assert.equal(store.getPlayer().orbs.orbs[0].value, 3);
assert.equal(store.getGameState().turnControl.extraPlayerTurns, 2);
assert.equal(store.getGameState().turnControl.forceEndEnemy, true);
assert.equal(store.getEnemyById('left').orbs.orbs[0].value, 4);
assert.equal(store.getEnemyById('right').orbs.orbs[0].value, 5);

console.log('Stances, ordered Orbs, multi-enemy isolation, turn control, save, and rollback passed.');
