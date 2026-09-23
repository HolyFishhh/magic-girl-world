import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { GameStateManager } = require(resolve('src/fish/core/gameStateManager.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));
const { CardSystem } = require(resolve('src/fish/combat/cardSystem.ts'));
const { BattleManager } = require(resolve('src/fish/combat/battleManager.ts'));
const { DynamicStatusManager } = require(resolve('src/fish/combat/dynamicStatusManager.ts'));
const { convertMvuAbilities } = require(resolve('src/fish/core/mvuBattleAdapter.ts'));
const { ABILITY_TRIGGERS } = require(resolve('src/game-core/battleTriggers.ts'));
const { describeCompactContent } = require(resolve('src/game-core/contentDescription.ts'));
const { triggeredEffectProgramToDisplayTags } = require(resolve('src/game-core/effectDisplay.ts'));

const store = GameStateManager.getInstance();
const executor = UnifiedEffectExecutor.getInstance();
const cards = CardSystem.getInstance();

function enemy() {
  return {
    id: 'trigger_target', name: '触发测试目标', emoji: '◇', maxHp: 40, currentHp: 40,
    maxLust: 100, currentLust: 0, energy: 0, maxEnergy: 0, block: 0,
    statusEffects: [], abilities: [], intent: { type: 'special', description: '', emoji: '?' },
    actions: [], nextAction: null, dialogue: '',
  };
}

const presentation = {
  addLog: () => {}, logStatusEffect: () => {}, showSummonAction: () => {},
  showHealthChange: () => {}, showBlockAbsorption: () => {}, showBlockChange: () => {},
  showEnergyChange: () => {}, showLustChange: () => {}, showResourceChange: () => {},
  refreshPlayerEnergy: () => {},
};
executor.presentation = presentation;
cards.presentation = { ...cards.presentation, ...presentation };

function auditResource(current = 0) {
  return {
    audit: { id: 'audit', name: '审计计数', emoji: '◆', current, max: 100, refresh: 'retain' },
  };
}

function auditProgram(amount = 1) {
  return {
    spec: 'mwg.effect/v1',
    steps: [{ op: 'gain_resource', target: 'self', resource: 'audit', amount }],
  };
}

function auditAbility(trigger, effectProgram = auditProgram()) {
  return { id: `audit_${trigger}`, name: `审计 ${trigger}`, trigger, effectProgram };
}

function auditCard(id, type = 'Skill') {
  return {
    id, originalId: id, templateId: id, name: id, type, rarity: 'Common', cost: 0,
    description: '',
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] },
  };
}

function resetAudit(trigger, options = {}) {
  store.resetGame();
  store.setCurrentTurn(1);
  store.setEnemies([{ ...enemy(), ...(options.enemy || {}) }], 'trigger_target');
  store.updatePlayer({
    currentHp: 30, maxHp: 40, currentLust: 0, maxLust: 100,
    block: 0, energy: 3, maxEnergy: 3, resources: auditResource(),
    hand: [], drawPile: [], discardPile: [], exhaustPile: [],
    abilities: [auditAbility(trigger, options.effectProgram)],
    relics: [], statusEffects: [],
  });
  store.setPhase('player_turn');
}

function assertAudit(trigger, expected = 1) {
  assert.equal(
    store.getPlayer().resources.audit.current,
    expected,
    `${trigger} must execute a real resource mutation through the production host`,
  );
}

store.resetGame();
store.updatePlayer({
  currentHp: 30, maxHp: 40, block: 0,
  abilities: [{
    id: 'first_team_lust', name: '首次阵营欲望响应', trigger: 'deal_lust_increase',
    eventQuery: { scope: 'team', ordinal: 'first', filter: { kind: 'lust_increased' } },
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] },
  }],
});
store.setEnemies([enemy()], 'trigger_target');

await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'gain_lust', target: 'opponent', amount: 3 }],
}, true);
assert.equal(store.getPlayer().block, 2, 'the first matching team-scoped lust event fires once');
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'gain_lust', target: 'opponent', amount: 4 }],
}, true);
assert.equal(store.getPlayer().block, 2, 'the persisted first-event ordinal does not fire again');
assert.deepEqual(
  store.getGameState().eventJournal.events.filter(event => event.kind === 'lust_increased')
    .map(event => [event.actorId, event.targetId, event.amount]),
  [['player', 'trigger_target', 3], ['player', 'trigger_target', 4]],
  'lust trigger filtering and persisted history use the same actor, target and amount',
);

