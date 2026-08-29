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
assert.deepEqual(damage, { applied: true, target: 'enemy', pendingDeath: false, blocked: 5, hpLost: 19 });
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

const independentSourceStore = fixture();
independentSourceStore.updatePlayer({ modifiers: { damage_modifier: 50 } });
independentSourceStore.updateEnemy({ currentHp: 40, block: 0 });
const independentSourceRuntime = new BattleEffectRuntime(independentSourceStore, {
  readModifierSources: (target, modifier) => modifierSources.get(`${target}:${modifier}`) || [],
  dispatchTriggers: async () => {},
  handleLustOverflow: async () => {},
});
await independentSourceRuntime.execute(
  { type: 'damage', target: 'opponent', amount: 10, damageKind: 'attack' },
  {
    source: 'player',
    damageKind: 'attack',
    sourceModifierSources: {
      damage_modifier: [{ operation: { operator: '+', value: 3 }, name: 'Independent summon' }],
    },
  },
);
assert.equal(
  independentSourceStore.getEnemy().currentHp,
  14,
  'an independent summon uses its own +3 outgoing modifier, then the target x2 modifier, without inheriting owner modifiers',
);

const interceptStore = fixture();
interceptStore.updatePlayer({ currentHp: 40, block: 3 });
interceptStore.spawnSummons('player', {
  id: 'interceptor', name: 'Interceptor', emoji: 'I', maxHp: 5, block: 1,
  intercept: { mode: 'unblocked_attack' },
}, 1);
const interceptEvents = [];
const interceptRuntime = new BattleEffectRuntime(interceptStore, {
  readModifierSources: () => [],
  dispatchTriggers: async () => {},
  handleLustOverflow: async () => {},
  interceptDamage: async request => interceptStore.interceptDamageWithSummons(request.target, request.amount),
  present: event => interceptEvents.push(event),
});
const interceptedAttack = await interceptRuntime.execute(
  { type: 'damage', target: 'opponent', amount: 11, damageKind: 'attack' },
  { source: 'enemy', damageKind: 'attack' },
);
assert.equal(interceptedAttack.blocked, 3, 'protected combatant block resolves before summon interception');
assert.equal(interceptedAttack.hpLost, 2, 'summon overkill returns to the protected combatant');
assert.equal(interceptStore.getPlayer().currentHp, 38);
assert.equal(interceptStore.getSummons('player').length, 0);
assert.equal(interceptEvents.find(event => event.type === 'summon_intercepted').intercepted, 6);

interceptStore.spawnSummons('player', {
  id: 'interceptor', name: 'Interceptor', emoji: 'I', maxHp: 5,
  intercept: { mode: 'unblocked_attack' },
}, 1);
await interceptRuntime.execute(
  { type: 'damage', target: 'opponent', amount: 2, damageKind: 'hp_loss' },
  { source: 'enemy', damageKind: 'hp_loss' },
);
assert.equal(interceptStore.getPlayer().currentHp, 36, 'direct HP loss bypasses summon interception');
assert.equal(interceptStore.getSummons('player').length, 1);

const typedStore = fixture();
typedStore.updateEnemy({ currentHp: 20, block: 9 });
typedStore.updatePlayer({ currentHp: 30, maxHp: 80 });
const typedEvents = [];
const typedRuntime = new BattleEffectRuntime(typedStore, {
  readModifierSources: (target, modifier) => modifierSources.get(`${target}:${modifier}`) || [],
  dispatchTriggers: async () => {},
  handleLustOverflow: async () => {},
  present: event => typedEvents.push(event),
});
const hpLoss = await typedRuntime.execute(
  { type: 'damage', target: 'opponent', amount: 8, damageKind: 'hp_loss', lifesteal: 0.5 },
  { source: 'player', damageKind: 'attack' },
);
assert.equal(hpLoss.blocked, 0, 'direct HP loss bypasses block');
assert.equal(hpLoss.hpLost, 8);
assert.equal(typedStore.getEnemy().block, 9, 'direct HP loss leaves block untouched');
assert.equal(typedStore.getEnemy().currentHp, 12, 'direct HP loss skips outgoing and incoming damage modifiers');
assert.equal(typedStore.getPlayer().currentHp, 39, 'lifesteal heals from actual HP loss and then uses heal modifiers');
assert.equal(
  typedEvents.find(event => event.type === 'damage_resolved').damageKind,
  'hp_loss',
  'an explicit damage kind must not be overwritten by the card context',
);

