import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const { convertMvuCards, convertMvuEnemies } = require(resolve('src/fish/core/mvuBattleAdapter.ts'));
const { GameStateManager } = require(resolve('src/fish/core/gameStateManager.ts'));
const { CardSystem } = require(resolve('src/fish/combat/cardSystem.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

const [power] = convertMvuCards([{
  id: 'guard_engine', name: '守护引擎', emoji: '⚙️', type: 'Power', rarity: 'Rare', cost: 1, quantity: 1,
  description: '启动时获得格挡，之后每回合继续提供格挡。',
  effects: { block: 5 },
  trigger: { on: 'turn_start', effects: { block: 2 } },
}]);
assert.ok(power, 'Power with immediate and triggered effects must compile');
assert.deepEqual(power.effectProgram.steps.map(step => step.op), ['gain_block', 'register_trigger']);

const [enemy] = convertMvuEnemies([{
  id: 'target_dummy', name: '目标假人', emoji: '🎯', hp: 30, max_hp: 30, lust: 0, max_lust: 100,
  actions: [{ name: '等待', weight: 1, effects: { block: 1 } }],
  abilities: [], status_effects: [], lust_effect: { name: '失衡', effects: { damage: 1 } },
  action_mode: 'random', action_config: {},
}]);

const manager = GameStateManager.getInstance();
const state = core.createEmptyBattleState();
state.player.energy = 3;
state.player.maxEnergy = 3;
state.player.hand = [power];
state.player.deck = [power];
state.phase = 'player_turn';
manager.replaceState(state);
manager.setEnemies([enemy], enemy.id);

const executor = UnifiedEffectExecutor.getInstance();
executor.presentation = new Proxy({}, { get: () => () => undefined });
const cards = CardSystem.getInstance();
cards.presentation = new Proxy({}, { get: () => async () => undefined });

assert.equal(await cards.playCard(power.id), true);
assert.equal(manager.getPlayer().block, 5, 'the immediate Power effect resolves exactly once');
assert.equal(manager.getPlayer().energy, 2, 'Power cost is paid once');
assert.equal(manager.getPlayer().abilities?.length, 1, 'the structured trigger becomes one runtime ability');
assert.equal(manager.getPlayer().abilities?.[0].trigger, 'turn_start');
assert.deepEqual(manager.getPlayer().hand, []);
assert.deepEqual(manager.getPlayer().exhaustPile.map(card => card.id), [power.id], 'Power enters the exhaust pile');

manager.createSnapshot('power_persisted');
await executor.processAbilitiesByTrigger('player', 'turn_start');
assert.equal(manager.getPlayer().block, 7, 'the registered trigger executes after the Power was played');
manager.updatePlayer({ block: 0, abilities: [] });
assert.equal(manager.restoreSnapshot('power_persisted'), true);
assert.equal(manager.getPlayer().abilities?.length, 1, 'runtime Power abilities survive battle save restoration');
await executor.processAbilitiesByTrigger('player', 'turn_start');
assert.equal(manager.getPlayer().block, 7, 'the restored trigger retains its effect and does not duplicate');

console.log('Power cards preserve immediate effects, one-time registration, payment, destination, triggers, and save restoration.');

// Real save 6: normal played-card movement used to consume the first-discard
// ordinal even though it never dispatched on_discard. Exercise the actual card
// host, not synthetic trigger calls, with the AI-authored Power contract.
const [discardPower, normal, scrap, bladeA, bladeB, bladeC] = convertMvuCards([
  {
    id: 'discard_page_echo', name: '弃页回锋', emoji: '♻️', type: 'Power', rarity: 'Uncommon', cost: 1,
    description: '每回合第一次弃牌时，获得 1 点能量。', quantity: 1,
    trigger: { on: 'on_discard', scope: 'turn', ordinal: 'first', effects: { energy: 1 } },
  },
  { id: 'normal', name: '普通出牌', type: 'Skill', rarity: 'Common', cost: 0, effects: { block: 1 } },
  { id: 'scrap', name: '主动连弃', type: 'Skill', rarity: 'Common', cost: 1, effects: { discard: 'all', from: 'hand', pick: 'all' } },
  ...['blade_a', 'blade_b', 'blade_c'].map(id => ({
    id, name: id, type: 'Attack', rarity: 'Common', cost: 0,
    effects: { damage: 2 }, discard_effects: { damage: 4 },
  })),
]);
assert.ok(discardPower && normal && scrap && bladeA && bladeB && bladeC);
const discardState = core.createEmptyBattleState();
discardState.phase = 'player_turn';
discardState.currentTurn = 1;
discardState.player.energy = 3;
discardState.player.maxEnergy = 3;
discardState.player.hand = [discardPower, normal, scrap, bladeA, bladeB];
manager.replaceState(discardState);
manager.setEnemies([enemy], enemy.id);
assert.equal(await cards.playCard(discardPower.id), true);
assert.equal(await cards.playCard(normal.id), true);
assert.equal(manager.getPlayer().energy, 2, 'ordinary play must not dispatch a discard refund');
assert.equal(await cards.playCard(scrap.id), true);
assert.equal(manager.getPlayer().energy, 2, 'two true discards refund exactly one energy after prior ordinary play');
assert.equal(manager.getEnemy().currentHp, 22, 'both card-local discard programs still execute');
const playedMove = manager.getGameState().eventJournal.events.find(event => event.kind === 'card_moved' && event.cardInstanceId === normal.id);
assert.equal(playedMove.moveReason, 'played', 'played-card disposal is not a player-choice discard');
assert.equal(playedMove.cause.reason, 'played');

// Persisted ordinal history must prevent another refund in the same turn.
manager.replaceState(JSON.parse(JSON.stringify(manager.getGameState())));
manager.updatePlayer({ hand: [bladeC] });
await cards.discardCard(bladeC.id, 'player_choice');
assert.equal(manager.getPlayer().energy, 2);
manager.setCurrentTurn(2);
manager.updatePlayer({ energy: 3, hand: [normal, scrap, bladeA, bladeB], discardPile: [], exhaustPile: [] });
assert.equal(await cards.playCard(normal.id), true);
assert.equal(await cards.playCard(scrap.id), true);
assert.equal(manager.getPlayer().energy, 3, 'a new turn receives exactly one fresh refund');
manager.updatePlayer({ hand: [bladeC] });
await cards.discardCard(bladeC.id, 'turn_cleanup');
assert.equal(manager.getPlayer().energy, 3, 'normal turn cleanup cannot trigger another refund');
console.log('Real first-discard Power regression: play vs discard, multi-discard, restore, next turn and cleanup passed.');
