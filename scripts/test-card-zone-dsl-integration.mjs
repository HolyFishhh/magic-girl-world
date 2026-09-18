import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const replacement = {
  id: 'changed_template', name: '变形结果', emoji: '🔄', type: 'Skill', rarity: 'Uncommon', cost: 1,
  description: '形态已经改变。', effects: { block: 7 },
};
const compiled = core.compileCompactEffectList([
  { move_card: 1, from: 'hand', pick: 'left', destination: 'draw', position: 'top' },
  { remove_card: 1, from: 'exhaust', pick: 'top' },
  { transform_card: 'changed_template', from: 'discard', pick: 'top', count: 1 },
], { creates: [replacement] });
assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.issues));
assert.deepEqual(compiled.value.steps.map(node => node.op), ['move_cards', 'remove_cards', 'transform_cards']);
assert.equal(compiled.value.steps[2].replacement.id, 'changed_template');
const display = core.effectProgramToDisplayTags(compiled.value).map(tag => tag.text).join('；');
assert.match(display, /抽牌堆顶部/);
assert.match(display, /移除/);
assert.match(display, /变形结果/);
assert.equal(core.compileCompactEffectList([{ move_card: 1, destination: 'invalid' }]).ok, false);
assert.equal(core.compileCompactEffectList([{ transform_card: 'missing' }], { creates: [] }).ok, false);

const program = { spec: core.EFFECT_PROGRAM_SPEC, steps: [{ op: 'damage', target: 'opponent', amount: 1 }] };
const card = (id, zone = 'deck') => core.ensureCardIdentity({
  id, originalId: id, name: id, emoji: '🃏', type: 'Attack', rarity: 'Common', cost: 1,
  effectProgram: program, description: '',
}, { templateId: id, runInstanceId: `${id}:run`, combatInstanceId: id, origin: zone });
const battle = core.createEmptyBattleState();
battle.player.hand = [card('hand_left'), card('hand_right')];
battle.player.drawPile = [card('draw_bottom'), card('draw_top')];
battle.player.discardPile = [card('discard_target')];
battle.player.exhaustPile = [card('exhaust_target')];
const store = new core.BattleStateStore(battle);
const events = [];
const runtime = new core.CardEffectRuntime(store, {
  drawCards: async () => {},
  chooseCards: async () => null,
  onCardDiscarded: async () => {},
  onCardExhausted: async () => {},
  autoPlayCard: async () => false,
  present: event => events.push(event),
});
const commands = [];
await core.runEffectCommandProgram(compiled.value, { spentEnergy: 0 }, {
  readState: () => ({
    self: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
    opponent: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
    currentTurn: 1, cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0,
  }),
  execute: command => commands.push(command),
});
for (const command of commands) await runtime.execute(command);

const zones = store.readCardZoneState();
assert.deepEqual(zones.hand.map(entry => entry.id), ['hand_right']);
assert.equal(zones.drawPile.at(-1).id, 'hand_left', 'move-to-top uses the actual next-draw end of the pile');
assert.deepEqual(zones.exhaustPile, []);
assert.equal(zones.discardPile[0].id, 'discard_target', 'transform preserves the concrete combat identity');
assert.equal(zones.discardPile[0].templateId, 'changed_template');
assert.equal(zones.discardPile[0].name, '变形结果');
assert.equal(zones.discardPile[0].origin, 'transformed');
assert.equal(events.some(event => event.type === 'card_moved'), true);
assert.equal(events.some(event => event.type === 'card_removed'), true);
assert.equal(events.some(event => event.type === 'card_transformed'), true);

const allCard = (id, zone = 'deck') => core.ensureCardIdentity({
  id, originalId: id, name: id, emoji: '🃏', type: 'Attack', rarity: 'Common', cost: 2,
  effectProgram: {
    spec: core.EFFECT_PROGRAM_SPEC,
    steps: [{ op: 'damage', target: 'opponent', amount: 6 }],
  },
  description: '',
}, { templateId: id, runInstanceId: `${id}:run`, combatInstanceId: id, origin: zone });