const executeStore = fixture();
executeStore.updateEnemy({ currentHp: 18, maxHp: 40, block: 12, tags: ['elite'] });
const executeEvents = [];
const executeDispatches = [];
const executeRuntime = new BattleEffectRuntime(executeStore, {
  readModifierSources: () => [],
  dispatchTriggers: async entries => executeDispatches.push(...entries),
  handleLustOverflow: async () => {},
  present: event => executeEvents.push(event),
});
const excludedExecute = await executeRuntime.execute(
  { type: 'execute', target: 'opponent', threshold: 50, thresholdMode: 'hp_percent', excludeTags: ['elite'], triggerFatal: true },
  { source: 'player' },
);
assert.equal(excludedExecute.defeated, false);
assert.equal(excludedExecute.excludedBy, 'elite');
assert.equal(executeStore.getEnemy().currentHp, 18);
const executed = await executeRuntime.execute(
  { type: 'execute', target: 'opponent', threshold: 50, thresholdMode: 'hp_percent', triggerFatal: true },
  { source: 'player' },
);
assert.equal(executed.defeated, true);
assert.equal(executed.pendingDeath, true);
assert.equal(executed.fatal, true);
assert.equal(executeStore.getEnemy().currentHp, 0);
assert.equal(executeStore.getEnemy().block, 12, 'execute never consumes block');
assert.deepEqual(executeDispatches, [], 'execute does not emit take-damage or deal-damage triggers');
assert.equal(executeEvents.at(-1).type, 'defeat_resolved');

const integerStore = fixture();
integerStore.updateEnemy({ maxHp: 55, currentHp: 55, block: 0 });
const integerEvents = [];
const integerRuntime = new BattleEffectRuntime(integerStore, {
  readModifierSources: (_target, modifier) =>
    modifier === 'damage_modifier' ? [{ operation: { operator: '*', value: 1.1 }, name: 'Relic' }] : [],
  dispatchTriggers: async () => {},
  handleLustOverflow: async () => {},
  present: event => integerEvents.push(event),
});
await integerRuntime.execute({ type: 'damage', target: 'opponent', amount: 8 }, { source: 'player' });
assert.equal(integerStore.getEnemy().currentHp, 46.2, '8 × 1.1 keeps two-decimal runtime precision before HP mutation');
assert.ok(
  integerEvents
    .filter(event => event.type === 'attribute_changed')
    .every(event => Number.isInteger(event.previousValue * 100) && Number.isInteger(event.nextValue * 100)),
  'runtime combat attributes must never expose floating-point residue beyond two decimals',
);

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

const targetedState = createEmptyBattleState();
const targetedStore = new BattleStateStore(targetedState);
const targetedEvents = [];
const charge = current => ({
  charge: { id: 'charge', name: 'Charge', emoji: 'C', current, max: 9, refresh: 'reset' },
});
targetedStore.setEnemies([
  enemy({ id: 'front', currentHp: 20, resources: charge(1) }),
  enemy({ id: 'back', currentHp: 20, resources: charge(4) }),
], 'front');
const targetedRuntime = new BattleEffectRuntime(targetedStore, {
  readModifierSources: () => [],
  dispatchTriggers: async () => {},
  handleLustOverflow: async () => {},
  present: event => targetedEvents.push(event),
});
await targetedRuntime.execute(
  { type: 'gain_resource', target: 'opponent', resource: 'charge', amount: 2 },
  { source: 'player', targetEnemyId: 'back' },
);
assert.equal(targetedStore.getEnemyById('front').resources.charge.current, 1);
assert.equal(targetedStore.getEnemyById('back').resources.charge.current, 6);
assert.equal(targetedEvents.at(-1).change, 'gain');
assert.equal(targetedStore.getEnemy().id, 'front', 'an explicit resource target does not mutate the active enemy alias');
await targetedRuntime.execute(
  { type: 'set_resource', target: 'self', resource: 'charge', value: 3 },
  { source: 'enemy', sourceEnemyId: 'back', targetEnemyId: 'back' },
);
assert.equal(targetedStore.getEnemyById('back').resources.charge.current, 3);
assert.equal(targetedStore.getEnemyById('front').resources.charge.current, 1);
assert.equal(targetedEvents.at(-1).change, 'set');

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
