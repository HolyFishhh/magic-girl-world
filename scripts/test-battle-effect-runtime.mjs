import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  BattleEffectRuntime,
  BattleStateStore,
  createEmptyBattleState,
  isBattleEffectCommand,
} = require(resolve('src/game-core/index.ts'));

function enemy(overrides = {}) {
  return {
    id: 'enemy',
    name: 'Enemy',
    maxHp: 40,
    currentHp: 30,
    maxLust: 100,
    currentLust: 0,
    energy: 0,
    maxEnergy: 0,
    block: 5,
    statusEffects: [],
    intent: { type: 'attack', description: '', emoji: '' },
    emoji: '',
    actions: [],
    nextAction: null,
    dialogue: '',
    ...overrides,
  };
}

function fixture() {
  const state = createEmptyBattleState();
  state.player.maxHp = 80;
  state.player.currentHp = 50;
  state.player.maxLust = 100;
  state.player.currentLust = 10;
  state.player.energy = 3;
  state.player.maxEnergy = 3;
  state.player.block = 0;
  state.enemy = enemy();
  return new BattleStateStore(state);
}

const store = fixture();
const events = [];
const dispatches = [];
const modifierSources = new Map([
  ['player:damage_modifier', [{ operation: { operator: '+', value: 2 }, name: 'Power' }]],
  ['enemy:damage_taken_modifier', [{ operation: { operator: '*', value: 2 }, name: 'Weakness' }]],
  ['player:heal_modifier', [{ operation: { operator: '+', value: 5 }, name: 'Grace' }]],
  ['enemy:lust_damage_taken_modifier', [{ operation: { operator: '+', value: 4 }, name: 'Charm' }]],
]);
let overflowTarget = null;
const runtime = new BattleEffectRuntime(store, {
  readModifierSources: (target, modifier) => modifierSources.get(`${target}:${modifier}`) || [],
  dispatchTriggers: async planned => {
    dispatches.push(...planned);
    if (planned.some(entry => entry.trigger === 'lose_block' && entry.target === 'enemy')) {
      const current = store.getEnemy();
      store.updateEnemy({ currentHp: current.currentHp + 3 });
    }
  },
  handleLustOverflow: async target => {
    overflowTarget = target;
    if (target === 'enemy') store.updateEnemy({ currentLust: 0 });
  },
  present: event => events.push(event),
});

assert.equal(isBattleEffectCommand({ type: 'damage', target: 'opponent', amount: 1 }), true);
assert.equal(isBattleEffectCommand({ type: 'draw_cards', amount: 1 }), false);

const damage = await runtime.execute(
  { type: 'damage', target: 'opponent', amount: 10 },
  { source: 'player' },
);
assert.deepEqual(damage, { applied: true, target: 'enemy', pendingDeath: false });
assert.equal(store.getEnemy().block, 0);
assert.equal(
  store.getEnemy().currentHp,
  14,
  '10 + 2 outgoing, then x2 incoming, minus 5 block; lose_block trigger heals 3 before 19 HP loss',
);
assert.deepEqual(
  dispatches.filter(entry => entry.consumer === 'ability').map(entry => [entry.target, entry.trigger]),
  [
    ['enemy', 'lose_block'],
    ['enemy', 'take_damage'],
    ['player', 'deal_damage'],
  ],
);
assert.deepEqual(
  events.filter(event => event.type === 'modifier_applied').map(event => event.nextValue),
  [12, 24],
);
assert.equal(events.filter(event => event.type === 'block_absorbed').length, 1);

await runtime.execute({ type: 'heal', target: 'self', amount: 40 }, { source: 'player' });
assert.equal(store.getPlayer().currentHp, 80, 'healing remains clamped to max HP after modifiers');

await runtime.execute({ type: 'gain_energy', target: 'self', amount: 2 }, { source: 'player' });
assert.equal(store.getPlayer().energy, 5, 'temporary energy keeps the established no-upper-clamp behavior');

await runtime.execute({ type: 'set_stat', target: 'self', stat: 'block', value: 7 }, { source: 'enemy' });
assert.equal(store.getEnemy().block, 7, 'self/opponent is resolved from the actual source side');

await runtime.execute(
  { type: 'modify', target: 'opponent', stat: 'damage_taken', operator: 'multiply', value: 3 },
  { source: 'enemy' },
);
assert.equal(store.getPlayer().modifiers.damage_taken_modifier, 0, 'multiplying an absent direct modifier preserves zero');
await runtime.execute(
  { type: 'modify', target: 'opponent', stat: 'damage_taken', operator: 'add', value: 2 },
  { source: 'enemy' },
);
assert.equal(store.getPlayer().modifiers.damage_taken_modifier, 2);

store.updateEnemy({ currentLust: 95 });
await runtime.execute({ type: 'gain_lust', target: 'opponent', amount: 2 }, { source: 'player' });
assert.equal(overflowTarget, 'enemy');
assert.equal(store.getEnemy().currentLust, 0, 'overflow handler observes the final post-trigger state');

store.updateEnemy({ currentHp: 1, block: 0 });
const lethal = await runtime.execute({ type: 'damage', target: 'opponent', amount: 99 }, { source: 'player' });
assert.equal(lethal.pendingDeath, true);
assert.equal(store.getEnemy().currentHp, 0);

const noTargetState = createEmptyBattleState();
const noTargetStore = new BattleStateStore(noTargetState);
const noTargetRuntime = new BattleEffectRuntime(noTargetStore, {
  readModifierSources: () => [],
  dispatchTriggers: async () => {},
  handleLustOverflow: async () => {},
});
assert.deepEqual(
  await noTargetRuntime.execute({ type: 'damage', target: 'opponent', amount: 1 }, { source: 'player' }),
  { applied: false, target: 'enemy' },
);

console.log('Portable battle effects preserve modifiers, block ordering, triggers, clamping, overflow, and death marks.');
