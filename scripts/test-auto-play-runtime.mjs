import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { CardSystem } = require(resolve('src/fish/combat/cardSystem.ts'));

const compiled = core.compileCompactEffectList([
  { auto_play: 2, from: 'draw', pick: 'top', free: true, card_type: 'Attack' },
]);
assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.issues));
assert.deepEqual(compiled.value.steps[0], {
  op: 'auto_play_cards',
  selector: { zone: 'draw', pick: 'top', count: 2, filter: { types: ['Attack'] } },
  free: true,
});
assert.match(core.effectProgramToDisplayTags(compiled.value)[0].text, /自动免费打出/);
assert.equal(core.compileCompactEffectList([{ auto_play: 1, from: 'hand', pick: 'top' }]).ok, false);
assert.equal(core.compileCompactEffectList([{ auto_play: 1, free: 'yes' }]).ok, false);

const program = { spec: core.EFFECT_PROGRAM_SPEC, steps: [{ op: 'damage', target: 'opponent', amount: 5 }] };
const card = (id, overrides = {}) => ({
  id,
  originalId: id,
  templateId: id,
  runInstanceId: `${id}:run`,
  combatInstanceId: id,
  origin: 'deck',
  name: id,
  emoji: '🃏',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  effectProgram: program,
  description: '',
  ...overrides,
});

const state = core.createEmptyBattleState();
state.currentTurn = 1;
state.phase = 'player_turn';
state.player.energy = 3;
state.player.drawPile = [card('bottom'), card('top')];
state.player.discardPile = [card('paid', { cost: 4 })];
const store = new core.BattleStateStore(state);
const runtimePlayed = [];
const runtime = new core.CardEffectRuntime(store, {
  drawCards: async () => {},
  chooseCards: async () => null,
  onCardDiscarded: async () => {},
  onCardExhausted: async () => {},
  autoPlayCard: async (entry, source, free) => {
    runtimePlayed.push({ id: entry.id, source, free });
    return true;
  },
});
await runtime.execute({ type: 'auto_play_cards', selector: { zone: 'draw', pick: 'top', count: 2 }, free: true });
assert.deepEqual(runtimePlayed, [
  { id: 'top', source: 'drawPile', free: true },
  { id: 'bottom', source: 'drawPile', free: true },
]);

const system = Object.create(CardSystem.prototype);
system.gameStateManager = store;
system.activeAutoPlayIds = new Set();
let transactionId = 0;
system.sessionHost = {
  beginTransaction: () => {
    const token = `auto_play_${++transactionId}`;
    store.createSnapshot(token);
    return token;
  },
  commitTransaction: token => store.deleteSnapshot(token),
  rollbackTransaction: token => {
    store.restoreSnapshot(token);
    store.deleteSnapshot(token);
  },
};
system.presentation = { animateTriggeredCard: async () => {} };
const resolved = [];
system.executeCardEffect = async (entry, _target, payment) => {
  resolved.push({ id: entry.id, spent: payment.spentEnergy });
  return 0;
};
system.triggerPostCardPlayEffects = async entry => resolved.push({ post: entry.id });

const top = store.readCardZoneState().drawPile.at(-1);
top.replayCount = 1;
assert.equal(await system.autoPlayCard(top, 'drawPile', true), true);
assert.deepEqual(resolved, [
  { id: 'top', spent: 0 },
  { post: 'top' },
  { id: 'top', spent: 0 },
  { post: 'top' },
]);
const after = store.getGameState();
assert.deepEqual(after.player.drawPile.map(entry => entry.id), ['bottom']);
assert.deepEqual(after.player.discardPile.map(entry => entry.id), ['paid', 'top']);
assert.equal(after.player.energy, 3);
assert.equal(after.cardsPlayedThisTurn, 1, 'automatic plays count for history and formulas');
assert.equal(after.cardRuleUsesThisTurn, 1, 'automatic plays count once toward play rules, not again for Replay');
const playedEvents = after.eventJournal.events.filter(event => event.kind === 'card_played');
assert.equal(playedEvents.length, 4, 'each Replay emits before and after causal events');
assert.equal(playedEvents.every(event => event.automatic && event.cause.reason === 'auto_play'), true);
assert.equal(after.eventJournal.events.some(event => event.kind === 'card_moved' && event.from === 'drawPile' && event.moveReason === 'auto_play'), true);

const expensive = store.readCardZoneState().discardPile.find(entry => entry.id === 'paid');
assert.equal(await system.autoPlayCard(expensive, 'discardPile', false), false);
assert.equal(store.readCardZoneState().discardPile.some(entry => entry.id === 'paid'), true, 'failed payment leaves the source zone unchanged');

// A discard-triggered auto-play failure must use its declared destination
// instead of hiding, duplicating, or stranding the card in two zones.
const discardState = core.createEmptyBattleState();
discardState.currentTurn = 1;
discardState.phase = 'player_turn';
const discardBound = core.applyCardAttachment(card('discard_bound'), {
  id: 'discard_echo',
  kind: 'enchantment',
  name: '弃置回响',
  source: { kind: 'enchantment', id: 'discard_echo' },
  scope: 'combat',
  appliedTurn: 1,
  removeOn: 'discarded',
  remaining: 1,
  changes: [{
    kind: 'discard_auto_play',
    reasons: ['effect'],
    failureDestination: 'draw_top',
    onlyPlayerTurn: true,
  }],
});
discardState.player.hand = [discardBound];
const discardStore = new core.BattleStateStore(discardState);
const discardSystem = Object.create(CardSystem.prototype);
discardSystem.gameStateManager = discardStore;
discardSystem.relicTriggerHost = { triggerRelics: async () => {} };
discardSystem.triggerDiscardEffect = async () => {};
discardSystem.autoPlayCard = async () => false;
discardSystem.presentation = { logDiscardCardDetail: () => {} };
assert.equal(await discardSystem.discardCard(discardBound.id, 'effect'), true);
const discardZones = discardStore.readCardZoneState();
assert.deepEqual(discardZones.hand, []);
assert.deepEqual(discardZones.discardPile, []);
assert.deepEqual(discardZones.drawPile.map(entry => entry.id), [discardBound.id]);
assert.equal(
  [discardZones.hand, discardZones.drawPile, discardZones.discardPile, discardZones.exhaustPile]
    .flat().filter(entry => entry.id === discardBound.id).length,
  1,
  'failed discard auto-play retains exactly one card instance',
);

console.log('Cards auto-play from non-hand zones through Replay, events, destination, payment checks, and independent rule-window counters.');
