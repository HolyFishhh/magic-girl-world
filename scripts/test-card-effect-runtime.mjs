import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { ReferenceBattleRuntimeHost } = require(resolve('src/adapters/referenceBattleRuntimeHost.ts'));
const { normalizeEnemyAction } = require(resolve('src/fish/core/battleContentAdapter.ts'));
const { TavernEffectCommandHost } = require(resolve('src/fish/core/effectCommandHost.ts'));
const { CardSystem } = require(resolve('src/fish/combat/cardSystem.ts'));

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
  onCardDiscarded: async (entry, reason, source) => discarded.push({ id: entry.id, reason, source }),
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
assert.deepEqual(discarded, [{ id: 'hand_a__1', reason: 'player_choice', source: 'hand' }]);
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

choose = request => [request.candidates[0].id];
await runtime.execute(
  {
    type: 'apply_card_patch',
    selector: { zone: 'discard', pick: 'choose', count: 1, filter: { templateId: 'discard_a' } },
    patch: { kind: 'keyword', keyword: 'retain', enabled: true, scope: 'run', match: 'template', includeFutureCopies: true },
  },
  { currentTurn: 1, source: { kind: 'card', id: 'lesson' } },
);
assert.equal(host.getPlayer().discardPile.find(entry => entry.id === 'discard_a__1').retain, true);
choose = request => [request.candidates.find(entry => entry.id === 'discard_a__1').id];
await runtime.execute({
  type: 'apply_card_attachment',
  selector: { zone: 'discard', pick: 'choose', count: 1, filter: { templateId: 'discard_a' } },
  attachment: {
    id: 'runtime_affliction', kind: 'affliction', name: '运行时负面附着', scope: 'combat',
    removeOn: 'played', remaining: 1,
    changes: [
      { kind: 'cost', operator: 'add', value: 1 },
      { kind: 'play_access', mode: 'deny' },
    ],
  },
}, { currentTurn: 2, source: { kind: 'enemy_action', id: 'bind_action', name: '束缚行动' } });
const attachedRuntimeCard = host.getPlayer().discardPile.find(entry => entry.id === 'discard_a__1');
assert.equal(attachedRuntimeCard.cost, 2);
assert.equal(attachedRuntimeCard.attachments[0].source.kind, 'enemy_action');
assert.equal(events.at(-1).type, 'card_attachment_applied');
await runtime.execute({
  type: 'add_card',
  zone: 'hand',
  count: 1,
  card: {
    id: 'discard_a',
    name: '未来同模板牌',
    emoji: '🃏',
    type: 'Skill',
    rarity: 'Common',
    cost: 1,
    description: '用于验证未来副本继承。',
    program: emptyProgram,
  },
});
assert.equal(host.getPlayer().hand.find(entry => entry.originalId === 'discard_a').retain, true);

const discardedCallbackCount = discarded.length;
await runtime.execute({
  type: 'add_card',
  zone: 'discard',
  count: 2,
  card: {
    id: 'direct_burden',
    name: '直接负担',
    emoji: '🕸️',
    type: 'Curse',
    rarity: 'Corrupt',
    description: '直接生成至弃牌堆。',
    program: { spec: 'mwg.effect/v1', steps: [] },
  },
});
assert.equal(host.getPlayer().discardPile.filter(entry => entry.originalId === 'direct_burden').length, 2);
assert.equal(discarded.length, discardedCallbackCount, 'generating into discard is not a hand-discard event');
assert.equal(events.at(-1).type, 'card_added');
assert.equal(events.at(-1).zone, 'discard');

// Value transforms use the same zone selectors as other card operations. They
// rewrite executable card programs while preserving hit count, targets, and
// control-flow structure.
const valueState = core.createEmptyBattleState();
valueState.random = core.createBattleRandomState(917);
const valueCard = (id, damage) => ({
  ...card(id),
  effectProgram: {
    spec: 'mwg.effect/v1',
    steps: [
      { op: 'damage', target: 'opponent', amount: damage, hits: 2 },
      { op: 'gain_block', target: 'self', amount: 4 },
      { op: 'gain_lust', target: 'opponent', amount: 3 },
      { op: 'apply_status', target: 'opponent', status: 'runtime_mark', stacks: 2 },
      {
        op: 'if',
        condition: { op: 'compare', comparator: '>=', left: 1, right: 1 },
        then: [{ op: 'damage', target: 'opponent', amount: 5 }],
      },
      {
        op: 'register_trigger',
        target: 'self',
        trigger: 'turn_start',
        effects: [{ op: 'damage', target: 'opponent', amount: 2 }],
      },
    ],
  },
});
valueState.player.hand = [valueCard('value_left__1', 6), valueCard('value_middle__1', 10), valueCard('value_right__1', 20)];
valueState.player.drawPile = [valueCard('value_draw__1', 30)];
valueState.player.discardPile = [valueCard('value_discard__1', 40)];
const valueHost = new ReferenceBattleRuntimeHost(valueState);
const valueEvents = [];
let valueChoose = candidates => [candidates[0].id];
const valueRuntime = valueHost.createCardEffectRuntime({
  drawCards: async () => undefined,
  chooseCards: async candidates => valueChoose(candidates),
  onCardDiscarded: async () => undefined,
  onCardExhausted: async () => undefined,
  present: event => valueEvents.push(event),
});