await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'set_stat', target: 'opponent', stat: 'hp', value: 25 }],
}, true);
const directHpLoss = store.getGameState().eventJournal.events.filter(event => event.kind === 'damage_resolved').at(-1);
assert.equal(directHpLoss.hpLost, 15, 'set_hp decreases are journaled as the same damage event dispatched to abilities');
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'set_stat', target: 'self', stat: 'hp', value: 35 }],
}, true);
const directHeal = store.getGameState().eventJournal.events.filter(event => event.kind === 'heal_resolved').at(-1);
assert.equal(directHeal.hpGained, 5, 'set_hp increases are journaled as the same heal event dispatched to abilities');

store.updatePlayer({
  block: 0,
  abilities: [{
    id: 'first_shuffle', name: '首次重洗响应', trigger: 'on_shuffle',
    eventQuery: { scope: 'combat', ordinal: 'first', filter: { kind: 'draw_pile_shuffled' } },
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 3 }] },
  }],
  hand: [], drawPile: [], exhaustPile: [], discardPile: [{
    id: 'recycled_card', name: '回收测试牌', type: 'Skill', rarity: 'Common', cost: 0,
    description: '', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] },
  }],
});
const drawn = await cards.drawCards(1);
assert.equal(drawn.length, 1);
assert.equal(store.getPlayer().block, 3, 'on_shuffle receives a real persisted event before the draw continues');
assert.equal(
  store.getGameState().eventJournal.events.filter(event => event.kind === 'draw_pile_shuffled').length,
  1,
);

// A fresh encounter used to start with a pre-filled hand but no authoritative
// first-turn event, so every turn_start ability and relic silently missed turn
// one. The opening hand remains a dedicated lifecycle and must not emit
// card_drawn/on_draw events.
store.resetGame();
store.setCurrentTurn(1);
store.setEnemies([enemy()], 'trigger_target');
store.updatePlayer({
  currentHp: 40, maxHp: 40, block: 0, energy: 0, maxEnergy: 3, drawPerTurn: 5,
  hand: [], discardPile: [], exhaustPile: [],
  drawPile: [{
    id: 'opening_guard', originalId: 'opening_guard', name: '起手防护', type: 'Skill', rarity: 'Common', cost: 0,
    description: '', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] },
  }],
  abilities: [{
    id: 'opening_ability', name: '首回合能力', trigger: 'turn_start',
    eventQuery: { scope: 'combat', ordinal: 'first', filter: { kind: 'turn_started' } },
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] },
  }],
  relics: [{
    id: 'opening_relic', name: '首回合遗物', rarity: 'Common', trigger: 'turn_start', description: '', emoji: '◇',
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 3 }] },
  }],
});
const battleManager = BattleManager.getInstance();
battleManager.relicTriggerHost.presentation = {
  showTriggered: () => {}, addTriggeredLog: () => {}, addLog: () => {},
};
await battleManager.beginInitialPlayerTurn();
const openingState = store.getGameState();
assert.equal(openingState.phase, 'player_turn');
assert.equal(openingState.player.hand.length, 1);
assert.equal(openingState.player.block, 5, 'turn_start ability and relic both resolve on the first player turn');
assert.equal(openingState.eventJournal.events.filter(event => event.kind === 'turn_started' && event.actorId === 'player').length, 1);
assert.equal(openingState.eventJournal.events.filter(event => event.kind === 'card_drawn').length, 0, 'starting hand is not an on_draw event');

// Status ownership triggers now receive the exact persisted status event. This
// is important for "the first buff this combat" and similar generated powers:
// the schema must not advertise an ordinal that the production dispatcher
// evaluates against a guessed or unrelated event.
const statusManager = DynamicStatusManager.getInstance();
statusManager.registry.replace([{
  id: 'matrix_focus', name: '矩阵专注', emoji: '✨', type: 'buff', stacks_change: 'keep', triggers: {},
}]);
store.resetGame();
store.setEnemies([{
  ...enemy(),
  abilities: [{
    id: 'observe_first_player_buff', name: '观察首次增益', trigger: 'enemy_gain_buff',
    eventQuery: { scope: 'combat', ordinal: 'first', filter: { kind: 'status_applied' } },
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 3 }] },
  }],
}], 'trigger_target');
store.updatePlayer({
  block: 0,
  abilities: [
    {
      id: 'first_buff_guard', name: '首次增益防护', trigger: 'gain_buff',
      eventQuery: { scope: 'combat', ordinal: 'first', filter: { kind: 'status_applied' } },
      effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] },
    },
    {
      id: 'first_buff_loss_guard', name: '首次失去增益防护', trigger: 'lose_buff',
      eventQuery: { scope: 'combat', ordinal: 'first', filter: { kind: 'status_removed' } },
      effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 4 }] },
    },
  ],
});
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'apply_status', target: 'self', status: 'matrix_focus', stacks: 1 }],
}, true);
assert.equal(store.getPlayer().block, 2, 'the first player buff uses its recorded status_applied event');
assert.equal(store.getEnemyById('trigger_target').block, 3, 'the observing enemy receives the same exact status event');
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'apply_status', target: 'self', status: 'matrix_focus', stacks: 1 }],
}, true);
assert.equal(store.getPlayer().block, 2, 'the second status application no longer matches the first ordinal');
assert.equal(store.getEnemyById('trigger_target').block, 3, 'the observer also suppresses the second status ordinal');
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'remove_status', target: 'self', status: 'matrix_focus' }],
}, true);
assert.equal(store.getPlayer().block, 6, 'status removal filters use the persisted status_removed event');
assert.deepEqual(
  store.getGameState().eventJournal.events
    .filter(event => event.kind === 'status_applied' || event.kind === 'status_removed')
    .map(event => [event.kind, event.actorId, event.targetId, event.statusId]),
  [
    ['status_applied', 'player', 'player', 'matrix_focus'],
    ['status_applied', 'player', 'player', 'matrix_focus'],
    ['status_removed', 'player', 'player', 'matrix_focus'],
  ],
);

