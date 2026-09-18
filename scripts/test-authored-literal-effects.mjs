import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only'); require('tsconfig-paths/register');
const { diagnoseAuthoredLiteralEffects: diagnose, collectAuthoredLiteralEffectIssues: collect,
  assertAuthoredLiteralEffectRepair: validateRepair, assertAuthoredLiteralRepairPreservation: preserve,
  createLiteralEffectSequenceSchema } = require('../src/game-core/authoredLiteralEffects.ts');
const { extractTowerInitialRepairSlotTargets, parseTowerInitialSlotRepairResponse, mergeTowerInitialSlotRepair } = require('../src/sillytavern-extension/controller.ts');
const { createTowerInitialSlotRepairJsonSchema, TOWER_INITIAL_SLOT_REPAIR_SPEC } = require('../src/game-core/towerRequest.ts');
const card = { id: 'literal_delay', name: '延迟测试', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
  description: '造成5点伤害；下一回合开始时，对该敌人再造成5点伤害。', effects: [{ damage: 5, to: 'opponent' }] };
const fixed = [...card.effects, { schedule: 1, phase: 'turn_start', effects: { damage: 5, to: 'opponent' } }];
assert.equal(diagnose(card, 'x')[0]?.code, 'EXPLICIT_LITERAL_EFFECT_MISMATCH');
assert.deepEqual(diagnose({ ...card, effects: fixed }, 'x'), []);
validateRepair(card, fixed);
for (const [description, effects] of [
  ['获得3点格挡；下回合开始时再获得5点格挡。', [{ block: 3 }, { schedule: 1, effects: { block: 5 } }]],
  ['回复3点生命；下一回合结束时，回复5点生命。', [{ heal: 3 }, { schedule: 1, phase: 'turn_end', effects: { heal: 5 } }]],
  ['抽2张牌；获得1点能量。', [{ draw: 2 }, { energy: 1 }]],
  ['对自身造成3点伤害。', { damage: 3, to: 'self' }],
]) {
  assert.deepEqual(diagnose({ description, effects }, 'x'), []);
  assert.equal(diagnose({ description, effects: { damage: 9 } }, 'x').length, 1, description);
}
for (const description of [
  '据说下回合开始时造成5点伤害。', '“下回合开始时造成5点伤害”是传闻。',
  '下回合开始时不造成5点伤害。', '下回合开始时，若有格挡，造成5点伤害。',
  '造成5点伤害；下回合开始时，钟声响起。', '获得3层偿时之债。',
  '造成8点伤害，但该伤害延迟到下一回合开始时才生效。',
  '下回合开始时可能造成5点伤害。', '造成5点伤害；；下一回合开始时造成5点伤害。',
  '下回合开始时造成5点伤害；造成5点伤害。',
]) assert.deepEqual(diagnose({ ...card, description }, 'x'), [], description);
for (const effects of [
  { apply_status: 'future_damage', stacks: 1 }, { damage: 'self.energy' },
  { damage: 5, when: 'turn_number > 0' }, { damage: 5, draw: 1 },
  { damage: 5, damage_type: 'hp_loss' }, { call: 'named_program' },
  { schedule: 1, phase: 'after_draw', effects: { damage: 5 } },
  [{ schedule: 1, effects: { damage: 5 } }, { damage: 5 }],
  [{ schedule: 1, effects: { damage: 5 } }, { schedule: 1, effects: { damage: 5 } }],
]) assert.deepEqual(diagnose({ ...card, effects }, 'x'), [], 'uninterpreted effects are not evidence of a mismatch');
assert.deepEqual(diagnose({ ...card, trigger: { on: 'turn_start', effects: { damage: 5 } } }, 'x'), []);
for (const bad of [
  card.effects, [{ damage: 5 }, { schedule: 2, phase: 'turn_start', effects: { damage: 5 } }],
  [{ damage: 5 }, { schedule: 1, phase: 'turn_end', effects: { damage: 5 } }],
  [{ damage: 5 }, { schedule: 1, phase: 'turn_start', effects: { damage: 5, to: 'self' } }],
  [{ damage: 5 }, { schedule: 1, phase: 'turn_start', effects: { damage: 0 } }],
  [{ damage: 5, when: 'turn_number > 0' }],
]) assert.throws(() => validateRepair(card, bad));
const owner = { reward: { card: [card] } };
const corrected = { reward: { card: [{ ...card, effects: fixed }] } };
preserve(owner, corrected);
for (const edit of [c => delete c.description, c => c.description = '风味', c => c.name = '重写',
  c => c.effects = [{ damage: 5, when: 'turn_number > 0' }]]) {
  const changed = structuredClone(corrected); edit(changed.reward.card[0]); assert.throws(() => preserve(owner, changed));
}
assert.throws(() => preserve(owner, { reward: { card: [] } }));
const cyclic = {}; cyclic.self = cyclic;
assert.equal(collect(cyclic)[0].code, 'LITERAL_EFFECT_AUDIT_LIMIT');
assert.throws(() => preserve(cyclic, {}));
let deep = {}; const root = deep;
for (let i = 0; i < 70; i++) deep = deep.next = {};
assert.equal(collect(root)[0].code, 'LITERAL_EFFECT_AUDIT_LIMIT');
const repeated = { a: card, b: card };
assert.equal(collect(repeated).length, 2, 'shared objects are not cycles');

// The existing finite repair protocol writes only effects; model output must
// implement the original complete literal claims, not merely be well-formed.
const initial = { narrative: '原剧情', status: { time: '黄昏' }, player: { cards: [card, { ...card, id: 'valid', effects: fixed }] },
  opening: { choices: [{ id: 'gift', outcome: { reward: { cards: [structuredClone(card)] } } }] } };
