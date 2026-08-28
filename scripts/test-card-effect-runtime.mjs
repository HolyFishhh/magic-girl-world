import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { ReferenceBattleRuntimeHost } = require(resolve('src/adapters/referenceBattleRuntimeHost.ts'));
const { normalizeEnemyAction } = require(resolve('src/fish/core/battleContentAdapter.ts'));

const emptyProgram = { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] };
const card = (id, cost = 1, type = 'Skill') => ({
  id,
  originalId: id.replace(/__\d+$/, ''),
  name: id,
  cost,
  type,
  rarity: 'Common',
  emoji: '🃏',
  effect: '',
  effectProgram: emptyProgram,
  description: id,
});

const state = core.createEmptyBattleState();
state.random = core.createBattleRandomState(731);
state.player.hand = [card('current__1'), card('hand_a__1', 2), card('curse__1', 1, 'Curse')];
state.player.drawPile = [card('draw_a__1'), card('draw_b__1'), card('draw_c__1')];
state.player.discardPile = [card('discard_a__1', 3)];
state.player.exhaustPile = [card('exhaust_a__1')];
const host = new ReferenceBattleRuntimeHost(state);
const choices = [];
const discarded = [];
const exhausted = [];
const events = [];
const draws = [];
let choose = request => request.candidates.slice(0, request.maximum).map(entry => entry.id);

const runtime = host.createCardEffectRuntime({
  drawCards: async count => draws.push(count),
  chooseCards: async (candidates, request) => {
    choices.push({ candidates: candidates.map(entry => entry.id), ...request });
    return choose({ candidates, ...request });
  },
  onCardDiscarded: async entry => discarded.push(entry.id),
  onCardExhausted: async entry => exhausted.push(entry.id),
  present: event => events.push(event),
});

await runtime.execute({ type: 'draw_cards', amount: 2 });
assert.deepEqual(draws, [2]);

choose = request => [request.candidates.find(entry => entry.id === 'hand_a__1').id];
await runtime.execute(
  { type: 'discard_cards', selector: { zone: 'hand', pick: 'choose' }, amount: 1 },
  { currentCardId: 'current__1' },
);
assert.deepEqual(discarded, ['hand_a__1']);
assert.deepEqual(host.getPlayer().hand.map(entry => entry.id), ['current__1', 'curse__1']);
assert.deepEqual(host.getPlayer().discardPile.map(entry => entry.id), ['discard_a__1', 'hand_a__1']);
assert.ok(!choices.at(-1).candidates.includes('current__1'), 'the resolving card cannot discard itself');

await runtime.execute({
  type: 'exhaust_cards',
  selector: { zone: 'draw', pick: 'right' },
  amount: 1,
});
assert.deepEqual(exhausted, ['draw_c__1']);
assert.deepEqual(host.getPlayer().exhaustPile.map(entry => entry.id), ['exhaust_a__1', 'draw_c__1']);

choose = request => [request.candidates.find(entry => entry.id === 'draw_a__1').id];
await runtime.execute({ type: 'recover_cards', source: 'draw', pick: 'choose', amount: 1 });
assert.ok(host.getPlayer().hand.some(entry => entry.id === 'draw_a__1'));
assert.equal(events.at(-1).type, 'card_recovered');
assert.equal(events.at(-1).source, 'draw');

choose = request => [request.candidates.find(entry => entry.id === 'draw_b__1').id];
await runtime.execute({ type: 'scry_cards', amount: 2 });
assert.ok(host.getPlayer().discardPile.some(entry => entry.id === 'draw_b__1'));
assert.equal(events.at(-1).type, 'card_scry_discarded');

await runtime.execute({
  type: 'reduce_card_cost',
  selector: { zone: 'discard', pick: 'all' },
  amount: 2,
});
assert.equal(host.getPlayer().discardPile.find(entry => entry.id === 'discard_a__1').cost, 1);
assert.equal(events.at(-1).type, 'card_cost_reduced');