// Every advertised ability trigger must be proven against the production
// action that creates it. A direct `processAbilitiesByTrigger()` unit test is
// insufficient because it cannot catch a missing draw/card/status/attribute
// dispatch or a source/receiver mix-up.
const quietPresentation = new Proxy({}, {
  get: () => async () => undefined,
});
executor.presentation = quietPresentation;
cards.presentation = quietPresentation;
battleManager.enemyIntentPresenter = quietPresentation;
const productionCovered = new Set();
const cover = trigger => productionCovered.add(trigger);

resetAudit('battle_start');
await executor.processAbilitiesByTrigger('player', 'battle_start');
assertAudit('battle_start');
cover('battle_start');

resetAudit('ability_gain');
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1',
  steps: [{
    op: 'register_trigger', target: 'self', trigger: 'turn_start',
    effects: [{ op: 'gain_block', target: 'self', amount: 1 }],
  }],
}, true);
assertAudit('ability_gain');
cover('ability_gain');

resetAudit('turn_start');
await battleManager.beginInitialPlayerTurn();
assertAudit('turn_start');
cover('turn_start');

resetAudit('turn_end');
await battleManager.endPlayerTurn();
assertAudit('turn_end');
cover('turn_end');

for (const [trigger, cardType] of [
  ['card_played', 'Skill'],
  ['attack_played', 'Attack'],
  ['skill_played', 'Skill'],
  ['power_played', 'Power'],
]) {
  resetAudit(trigger);
  const card = auditCard(`audit_${trigger}_card`, cardType);
  store.updatePlayer({ hand: [card], deck: [card] });
  assert.equal(await cards.playCard(card.id), true, `${trigger} source card must be playable`);
  assertAudit(trigger);
  cover(trigger);
}

resetAudit('card_played', {
  enemy: {
    block: 0,
    abilities: [{
      id: 'payment_collector', name: '费用征收', trigger: 'attack_played',
      effectProgram: {
        spec: 'mwg.effect/v1',
        steps: [{ op: 'gain_block', target: 'self', amount: { op: 'var', path: 'context.spent_energy' } }],
      },
    }],
  },
});
const paidAttack = { ...auditCard('paid_attack', 'Attack'), cost: 'energy' };
store.updatePlayer({ hand: [paidAttack], deck: [paidAttack], resources: auditResource(5) });
assert.equal(await cards.playCard(paidAttack.id), true);
assert.equal(store.getEnemy().block, 3, 'enemy attack-played abilities read the actual energy paid by an X-cost card');
const paidEvent = store.getGameState().eventJournal.events.find(event =>
  event.kind === 'card_played' && event.phase === 'after' && event.cardInstanceId === paidAttack.id);
assert.deepEqual(paidEvent.paidResources, { energy: 3 }, 'actual payment survives in the saved battle journal');
const freeAttack = { ...auditCard('free_attack', 'Attack'), cost: 0 };
store.updatePlayer({ hand: [freeAttack], deck: [freeAttack] });
assert.equal(await cards.playCard(freeAttack.id), true);
assert.equal(store.getEnemy().block, 3, 'a zero-cost card contributes zero instead of its card-face category or a default cost');