const before = structuredClone(initial);
const issues = collect(initial);
assert.deepEqual(issues.map(i => i.path), ['player.cards[0].effects', 'opening.choices[0].outcome.reward.cards[0].effects']);
const targets = extractTowerInitialRepairSlotTargets(initial, issues.map(i => `${i.path}：[${i.code}] ${i.message.replaceAll('；', '，')}`).join('；'));
assert.equal(targets.length, 2);
assert(targets.every(root => root.slots.length === 1 && root.slots[0].kind === 'literal_effect_sequence'));
const response = { spec: TOWER_INITIAL_SLOT_REPAIR_SPEC, roots: Object.fromEntries(targets.map(r => [r.token, {
  slots: Object.fromEntries(r.slots.map(s => [s.token, { action: s.action, value: fixed }])) } ])), support_statuses: [], support_resources: [] };
const ajv = new Ajv2020({ strict: false });
const schema = ajv.compile(createTowerInitialSlotRepairJsonSchema(targets).value);
assert.equal(schema(response), true, JSON.stringify(schema.errors));
const merged = mergeTowerInitialSlotRepair(initial, targets, parseTowerInitialSlotRepairResponse(response, targets));
const expected = structuredClone(initial); expected.player.cards[0].effects = fixed; expected.opening.choices[0].outcome.reward.cards[0].effects = fixed;
assert.deepEqual(merged, expected);
assert.deepEqual(initial, before);
assert.deepEqual(collect(merged), []);
const erased = structuredClone(response); erased.roots[targets[0].token].description = 'hidden';
assert.throws(() => parseTowerInitialSlotRepairResponse(erased, targets));
const noRepair = structuredClone(response); noRepair.roots[targets[0].token].slots[targets[0].slots[0].token].value = card.effects;
assert.throws(() => parseTowerInitialSlotRepairResponse(noRepair, targets));
const finiteSchema = ajv.compile(createLiteralEffectSequenceSchema());
assert.equal(finiteSchema(fixed), true);
for (const invalid of [[{ damage: 5, when: 'turn_number > 0' }], [{ damage: 5, heal: 2 }], [{ schedule: 1, phase: 'turn_start', effects: { spawn_summon: {} } }]]) {
  assert.equal(finiteSchema(invalid), false);
}
// The model fixture's accepted compact replacement executes through the actual
// CardSystem and scheduled-phase dispatcher. Only presentation is silenced;
// there is no browser, network, model call or live save mutation in this test.
const { createBattleRequestFromMvu } = require('../src/fish/core/battleContractAdapter.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const { CardSystem } = require('../src/fish/combat/cardSystem.ts');
const { BattleManager } = require('../src/fish/combat/battleManager.ts');
const battle = {
  core: { emoji: '◇', hp: 20, max_hp: 20, lust: 0, max_lust: 100 },
  cards: [{ ...structuredClone(card), effects: structuredClone(fixed) }],
  statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
  enemy: { id: 'literal_target', name: '隔离目标', emoji: '◇', hp: 50, max_hp: 50,
    lust: 0, max_lust: 100, actions: [{ id: 'wait', name: '等待', effects: { block: 0 } }] },
};
const battleBefore = structuredClone(battle);
const store = GameStateManager.getInstance(), executor = UnifiedEffectExecutor.getInstance();
const cards = CardSystem.getInstance(), manager = BattleManager.getInstance();
const quiet = new Proxy({}, { get: () => async () => undefined });
executor.presentation = quiet; cards.presentation = quiet;
manager.relicTriggerHost.presentation = quiet; manager.enemyIntentPresenter = quiet;
store.convertMVUToGameState(createBattleRequestFromMvu({ stat_data: { battle } }, battle));
manager.prepareInitialPlayerTurn();
await manager.beginInitialPlayerTurn();
const instance = store.getPlayer().hand.find(c => c.originalId === card.id);
assert.ok(instance);
assert.equal(cards.previewCardPlay(instance.id).ok, true);
assert.equal(await cards.playCard(instance.id), true);
assert.equal(store.getEnemy().currentHp, 45, 'immediate literal damage executes once');
assert.equal(store.readEffectScheduler().queue.length, 1);
const currentTurn = store.getGameState().currentTurn;
await manager.executeScheduledPhase('turn_start');
assert.equal(store.getEnemy().currentHp, 45, 'not during the current turn');
const saved = JSON.stringify(store.getGameState());
store.replaceState(JSON.parse(saved));
assert.equal(JSON.stringify(store.getGameState()), saved, 'pending effect survives JSON restore exactly');
store.setCurrentTurn(currentTurn + 1);
await manager.executeScheduledPhase('turn_end');
assert.equal(store.getEnemy().currentHp, 45, 'a different phase cannot fire this effect');
await manager.executeScheduledPhase('turn_start');
assert.equal(store.getEnemy().currentHp, 40, 'next turn start executes the promised second 5 damage');
assert.equal(store.readEffectScheduler().queue.length, 0);
await manager.executeScheduledPhase('turn_start');
assert.equal(store.getEnemy().currentHp, 40, 'repeated phase callback does not duplicate damage');
assert.equal(store.getPlayer().currentHp, 20, 'the bound opponent, not the author, receives damage');
assert.deepEqual(battle, battleBefore);
console.log('PASS whole literal claims: numeric/target/timing/count comparison, explicit unknown-language skips, nonmutating bounded traversal, effect-only finite model repair, unchanged siblings and anti-erasure recheck.');
console.log('PASS offline production CardSystem: immediate 5, next-turn-start 5, pending effect JSON restore, wrong phase and repeated dispatch do not fire, unchanged authored fixture.');