valueChoose = candidates => [candidates.find(entry => entry.id === 'value_left__1').id];
await valueRuntime.execute({
  type: 'modify_card_value',
  selector: { zone: 'hand', pick: 'choose', count: 1 },
  stat: 'damage',
  operator: 'add',
  value: 2,
});
let transformed = valueHost.getPlayer().hand[0].effectProgram;
assert.equal(transformed.steps[0].amount, 8);
assert.equal(transformed.steps[0].hits, 2, 'modifying damage must not modify hits');
assert.equal(transformed.steps[1].amount, 4);
assert.equal(transformed.steps[4].then[0].amount, 7);
assert.equal(transformed.steps[5].effects[0].amount, 4);

await valueRuntime.execute({
  type: 'modify_card_value',
  selector: { zone: 'hand', pick: 'left', count: 1 },
  stat: 'block',
  operator: 'multiply',
  value: 1.5,
});
transformed = valueHost.getPlayer().hand[0].effectProgram;
assert.equal(transformed.steps[1].amount, 6);

await valueRuntime.execute({
  type: 'modify_card_value',
  selector: { zone: 'hand', pick: 'right', count: 1 },
  stat: 'damage',
  operator: 'subtract',
  value: 5,
});
assert.equal(valueHost.getPlayer().hand[2].effectProgram.steps[0].amount, 15);

const beforeRandom = valueHost.getPlayer().hand.map(entry => entry.effectProgram.steps[0].amount);
await valueRuntime.execute({
  type: 'modify_card_value',
  selector: { zone: 'hand', pick: 'random', count: 1 },
  stat: 'damage',
  operator: 'add',
  value: 1,
});
const afterRandom = valueHost.getPlayer().hand.map(entry => entry.effectProgram.steps[0].amount);
assert.equal(afterRandom.filter((amount, index) => amount !== beforeRandom[index]).length, 1);

await valueRuntime.execute({
  type: 'modify_card_value',
  selector: { zone: 'all', pick: 'all' },
  stat: 'damage',
  operator: 'multiply',
  value: 2,
});
assert.deepEqual(
  [
    ...valueHost.getPlayer().hand,
    ...valueHost.getPlayer().drawPile,
    ...valueHost.getPlayer().discardPile,
  ].map(entry => entry.effectProgram.steps[0].amount),
  afterRandom.map(amount => amount * 2).concat([60, 80]),
);

valueChoose = candidates => [candidates.find(entry => entry.id === 'value_left__1').id];
await valueRuntime.execute({
  type: 'modify_card_value',
  selector: { zone: 'hand', pick: 'choose', count: 1 },
  stat: 'stacks',
  operator: 'divide',
  value: 2,
});
assert.equal(valueHost.getPlayer().hand[0].effectProgram.steps[3].stacks, 1);
assert.equal(valueEvents.filter(event => event.type === 'card_value_modified').length, 10);

valueChoose = candidates => [candidates.find(entry => entry.id === 'value_left__1').id];
await valueRuntime.execute({
  type: 'upgrade_cards',
  selector: { zone: 'hand', pick: 'choose', count: 1 },
  scope: 'permanent',
  levels: 1,
  maxLevel: 3,
  changes: [
    { kind: 'numeric', stat: 'damage', operator: 'add', value: 3 },
    { kind: 'keyword', keyword: 'retain', enabled: true },
  ],
}, { currentTurn: 2, source: { kind: 'card', id: 'training' } });
const upgradedRuntimeCard = valueHost.getPlayer().hand.find(entry => entry.id === 'value_left__1');
assert.equal(upgradedRuntimeCard.upgradeLevel, 1);
assert.equal(upgradedRuntimeCard.retain, true);
assert.equal(valueEvents.at(-1).type, 'card_upgraded');