resetAudit('card_played', {
  enemy: {
    block: 0,
    abilities: [{
      id: 'replay_payment_collector', name: '重放费用征收', trigger: 'attack_played',
      effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: { op: 'var', path: 'context.spent_energy' } }] },
    }],
  },
});
const replayPaidAttack = {
  ...auditCard('replay_paid_attack', 'Attack'), cost: 2,
  effectProgram: { spec: 'mwg.effect/v1', steps: [
    { op: 'gain_block', target: 'self', amount: 1 },
    { op: 'replay_current', count: 1 },
  ] },
};
store.updatePlayer({ hand: [replayPaidAttack], deck: [replayPaidAttack] });
assert.equal(await cards.playCard(replayPaidAttack.id), true);
assert.equal(store.getEnemy().block, 2, 'the payment observer taxes the initial payment once and replay events pay zero');
assert.deepEqual(store.getGameState().eventJournal.events.filter(event =>
  event.kind === 'card_played' && event.phase === 'after' && event.cardInstanceId === replayPaidAttack.id,
).map(event => event.paidEnergy), [2, 0]);

resetAudit('on_discard');
const slyCard = { ...auditCard('sly_card'), cost: 2, sly: true };
store.updatePlayer({ hand: [slyCard], deck: [slyCard], energy: 0, block: 0 });
assert.equal(await cards.discardCard(slyCard.id, 'effect'), true);
assert.equal(store.getPlayer().block, 1, '灵巧弃牌即使无能量也免费完整打出');
assert.equal(store.getPlayer().energy, 0);
assert.equal(store.getGameState().eventJournal.events.filter(event =>
  event.kind === 'card_played' && event.cardInstanceId === slyCard.id,
).every(event => event.paidEnergy === 0), true);

resetAudit('on_discard');
const compoundDiscard = {
  ...auditCard('compound_discard'), cost: 2, sly: true,
  discardEffectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] },
};
store.updatePlayer({ hand: [compoundDiscard], deck: [compoundDiscard], energy: 0, block: 0 });
assert.equal(await cards.discardCard(compoundDiscard.id, 'effect'), true);
assert.equal(store.getPlayer().block, 3, '单独弃牌效果先赋予2格挡，灵巧随后完整打出赋予1格挡，二者各执行一次');
assert.equal(store.getGameState().eventJournal.events.filter(event =>
  event.kind === 'card_played' && event.phase === 'after' && event.cardInstanceId === compoundDiscard.id).length, 1);
assert.equal(store.getPlayer().energy, 0, '灵巧完整打出不支付普通资源费用');

resetAudit('turn_end');
const cleanupSly = { ...auditCard('cleanup_sly'), sly: true };
store.updatePlayer({ hand: [cleanupSly], deck: [cleanupSly], block: 0 });
await cards.discardHand();
assert.equal(store.getPlayer().block, 0, '回合末自动弃牌不触发灵巧');
assert.equal(store.getPlayer().discardPile.some(card => card.id === cleanupSly.id), true);

resetAudit('on_discard');
const abandoned = { ...auditCard('abandoned'), lifecycle: { on_discard: 'remove' }, runInstanceId: 'run_abandoned' };
store.updatePlayer({ hand: [abandoned], deck: [abandoned] });
assert.equal(await cards.discardCard(abandoned.id, 'effect'), true);
assert.equal([...store.getPlayer().hand, ...store.getPlayer().drawPile, ...store.getPlayer().discardPile, ...store.getPlayer().exhaustPile]
  .some(card => card.id === abandoned.id), false, '遗弃从所有战斗牌区移除且不进入可回收消耗区');
assert.equal(store.getPlayer().deck.some(card => card.runInstanceId === 'run_abandoned'), true, '遗弃保留战后持有实例');

resetAudit('turn_end');
const forgotten = { ...auditCard('forgotten'), lifecycle: { on_discard: 'purge' }, runInstanceId: 'run_forgotten' };
store.updatePlayer({ hand: [forgotten], deck: [forgotten] });
await cards.discardHand();
assert.equal(store.getPlayer().deck.some(card => card.runInstanceId === 'run_forgotten'), false, '回合清理触发遗忘并永久删除精确持有实例');
assert.deepEqual(store.getGameState().purgedRunInstanceIds, ['run_forgotten']);
const forgottenSnapshot = JSON.parse(JSON.stringify(store.getGameState()));
store.replaceState(forgottenSnapshot);
assert.equal(store.getPlayer().deck.some(card => card.runInstanceId === 'run_forgotten'), false,
  '遗忘墓碑和精确删除在战斗快照恢复后保持不变');
assert.deepEqual(store.getGameState().purgedRunInstanceIds, ['run_forgotten']);

resetAudit('card_played');
const playedForget = { ...auditCard('played_forget'), lifecycle: { on_discard: 'purge' }, runInstanceId: 'run_played_forget' };
store.updatePlayer({ hand: [playedForget], deck: [playedForget] });
assert.equal(await cards.playCard(playedForget.id), true);
assert.equal(store.getPlayer().deck.some(card => card.runInstanceId === 'run_played_forget'), true,
  '正常打出进入弃牌堆不算弃牌，不触发遗忘');