const handBeforeCopy = host.getPlayer().hand.length;
await runtime.execute({ type: 'copy_cards', selector: { zone: 'hand', pick: 'left' } });
assert.equal(host.getPlayer().hand.length, handBeforeCopy + 1);
assert.notEqual(host.getPlayer().hand.at(-1).id, host.getPlayer().hand[0].id);

choose = request => [request.candidates.find(entry => entry.id === 'current__1').id];
await runtime.execute({ type: 'double_card_effect', selector: { zone: 'hand', pick: 'choose' } });
assert.equal(host.getPlayer().hand.find(entry => entry.id === 'current__1').doubleEffect, true);

await runtime.execute({
  type: 'add_card',
  zone: 'draw',
  count: 2,
  card: {
    id: 'generated',
    name: '生成牌',
    emoji: '✨',
    type: 'Skill',
    rarity: 'Uncommon',
    cost: 0,
    description: '测试',
    program: emptyProgram,
  },
});
const generated = host.getPlayer().drawPile.filter(entry => entry.originalId === 'generated');
assert.equal(generated.length, 2);
assert.equal(new Set(generated.map(entry => entry.id)).size, 2);
assert.ok(generated.every(entry => entry.effectProgram?.spec === 'mwg.effect/v1'));

// Full enemy-content path: compact MVU JSON -> compiled enemy action -> command
// runtime -> the player's draw pile. This protects the enemy card-insertion
// feature from being documented but disconnected in Tavern combat.
const enemyInsertion = normalizeEnemyAction({
  name: '侵蚀牌库',
  weight: 1,
  effects: { add_card: 'enemy_curse', to: 'deck', count: 2 },
  creates: [{
    id: 'enemy_curse',
    name: '侵蚀残片',
    emoji: '🕸️',
    type: 'Curse',
    rarity: 'Corrupt',
    effects: { damage: 3, to: 'self' },
    ethereal: true,
  }],
});
assert.ok(enemyInsertion?.effectProgram);
const beforeEnemyInsertion = host.getPlayer().drawPile.length;
await core.runEffectCommandProgram(
  enemyInsertion.effectProgram,
  { spentEnergy: 0 },
  {
    readState: () => ({
      self: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
      opponent: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
    }),
    execute: command => runtime.execute(command),
  },
);
const insertedByEnemy = host.getPlayer().drawPile.filter(entry => entry.originalId === 'enemy_curse');
assert.equal(host.getPlayer().drawPile.length, beforeEnemyInsertion + 2);
assert.equal(insertedByEnemy.length, 2);
assert.ok(insertedByEnemy.every(entry => entry.type === 'Curse'));

const rollbackState = host.getGameState();
const rollbackHost = new ReferenceBattleRuntimeHost(rollbackState);
const rollbackRuntime = rollbackHost.createCardEffectRuntime({
  drawCards: async () => undefined,
  chooseCards: async candidates => [candidates[0].id],
  onCardDiscarded: async () => {
    throw new Error('injected discard lifecycle failure');
  },
  onCardExhausted: async () => undefined,
});
const token = rollbackHost.beginScopedTransaction('card_effect');
await assert.rejects(
  rollbackRuntime.execute({ type: 'discard_cards', selector: { zone: 'hand', pick: 'left' }, amount: 1 }),
  /injected discard lifecycle failure/,
);
rollbackHost.rollbackTransaction(token);
assert.deepEqual(rollbackHost.getGameState(), rollbackState, 'the external host can roll back a failed card lifecycle');

const invalidState = host.getGameState();
const invalidHost = new ReferenceBattleRuntimeHost(invalidState);
const invalidRuntime = invalidHost.createCardEffectRuntime({
  drawCards: async () => undefined,
  chooseCards: async () => ['not-a-candidate'],
  onCardDiscarded: async () => undefined,
  onCardExhausted: async () => undefined,
});
await assert.rejects(
  invalidRuntime.execute({ type: 'discard_cards', selector: { zone: 'hand', pick: 'choose' }, amount: 1 }),
  /card zone commit failed: INVALID_SELECTION/,
);
assert.deepEqual(invalidHost.getGameState(), invalidState, 'an invalid host response cannot mutate card zones');

console.log('Portable CardEffectRuntime executes every modern card command with host-owned UI and lifecycle ports.');