// Multiple choose-based value upgrades in one effect program share one target.
// The offered card must be eligible for every requested stat, and a cancelled
// shared choice must not open a second prompt for the later upgrade.
const sharedState = core.createEmptyBattleState();
sharedState.random = core.createBattleRandomState(126);
const sharedCard = (id, steps) => ({ ...card(id), effectProgram: { spec: 'mwg.effect/v1', steps } });
sharedState.player.hand = [
  sharedCard('damage_only__1', [{ op: 'damage', target: 'opponent', amount: 3 }]),
  sharedCard('block_only__1', [{ op: 'gain_block', target: 'self', amount: 3 }]),
  sharedCard('both_values__1', [
    { op: 'damage', target: 'opponent', amount: 3 },
    { op: 'gain_block', target: 'self', amount: 3 },
  ]),
];
const sharedHost = new ReferenceBattleRuntimeHost(sharedState);
let sharedPromptCount = 0;
const sharedRuntime = sharedHost.createCardEffectRuntime({
  drawCards: async () => undefined,
  chooseCards: async candidates => {
    sharedPromptCount += 1;
    assert.deepEqual(candidates.map(entry => entry.id), ['damage_only__1', 'both_values__1', 'block_only__1']);
    return ['both_values__1'];
  },
  onCardDiscarded: async () => undefined,
  onCardExhausted: async () => undefined,
});
const sharedCardChoice = {
  requirements: [
    { selector: { zone: 'hand', pick: 'choose', count: 1 }, stats: ['damage'] },
    { selector: { zone: 'hand', pick: 'choose', count: 1 }, stats: ['block'] },
  ],
};
await sharedRuntime.execute({
  type: 'modify_card_value', selector: { zone: 'hand', pick: 'choose', count: 1 }, stat: 'damage', operator: 'add', value: 2,
}, { sharedCardChoice });
await sharedRuntime.execute({
  type: 'modify_card_value', selector: { zone: 'hand', pick: 'choose', count: 1 }, stat: 'block', operator: 'add', value: 4,
}, { sharedCardChoice });
assert.equal(sharedPromptCount, 1);
assert.deepEqual(sharedHost.getPlayer().hand[2].effectProgram.steps.map(step => step.amount), [5, 7]);

const cancelledChoice = { requirements: sharedCardChoice.requirements };
sharedRuntime.ports.chooseCards = async () => { sharedPromptCount += 1; return null; };
const promptsBeforeCancellation = sharedPromptCount;
await sharedRuntime.execute({
  type: 'modify_card_value', selector: { zone: 'hand', pick: 'choose', count: 1 }, stat: 'damage', operator: 'add', value: 1,
}, { sharedCardChoice: cancelledChoice });
await sharedRuntime.execute({
  type: 'modify_card_value', selector: { zone: 'hand', pick: 'choose', count: 1 }, stat: 'block', operator: 'add', value: 1,
}, { sharedCardChoice: cancelledChoice });
assert.equal(sharedPromptCount, promptsBeforeCancellation + 1, 'cancelled shared card choice is reused without another prompt');

// Exercise the production command-host route with mixed value/upgrade nodes.
// The host must pass one shared cell through to CardEffectRuntime, even where
// the authored selectors requested different counts.
sharedRuntime.ports.chooseCards = async candidates => {
  sharedPromptCount += 1;
  assert.deepEqual(candidates.map(entry => entry.id), ['damage_only__1', 'both_values__1', 'block_only__1']);
  return ['both_values__1'];
};
const routedSharedHost = new TavernEffectCommandHost({
  readState: () => ({
    self: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
    opponent: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
  }),
  isTerminal: () => false,
  executeCardCommand: (command, context) => sharedRuntime.execute(command, context),
  presentCommand: () => undefined,
  executeBattleCommand: async () => undefined,
  executeSpecialCommand: async () => undefined,
  executeSummonCommand: async () => undefined,
  executeEnemyCommand: async () => undefined,
  executeSummonerProgram: async () => undefined,
  forEachEnemyTarget: async () => undefined,
  applyStatus: async () => undefined,
  removeStatuses: async () => undefined,
  registerAbility: async () => undefined,
  scheduleEffect: async () => undefined,
  setCardDestination: async () => undefined,
  narrate: async () => undefined,
  chooseEffectOption: async () => null,
});
const promptsBeforeRoutedUpgrade = sharedPromptCount;
await routedSharedHost.executeProgram({
  spec: 'mwg.effect/v1',
  steps: [
    { op: 'modify_card_value', selector: { zone: 'hand', pick: 'choose', count: 3 }, stat: 'damage', operator: 'add', value: 1 },
    {
      op: 'upgrade_cards', selector: { zone: 'hand', pick: 'choose', count: 2 }, scope: 'combat', levels: 1,
      changes: [{ kind: 'numeric', stat: 'block', operator: 'add', value: 2 }],
    },
  ],
}, true);
assert.equal(sharedPromptCount, promptsBeforeRoutedUpgrade + 1);
assert.deepEqual(sharedHost.getPlayer().hand[2].effectProgram.steps.map(step => step.amount), [6, 9]);

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