resetAudit('turn_end');
const retainedForget = { ...auditCard('retained_forget'), retain: true, lifecycle: { on_discard: 'purge' }, runInstanceId: 'run_retained_forget' };
const voidForget = { ...auditCard('void_forget'), retain: true, ethereal: true, lifecycle: { on_discard: 'purge' }, runInstanceId: 'run_void_forget' };
store.updatePlayer({ hand: [retainedForget, voidForget], deck: [retainedForget, voidForget] });
await cards.discardHand();
assert.equal(store.getPlayer().hand.some(card => card.id === retainedForget.id), true, '保留优先避免自动弃牌，因而不触发遗忘');
assert.equal(store.getPlayer().exhaustPile.some(card => card.id === voidForget.id), true, '虚无优先于保留并直接消耗，不误触发遗忘');
assert.equal(store.getPlayer().deck.length, 2);

const voidAura = {
  id: 'void_aura', name: '虚无领域', trigger: 'passive',
  effectProgram: {
    spec: 'mwg.effect/v1',
    steps: [{ op: 'card_play_rule', target: 'opponent', rule: 'ethereal' }],
  },
};
store.setEnemies([{ ...enemy(), abilities: [voidAura] }], 'trigger_target');
assert.equal(executor.getCardPlayRules('player').some(rule => rule.rule === 'ethereal'), true, 'a living enemy grants the player dynamic ethereal');
store.setEnemies([{ ...enemy(), currentHp: 0, abilities: [voidAura] }], 'trigger_target');
assert.equal(executor.getCardPlayRules('player').some(rule => rule.rule === 'ethereal'), false, 'the aura disappears immediately when its exact enemy source dies');

resetAudit('on_discard');
{
  const card = auditCard('audit_discard_card');
  store.updatePlayer({ hand: [card], deck: [card] });
  assert.equal(await cards.discardCard(card.id, 'effect'), true);
  assertAudit('on_discard');
  cover('on_discard');
}

resetAudit('on_exhaust');
{
  const card = auditCard('audit_exhaust_card');
  store.updatePlayer({ hand: [card], deck: [card] });
  await cards.exhaustCard(card, 'hand');
  assertAudit('on_exhaust');
  cover('on_exhaust');
}

resetAudit('on_draw');
{
  const card = auditCard('audit_draw_card');
  store.updatePlayer({ drawPile: [card], deck: [card] });
  assert.equal((await cards.drawCards(1)).length, 1);
  assertAudit('on_draw');
  cover('on_draw');
}

resetAudit('on_draw', {
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'draw_cards', amount: 1 }] },
});
{
  const deck = [auditCard('draw_chain_a'), auditCard('draw_chain_b'), auditCard('draw_chain_c')];
  store.updatePlayer({ hand: [], drawPile: deck, deck });
  await cards.drawCards(1);
  assert.equal(store.getPlayer().hand.length, 2, 'on_draw may grant one explicit nested draw');
  assert.equal(
    store.getGameState().eventJournal.events.filter(event => event.kind === 'card_drawn').length,
    2,
    'the nested draw is journaled but the active on_draw source does not recursively re-enter itself',
  );
}

resetAudit('on_shuffle');
{
  const card = auditCard('audit_shuffle_card');
  store.updatePlayer({ discardPile: [card], deck: [card] });
  assert.equal((await cards.drawCards(1)).length, 1);
  assertAudit('on_shuffle');
  cover('on_shuffle');
}


resetAudit('on_shuffle', {
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'draw_cards', amount: 1 }] },
});
{
  const deck = [auditCard('shuffle_chain_a'), auditCard('shuffle_chain_b'), auditCard('shuffle_chain_c')];
  store.updatePlayer({ hand: [], drawPile: [], discardPile: deck, deck });
  await cards.drawCards(1);
  assert.equal(store.getPlayer().hand.length, 2, 'on_shuffle may draw without recursively reshuffling');
  assert.equal(
    store.getGameState().eventJournal.events.filter(event => event.kind === 'draw_pile_shuffled').length,
    1,
  );
}

