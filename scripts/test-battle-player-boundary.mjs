import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createBattleRequestFromMvu, battleRequestToRuntimeData } = require('../src/fish/core/battleContractAdapter.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const { CardSystem } = require('../src/fish/combat/cardSystem.ts');
const { BattleManager } = require('../src/fish/combat/battleManager.ts');
const { normalizeCombatResourceStates, runBattleStartFlow, runBattleTurnFlow, compileCompactEffectList } = require('../src/game-core/index.ts');
const { settleTavernBattleVariables } = require('../src/runtime/battleSettlementAdapter.ts');
const { prepareTowerBattleForActivation } = require('../src/runtime/towerContentActivation.ts');

const battle = {
  core: {
    emoji: '🪞', hp: 70, max_hp: 70, lust: 5, max_lust: 30,
    resources: [{ id: 'prism', name: '折光', emoji: '🔷', max: 20, start: 0, refresh: 'retain' }],
    stance: { id: 'guard_mode', name: '守势', enter: { block: 2 }, passive: { modify: 'block', add: 1 } },
    orb_slots: 2,
    orbs: [{ id: 'light', name: '光球', value: 3, passive: { damage: 1 }, evoke: { damage: 3 } }],
  },
  cards: [
    { id: 'prism_shield', name: '棱晶盾', type: 'Skill', cost: { energy: 1, prism: 2 }, innate: true, effects: { block: 12 } },
    { id: 'strike', name: '打击', type: 'Attack', cost: 1, quantity: 10, effects: { damage: 6 } },
  ],
  artifacts: [{ id: 'lens', name: '先行镜片', trigger: 'battle_start', effects: { draw: 1 } }],
  player_abilities: [{ id: 'prism_start', name: '先行折光', trigger: 'battle_start', effects: { resource: { id: 'prism', amount: 2 } } }],
  enemy: { id: 'dummy', name: '靶子', hp: 40, max_hp: 40, max_lust: 30, lust: 0, actions: [{ name: '轻击', effects: { damage: 2 } }] },
};
const store = GameStateManager.getInstance();
const executor = UnifiedEffectExecutor.getInstance();
const cards = CardSystem.getInstance();
const manager = BattleManager.getInstance();
const quiet = new Proxy({}, { get: () => async () => undefined });
executor.presentation = quiet;
cards.presentation = quiet;
manager.relicTriggerHost.presentation = quiet;
manager.enemyIntentPresenter = quiet;

function load(source) {
  const before = structuredClone(source);
  const request = createBattleRequestFromMvu({ stat_data: { battle: source } }, source);
  const runtime = battleRequestToRuntimeData(request);
  assert.deepEqual(runtime.core.resources, request.content.playerResources, 'validated resource definitions must cross the runtime boundary');
  assert.deepEqual(runtime.core.stance, request.content.playerStance);
  assert.deepEqual(runtime.core.orbs, request.content.playerOrbs);
  assert.equal(runtime.core.orb_slots, request.content.playerOrbSlots);
  store.convertMVUToGameState(request);
  assert.deepEqual(store.getPlayer().resources, normalizeCombatResourceStates(source.core.resources));
  assert.deepEqual(source, before, 'loading never rewrites authored MVU data');
  return request;
}

load(battle);
assert.equal(store.getPlayer().stance.id, 'guard_mode');
assert.equal(store.getPlayer().orbs.slots, 2);
assert.equal(store.getPlayer().orbs.orbs[0].id, 'light');
await executor.processAbilitiesByTrigger('player', 'battle_start');
assert.equal(store.getPlayer().resources.prism.current, 2);
await manager.relicTriggerHost.triggerRelics('battle_start');
const bonusCard = store.getPlayer().hand[0];
assert.equal(store.getPlayer().hand.length, 1);
await manager.beginInitialPlayerTurn();
assert.equal(store.getPlayer().hand.length, 6, 'one bonus draw must not suppress the five-card starting hand');
assert.ok(store.getPlayer().hand.some(card => card.id === bonusCard.id));
const shield = store.getPlayer().hand.find(card => card.originalId === 'prism_shield');
assert.ok(shield, 'innate cards still join the opening hand');
assert.equal(store.getPlayer().resources.prism.current, 2, 'retain resources survive first-turn refresh');
assert.equal(store.getGameState().eventJournal.events.filter(event => event.kind === 'card_drawn').length, 1, 'only the real bonus draw emits on_draw');
assert.equal(new Set([...store.getPlayer().hand, ...store.getPlayer().drawPile].map(card => card.id)).size, 11);
assert.equal(cards.previewCardPlay(shield.id).ok, true, 'authored composite-cost card is payable');
assert.equal(await cards.playCard(shield.id), true);
assert.equal(store.getPlayer().resources.prism.current, 0, 'real play spends the authored resource');
assert.equal(store.getPlayer().energy, 2);
assert.equal(store.getPlayer().block, 13, 'restored stance modifier also executes');

// Bonus draws respect the hand cap without losing cards or inventing on_draw events.
load(battle);
await cards.drawCards(8);
await manager.beginInitialPlayerTurn();
assert.equal(store.getPlayer().hand.length, 10);
assert.equal(store.getPlayer().drawPile.length, 1);
assert.equal(store.getGameState().eventJournal.events.filter(event => event.kind === 'card_drawn').length, 8);

// A run-long build must use persistent authored carriers, not turn the
// encounter-only ability collection into a permanent collection at cleanup.
const persistentBuild = structuredClone(battle);
persistentBuild.artifacts = [{
  id: 'persistent_prism_lens', name: '常备折光镜', trigger: 'battle_start',
  effects: [{ resource: { id: 'prism', amount: 2 } }, { draw: 1 }],
}];
persistentBuild.player_abilities = [{
  id: 'encounter_shield', name: '本场护盾', trigger: 'battle_start', effects: { block: 4 },
}];
const firstRequest = load(persistentBuild);
await executor.processAbilitiesByTrigger('player', 'battle_start');
await manager.relicTriggerHost.triggerRelics('battle_start');
assert.equal(store.getPlayer().block, 5, 'authored battle-start shield includes the real stance modifier');
await manager.beginInitialPlayerTurn();
assert.equal(store.getPlayer().block, 5, 'first turn must not erase battle-start block');
assert.equal(store.getPlayer().resources.prism.current, 2);
assert.equal(store.getPlayer().hand.length, 6);
const settledVariables = { stat_data: { battle: structuredClone(persistentBuild) } };
settleTavernBattleVariables(settledVariables, {
  result: 'victory', request: firstRequest, turns: 1,
  player: { currentHp: 70, currentLust: 5, resources: store.getPlayer().resources },
});
assert.deepEqual(settledVariables.stat_data.battle.artifacts, persistentBuild.artifacts, 'real settlement retains the exact authored relic');
assert.deepEqual(settledVariables.stat_data.battle.player_abilities, [], 'temporary encounter ability still expires');
const nextBattle = prepareTowerBattleForActivation(settledVariables.stat_data.battle, { enemies: [persistentBuild.enemy] });
load(nextBattle);
await executor.processAbilitiesByTrigger('player', 'battle_start');
await manager.relicTriggerHost.triggerRelics('battle_start');
await manager.beginInitialPlayerTurn();
assert.equal(store.getPlayer().resources.prism.current, 4, 'retained resources plus the persistent relic work again next battle');
assert.equal(store.getPlayer().hand.length, 6, 'persistent bonus draw works after settlement and a fresh encounter');
assert.ok(!store.getPlayer().abilities.some(ability => ability.id === 'encounter_shield'));

// Full start ordering, not only a direct call to the final first-turn method:
// refills occur before authors' gains/spending. The real subsequent-turn
// handlers must also reset BEFORE resolving scheduled turn-start effects.
const openingBaseline = structuredClone(battle);
delete openingBaseline.core.stance;
delete openingBaseline.core.orbs;
delete openingBaseline.core.orb_slots;
openingBaseline.core.resources = [
  { id: 'charge', name: '蓄能', emoji: '⚡', max: 5, start: 1, refresh: 'reset' },
  { id: 'prism', name: '折光', emoji: '🔷', max: 10, start: 2, refresh: 'retain' },
];
openingBaseline.player_abilities = [];
openingBaseline.artifacts = [{ id: 'start_baseline', name: '启程器', trigger: 'battle_start',
  effects: [{ block: 4 }, { energy: 2 }, { resource: { id: 'charge', amount: -2 } }, { resource: { id: 'prism', amount: 2 } }],
}];
load(openingBaseline);
await runBattleStartFlow({ isTerminal: () => store.isGameOver(), execute: async step => {
  if (step === 'initial_player_reset') manager.prepareInitialPlayerTurn();
  if (step === 'player_relics_battle_start') await manager.relicTriggerHost.triggerRelics('battle_start');
  if (step === 'initial_player_turn') await manager.beginInitialPlayerTurn();
} });
assert.equal(store.getPlayer().block, 4, 'opening block survives the first player window');
assert.equal(store.getPlayer().energy, 5, 'opening bonus energy survives the first player window');
assert.equal(store.getPlayer().resources.charge.current, 3, 'reset resource refills before the authored opening spend');
assert.equal(store.getPlayer().resources.prism.current, 4, 'retain initial value and authored gain both survive');
const scheduled = compileCompactEffectList([{ schedule: 1, phase: 'turn_start', effects: [
  { block: 7 }, { energy: 2 }, { resource: { id: 'charge', amount: -2 } }, { resource: { id: 'prism', amount: 1 } },
] }]);
assert.equal(scheduled.ok, true);
await executor.executeEffectProgram(scheduled.value, true, { spentEnergy: 0 });
await runBattleTurnFlow({ isTerminal: () => store.isGameOver(), execute: step => manager.executeTurnFlowStep(step) });
assert.equal(store.getPlayer().block, 7, 'old block decays but the due scheduled shield remains');
assert.equal(store.getPlayer().energy, 5, 'refill does not erase scheduled bonus energy');
assert.equal(store.getPlayer().resources.charge.current, 3, 'refill does not undo scheduled resource payment');
assert.equal(store.getPlayer().resources.prism.current, 5, 'retained resources are not reset');
assert.equal(store.readEffectScheduler().queue.length, 0, 'the due effect is consumed once');
await runBattleTurnFlow({ isTerminal: () => store.isGameOver(), execute: step => manager.executeTurnFlowStep(step) });
assert.equal(store.getPlayer().block, 0, 'ordinary later-turn decay is retained');
assert.equal(store.getPlayer().energy, 3, 'bonus energy is not replayed on the next turn');
assert.equal(store.getPlayer().resources.charge.current, 5);
assert.equal(store.getPlayer().resources.prism.current, 5);
const entrySource = await readFile(new URL('../src/fish/index.ts', import.meta.url), 'utf8');
assert.match(entrySource, /case 'initial_player_reset':\s*this\.battleManager\.prepareInitialPlayerTurn\(\);/,
  'production battle-start adapter must execute the baseline step');

const fixturePath = process.argv[2];
if (fixturePath) {
  const { records } = JSON.parse(await readFile(fixturePath, 'utf8'));
  const message = records[1];
  const root = message.variables[message.swipe_id ?? 0];
  load(root.stat_data.battle);
  assert.ok(Object.keys(store.getPlayer().resources).length, 'recorded failing resource save loads its real definitions');
}
console.log('Player content survives MVU → battle request → runtime; bonus opening draws, resource payment, stance/orbs and hand cap pass.');