await runtime.execute(
  { type: 'discard_cards', selector: { zone: 'draw', pick: 'right' }, amount: 1 },
  { currentCardId: 'current__1' },
);
assert.deepEqual(discarded.at(-1), {
  id: generated.at(-1).id,
  reason: 'effect',
  source: 'drawPile',
});

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

// Repeat the same action through the production Tavern command router and the
// CardSystem delegation boundary. Enemy-owned add_card still always mutates the
// player's combat zones; source perspective must not redirect it to an enemy.
const tavernState = core.createEmptyBattleState();
tavernState.phase = 'enemy_turn';
const tavernStore = new core.BattleStateStore(tavernState);
const tavernCardSystem = Object.create(CardSystem.prototype);
tavernCardSystem.cardEffectRuntime = new core.CardEffectRuntime(tavernStore, {
  drawCards: async () => {},
  chooseCards: async () => null,
  onCardDiscarded: async () => {},
  onCardExhausted: async () => {},
});
const tavernCommandHost = new TavernEffectCommandHost({
  readState: sourceIsPlayer => ({
    self: sourceIsPlayer
      ? { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 }
      : { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
    opponent: sourceIsPlayer
      ? { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 }
      : { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  }),
  isTerminal: () => false,
  executeCardCommand: command => tavernCardSystem.executeCardEffectCommand(command),
  presentCommand: () => {},
});
await tavernCommandHost.executeProgram(enemyInsertion.effectProgram, false);
const tavernInserted = tavernStore.getPlayer().drawPile.filter(entry => entry.originalId === 'enemy_curse');
assert.equal(tavernInserted.length, 2);
assert.ok(tavernInserted.every(entry => entry.type === 'Curse' && entry.origin === 'generated'));

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

// Result snapshots are captured before reentrant lifecycle callbacks, not from
// potentially mutated card references after callbacks finish.
const resultState = core.createEmptyBattleState();
resultState.player.hand = [card('outer',1,'Attack'),card('inner',1,'Skill')];
const resultHost = new ReferenceBattleRuntimeHost(resultState);
const outerCell = {value:null}, innerCell = {value:null};
let cancelResultChoice = false;
const resultRuntime = resultHost.createCardEffectRuntime({
  drawCards: async () => {},
  chooseCards: async candidates => cancelResultChoice ? null : [candidates[0].id],
  onCardExhausted: async () => {},
  onCardDiscarded: async entry => {
    if(entry.id !== 'outer') return;
    assert.equal(outerCell.value.cards[0].type,'Attack');
    entry.type = 'Curse';
    await resultRuntime.execute({type:'discard_cards',selector:{zone:'hand',pick:'choose'},amount:1},{discardResult:innerCell});
  },
});
const discardOne = {type:'discard_cards',selector:{zone:'hand',pick:'choose'},amount:1};
await resultRuntime.execute(discardOne,{discardResult:outerCell});
assert.deepEqual(outerCell.value,{status:'committed',cards:[{id:'outer',type:'Attack',source:'hand'}]});
assert.deepEqual(innerCell.value,{status:'committed',cards:[{id:'inner',type:'Skill',source:'hand'}]});
assert.ok(Object.isFrozen(outerCell.value) && Object.isFrozen(outerCell.value.cards) && Object.isFrozen(outerCell.value.cards[0]));
await resultRuntime.execute(discardOne,{discardResult:outerCell});
assert.deepEqual(outerCell.value.cards,[],'empty hand must clear earlier successful result');
await resultRuntime.execute({type:'recover_cards',source:'discard',pick:'top',amount:1});
cancelResultChoice = true;
await resultRuntime.execute(discardOne,{discardResult:innerCell});
assert.deepEqual(innerCell.value,{status:'cancelled',cards:[]});
assert.equal(resultHost.getPlayer().hand.length,1,'cancelled selection does not move a card');

console.log('Portable CardEffectRuntime executes modern commands; immutable command-local discard snapshots survive nested listeners and card mutation, clear on empty/cancel.');