const attributeCases = [
  ['take_damage', { currentHp: 30 }, false, { op: 'damage', target: 'opponent', amount: 2 }],
  ['take_heal', { currentHp: 20 }, true, { op: 'heal', target: 'self', amount: 2 }],
  ['deal_damage', {}, true, { op: 'damage', target: 'opponent', amount: 2 }],
  ['deal_heal', {}, true, { op: 'heal', target: 'opponent', amount: 2 }, { currentHp: 20 }],
  ['lust_increase', { currentLust: 0 }, true, { op: 'gain_lust', target: 'self', amount: 2 }],
  ['lust_decrease', { currentLust: 10 }, true, { op: 'set_stat', target: 'self', stat: 'lust', value: 5 }],
  ['deal_lust_increase', {}, true, { op: 'gain_lust', target: 'opponent', amount: 2 }],
  ['deal_lust_decrease', {}, true, { op: 'set_stat', target: 'opponent', stat: 'lust', value: 5 }, { currentLust: 10 }],
  ['gain_block', { block: 0 }, true, { op: 'gain_block', target: 'self', amount: 2 }],
  ['lose_block', { block: 10 }, true, { op: 'set_stat', target: 'self', stat: 'block', value: 5 }],
];
for (const [trigger, playerChanges, sourceIsPlayer, effect, enemyChanges] of attributeCases) {
  resetAudit(trigger, { enemy: enemyChanges });
  store.updatePlayer(playerChanges);
  await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [effect] }, sourceIsPlayer);
  assertAudit(trigger);
  cover(trigger);
}

statusManager.registry.replace([
  { id: 'audit_buff', name: '审计增益', emoji: '+', type: 'buff', stacks_change: 'keep', triggers: {} },
  { id: 'audit_debuff', name: '审计减益', emoji: '-', type: 'debuff', stacks_change: 'keep', triggers: {} },
]);
const statusCases = [
  ['gain_buff', 'audit_buff', 'self', 'apply'],
  ['gain_debuff', 'audit_debuff', 'self', 'apply'],
  ['lose_buff', 'audit_buff', 'self', 'remove'],
  ['lose_debuff', 'audit_debuff', 'self', 'remove'],
  ['enemy_gain_buff', 'audit_buff', 'opponent', 'apply'],
  ['enemy_gain_debuff', 'audit_debuff', 'opponent', 'apply'],
  ['enemy_lose_buff', 'audit_buff', 'opponent', 'remove'],
  ['enemy_lose_debuff', 'audit_debuff', 'opponent', 'remove'],
];
for (const [trigger, status, target, action] of statusCases) {
  resetAudit(trigger);
  if (action === 'remove') {
    await executor.executeEffectProgram({
      spec: 'mwg.effect/v1',
      steps: [{ op: 'apply_status', target, status, stacks: 1 }],
    }, true);
    assertAudit(trigger, 0);
  }
  await executor.executeEffectProgram({
    spec: 'mwg.effect/v1',
    steps: [{
      op: action === 'apply' ? 'apply_status' : 'remove_status',
      target,
      status,
      ...(action === 'apply' ? { stacks: 1 } : {}),
    }],
  }, true);
  assertAudit(trigger);
  cover(trigger);
}

resetAudit('defeated', {
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'heal', target: 'self', amount: 1 }] },
});
store.updatePlayer({ currentHp: 1 });
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 2 }],
}, false);
assert.equal(store.getPlayer().currentHp, 1, 'defeated ability must resolve before the player defeat is finalized');
cover('defeated');

resetAudit('kill');
store.setEnemies([
  { ...enemy(), currentHp: 2 },
  { ...enemy(), id: 'surviving_target' },
], 'trigger_target');
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 2 }],
}, true);
assertAudit('kill');
assert.equal(store.getGameState().eventJournal.events.filter(event => event.kind === 'entity_defeated').length, 1);
store.replaceState(JSON.parse(JSON.stringify(store.getGameState())));
await executor.processPendingDeaths();
assertAudit('kill', 1);
assert.equal(store.getEnemyById('surviving_target').currentHp, 40, 'kill rewards do not damage an unrelated surviving enemy');
cover('kill');

resetAudit('passive', {
  effectProgram: {
    spec: 'mwg.effect/v1',
    steps: [{ op: 'modify', target: 'self', stat: 'damage', operator: 'add', value: 2 }],
  },
});
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 3 }],
}, true);
assert.equal(store.getEnemy().currentHp, 35, 'passive ability must change the actual damage calculation');
cover('passive');

assert.deepEqual(
  [...productionCovered].sort(),
  [...ABILITY_TRIGGERS].sort(),
  'every advertised ability trigger must own a real production event and mutation proof',
);