async function executeAllSelection(effect, initialZones, options = {}) {
  const compilation = core.compileCompactEffectList(effect, options);
  assert.equal(compilation.ok, true, compilation.ok ? '' : JSON.stringify(compilation.issues));
  const state = core.createEmptyBattleState();
  state.player.hand = (initialZones.hand || []).map(id => allCard(id));
  state.player.drawPile = (initialZones.drawPile || []).map(id => allCard(id));
  state.player.discardPile = (initialZones.discardPile || []).map(id => allCard(id));
  state.player.exhaustPile = (initialZones.exhaustPile || []).map(id => allCard(id));
  const stateStore = new core.BattleStateStore(state);
  const runtimeEvents = [];
  const cardRuntime = new core.CardEffectRuntime(stateStore, {
    drawCards: async () => {},
    chooseCards: async () => {
      throw new Error('pick:all must never open an interactive selector');
    },
    onCardDiscarded: async () => {},
    onCardExhausted: async () => {},
    autoPlayCard: async () => false,
    present: event => runtimeEvents.push(event),
  });
  const emitted = [];
  await core.runEffectCommandProgram(compilation.value, { spentEnergy: 0 }, {
    readState: () => ({
      self: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
      opponent: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
      currentTurn: 1, cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0,
    }),
    execute: command => emitted.push(command),
  });
  for (const command of emitted) await cardRuntime.execute(command);
  return { compilation, zones: stateStore.readCardZoneState(), events: runtimeEvents };
}

const allInitialZones = {
  hand: ['all_hand_a', 'all_hand_b'],
  drawPile: ['all_draw'],
  discardPile: ['all_discard_a', 'all_discard_b'],
  exhaustPile: ['all_exhaust_a', 'all_exhaust_b'],
};

const movedAll = await executeAllSelection(
  { move_card: 'all', from: 'discard', pick: 'all', destination: 'draw', position: 'top' },
  allInitialZones,
);
assert.deepEqual(movedAll.zones.discardPile, []);
assert.deepEqual(
  new Set(movedAll.zones.drawPile.map(entry => entry.id)),
  new Set(['all_draw', 'all_discard_a', 'all_discard_b']),
  'move_card:all must move every matching card instead of only the hidden default count',
);
assert.equal(movedAll.events.filter(event => event.type === 'card_moved').length, 2);

const removedAll = await executeAllSelection(
  { remove_card: 'all', from: 'exhaust', pick: 'all' },
  allInitialZones,
);
assert.deepEqual(removedAll.zones.exhaustPile, []);
assert.equal(removedAll.events.filter(event => event.type === 'card_removed').length, 2);

const transformedAll = await executeAllSelection(
  { transform_card: 'changed_template', from: 'hand', pick: 'all' },
  allInitialZones,
  { creates: [replacement] },
);
assert.equal(transformedAll.zones.hand.length, 2);
assert.equal(transformedAll.zones.hand.every(entry => entry.templateId === 'changed_template'), true);
assert.equal(transformedAll.events.filter(event => event.type === 'card_transformed').length, 2);

for (const [name, effect, assertCard] of [
  [
    'reduce_cost',
    { reduce_cost: 1, from: 'combat', pick: 'all' },
    card => assert.equal(card.cost, 1),
  ],
  [
    'modify_card',
    { modify_card: 'damage', add: 3, from: 'combat', pick: 'all' },
    card => assert.equal(card.effectProgram.steps[0].amount, 9),
  ],
  [
    'patch_card',
    { patch_card: 'cost', subtract: 1, scope: 'combat', from: 'combat', pick: 'all' },
    card => assert.equal(card.cost, 1),
  ],
  [
    'attach_card',
    {
      attach_card: {
        id: 'all_binding', kind: 'affliction', name: '全体束缚', scope: 'combat',
        changes: [{ kind: 'cost', operator: 'add', value: 1 }],
      },
      from: 'combat', pick: 'all',
    },
    card => {
      assert.equal(card.cost, 3);
      assert.equal(card.attachments?.some(entry => entry.id === 'all_binding'), true);
    },
  ],
]) {
  const result = await executeAllSelection(effect, allInitialZones);
  const affected = Object.values(result.zones).flat();
  assert.equal(affected.length, 7, `${name} must preserve all cards`);
  affected.forEach(assertCard);
  assert.equal(
    result.compilation.value.steps[0].selector.count,
    undefined,
    `${name} pick:all must not retain a hidden one-card count`,
  );
}

console.log('All-selection card-zone operations compile and affect every matching runtime card without an interactive prompt.');