for (const trigger of ABILITY_TRIGGERS) {
  const publicDefinition = {
    id: `public_${trigger}`,
    name: `公开 ${trigger}`,
    trigger: {
      on: trigger,
      effects: trigger === 'passive'
        ? { modify: 'damage', add: 1 }
        : { resource: { id: 'audit', amount: 1 } },
    },
  };
  const converted = convertMvuAbilities([publicDefinition]);
  assert.equal(converted.length, 1, `${trigger} must compile from the one public structured trigger spelling`);
  assert.equal(converted[0].trigger, trigger);
  if (trigger === 'kill') {
    const displayContext = { resourceNames: { audit: '审计计数' }, resourceEmojis: { audit: '◆' } };
    const compactText = describeCompactContent(publicDefinition, displayContext);
    const savedAbility = JSON.parse(JSON.stringify(converted[0]));
    const runtimeText = triggeredEffectProgramToDisplayTags(savedAbility.trigger, savedAbility.effectProgram, displayContext)
      .map(tag => tag.text).join('；');
    for (const text of [compactText, runtimeText]) {
      assert.match(text, /击败敌人/);
      assert.match(text, /审计计数/);
      assert.doesNotMatch(text, /\bkill\b/);
    }
  }
}

store.resetGame();
store.setCurrentTurn(1);
store.setEnemies([enemy()], 'trigger_target');
store.updatePlayer({
  currentHp: 30, maxHp: 40, resources: auditResource(), abilities: [], relics: [], statusEffects: [],
});
const statusLifecycleLoad = statusManager.registry.replace([{
  id: 'complete_lifecycle', name: '完整生命周期', emoji: '◇', type: 'buff',
  stacks_change: -1, maxStacks: 3,
  triggers: {
    apply: { resource: { id: 'audit', amount: 1 }, to: 'self' },
    stack: { resource: { id: 'audit', amount: 2 }, to: 'self' },
    tick: { resource: { id: 'audit', amount: 4 }, to: 'self' },
    remove: { resource: { id: 'audit', amount: 8 }, to: 'self' },
    hold: { modify: 'damage', add: 'stacks' },
  },
}]);
assert.equal(statusLifecycleLoad.loaded.length, 1);
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'apply_status', target: 'self', status: 'complete_lifecycle', stacks: 1 }],
}, true);
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'apply_status', target: 'self', status: 'complete_lifecycle', stacks: 1 }],
}, true);
assert.equal(store.getPlayer().resources.audit.current, 3, 'status apply and stack programs both mutate their holder');
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 3 }],
}, true);
assert.equal(store.getEnemy().currentHp, 35, 'status hold modifiers use the current stack count in real damage');
await executor.processStatusEffectsAtActionTiming('player', 'before_action');
assert.equal(store.getPlayer().resources.audit.current, 7, 'default tick occurs at the holder action boundary');
await executor.processStatusEffectsAtTurnEnd('player');
assert.equal(store.getPlayer().resources.audit.current, 7);
assert.equal(store.getPlayer().statusEffects[0].stacks, 1);
await executor.processStatusEffectsAtActionTiming('player', 'before_action');
assert.equal(store.getPlayer().resources.audit.current, 11);
await executor.processStatusEffectsAtTurnEnd('player');
assert.equal(store.getPlayer().resources.audit.current, 19, 'turn-end decay removes the status once without repeating its action tick');
assert.deepEqual(store.getPlayer().statusEffects, []);

// Held statuses share the production event bus with abilities. They use a
// direct trigger key, preserve their stack context, and are protected from
// self-recursion when their own effect emits the same event again.
statusManager.registry.replace([
  {
    id: 'attack_trace', name: '攻击轨迹', emoji: '↗️', type: 'buff', stacks_change: 'reset',
    triggers: { attack_played: { resource: { id: 'audit', amount: 'stacks' } } },
  },
  {
    id: 'guard_echo', name: '护盾回声', emoji: '▣', type: 'buff', stacks_change: 'keep',
    triggers: { gain_block: { block: 1 } },
  },
  {
    id: 'wound_guard', name: '受击防护', emoji: '◇', type: 'buff', stacks_change: 'keep',
    triggers: { take_damage: { block: 'stacks' } },
  },
]);
store.resetGame();
store.setCurrentTurn(1);
store.setEnemies([enemy()], 'trigger_target');
store.updatePlayer({
  currentHp: 30, maxHp: 40, block: 0, energy: 3, maxEnergy: 3,
  resources: auditResource(), abilities: [], relics: [], statusEffects: [],
  hand: [], drawPile: [], discardPile: [], exhaustPile: [],
});
store.setPhase('player_turn');
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'apply_status', target: 'self', status: 'attack_trace', stacks: 2 }],
}, true);
const traceCard = auditCard('status_event_attack', 'Attack');
store.updatePlayer({ hand: [traceCard], deck: [traceCard] });
assert.equal(await cards.playCard(traceCard.id), true);
assert.equal(store.getPlayer().resources.audit.current, 2, 'attack event status reads its live stack count');
await executor.processStatusEffectsAtTurnEnd('player');
const secondTraceCard = auditCard('status_event_attack_after_reset', 'Attack');
store.updatePlayer({ hand: [secondTraceCard], deck: [secondTraceCard] });
assert.equal(await cards.playCard(secondTraceCard.id), true);
assert.equal(store.getPlayer().resources.audit.current, 2, 'a reset status stops observing later turns');

await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'apply_status', target: 'self', status: 'guard_echo', stacks: 1 }],
}, true);
store.updatePlayer({ block: 0 });
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }],
}, true);
assert.equal(store.getPlayer().block, 2, 'a status may answer gain_block once without recursively triggering itself forever');

await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'apply_status', target: 'opponent', status: 'wound_guard', stacks: 3 }],
}, true);
await executor.executeEffectProgram({
  spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 2 }],
}, true);
assert.equal(
  store.getEnemyById('trigger_target').block,
  3,
  'an enemy status observes damage on its exact multi-enemy holder and keeps self bound to that enemy',
);

store.updatePlayer({
  resources: auditResource(),
  statusEffects: [],
  abilities: [{
    id: 'create_trace_on_attack', name: '生成轨迹', trigger: 'attack_played',
    effectProgram: {
      spec: 'mwg.effect/v1',
      steps: [{ op: 'apply_status', target: 'self', status: 'attack_trace', stacks: 1 }],
    },
  }],
});
const creationCard = auditCard('status_creation_attack', 'Attack');
store.updatePlayer({ hand: [creationCard], deck: [creationCard] });
assert.equal(await cards.playCard(creationCard.id), true);
assert.equal(
  store.getPlayer().resources.audit.current,
  0,
  'a status created by an attack listener does not retroactively observe the creating attack',
);
const laterCard = auditCard('status_later_attack', 'Attack');
store.updatePlayer({ hand: [laterCard], deck: [laterCard] });
assert.equal(await cards.playCard(laterCard.id), true);
assert.equal(store.getPlayer().resources.audit.current, 2, 'the same status observes the next attack with its then-current stacks');

// AI may omit event/card_type because on already determines them. Exercise
// that compact boundary through real card play, not only journal fixtures.
for (const [ordinal, n, expected] of [
  ['first', undefined, [0, 1, 1, 1]],
  ['every_n', 2, [0, 0, 1, 1]],
]) {
  resetAudit('skill_played');
  store.updatePlayer({ abilities: convertMvuAbilities([{
    id: 'compact_ordinal', name: '精简序数监听',
    trigger: { on: 'skill_played', ordinal, ...(n ? { n } : {}), effects: { resource: { id: 'audit', amount: 1 } } },
  }]) });
  const types = ['Attack', 'Skill', 'Skill', 'Skill'];
  for (let index = 0; index < types.length; index += 1) {
    const source = auditCard(`mixed_${ordinal}_${index}`, types[index]);
    store.updatePlayer({ hand: [source], deck: [source] });
    assert.equal(await cards.playCard(source.id), true);
    assert.equal(store.getPlayer().resources.audit.current, expected[index], `${ordinal} must count only real skill plays`);
  }
}

resetAudit('gain_buff');
statusManager.registry.replace([
  { id: 'mixed_buff', name: '测试增益', emoji: '✨', type: 'buff', stacks_change: 'keep', triggers: {} },
  { id: 'mixed_debuff', name: '测试减益', emoji: '◇', type: 'debuff', stacks_change: 'keep', triggers: {} },
]);
store.updatePlayer({ abilities: convertMvuAbilities([{
  id: 'compact_buff_ordinal', name: '首次增益监听',
  trigger: { on: 'gain_buff', ordinal: 'first', effects: { resource: { id: 'audit', amount: 1 } } },
}]) });
for (const [status, target, expected] of [
  ['mixed_debuff', 'self', 0], ['mixed_buff', 'opponent', 0], ['mixed_buff', 'self', 1], ['mixed_buff', 'self', 1],
]) {
  await executor.executeEffectProgram({ spec: 'mwg.effect/v1', steps: [{ op: 'apply_status', status, target, stacks: 1 }] }, true);
  assert.equal(store.getPlayer().resources.audit.current, expected, 'the production status journal persists polarity and exact holder');
}
assert.deepEqual(store.getGameState().eventJournal.events.filter(event => event.kind === 'status_applied').map(event => event.statusType), ['debuff', 'buff', 'buff', 'buff']);

console.log(`All ${ABILITY_TRIGGERS.length} ability triggers compile and mutate state through their production event paths; compact ordinal mixed-card and mixed-status cases also pass.`);
