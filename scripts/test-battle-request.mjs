import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const adapter = require(resolve('src/fish/core/battleContractAdapter.ts'));

const randomA = core.createBattleRandomState(12345);
const firstA = core.drawBattleRandom(randomA);
const secondA = core.drawBattleRandom(firstA.state);
const firstB = core.drawBattleRandom(core.createBattleRandomState(12345));
assert.equal(firstA.value, firstB.value);
assert.equal(firstA.state.cursor, 1);
assert.notEqual(firstA.value, secondA.value);
assert.throws(() => core.createBattleRandomState(-1));

let run = core.createRunState({ seed: 777 });
run = core.enterRunNode(run, run.choices[0].id);
const battle = {
  core: { emoji: '🧙', hp: 63, max_hp: 80, lust: 12, max_lust: 100 },
  level: 3,
  cards: [
    {
      id: 'strike',
      name: 'Strike',
      type: 'Attack',
      rarity: 'Common',
      cost: 1,
      quantity: 6,
      effects: [{ damage: 8 }],
    },
    { id: 'guard', name: 'Guard', type: 'Skill', rarity: 'Common', cost: 1, quantity: 4, effects: [{ block: 6 }] },
  ],
  artifacts: [{ id: 'star', name: 'Star', trigger: 'battle_start', effects: [{ block: 2 }] }],
  items: [{ id: 'tonic', name: 'Tonic', count: 2, effects: [{ heal: 10 }] }],
  statuses: [],
  player_abilities: [],
  player_status_effects: [],
  player_lust_effect: { name: 'Burst', effects: [{ damage: 8 }] },
  enemy: {
    name: 'Dummy',
    hp: 40,
    max_hp: 40,
    lust: 0,
    max_lust: 100,
    actions: [{ name: 'Hit', effects: [{ damage: 5 }] }],
  },
};
const variables = { stat_data: { run, battle } };
const request = adapter.createBattleRequestFromMvu(variables, battle);
assert.equal(request.content.cards.length, 2);
assert.equal(request.content.relics.length, 1);
assert.equal(request.route.nodeId, run.currentNode.id);
assert.equal(request.route.floorsPerAct, run.floorsPerAct);
assert.deepEqual(request.route.nodeCounts, run.nodeCounts);
assert.equal(request.player.level, 3);
assert.equal(request.seed, adapter.createBattleRequestFromMvu(variables, structuredClone(battle)).seed);
const otherRequest = core.createBattleRequest({
  content: request.content,
  player: request.player,
  route: { ...request.route, nodeId: `${request.route.nodeId}_other` },
  runSeed: run.seed,
});
assert.notEqual(request.seed, otherRequest.seed);

const runtime = adapter.battleRequestToRuntimeData(request);
assert.equal(runtime.cards.length, 2);
assert.equal(runtime.enemy.name, 'Dummy');
assert.equal(runtime.core.hp, 63);

const budget = core.summarizeBuildBudget(request.content, { hp: 63, maxHp: 80 });
assert.deepEqual(budget, { deck: 10, attack: 28, defense: 13, sustain: 0, draw: 0, energy: 0, hp: 63, maxHp: 80 });
assert.equal(core.formatBuildBudget(budget), 'deck=10 atk=28 def=13 heal=0 draw=0 energy=0 hp=63/80');
const enemyBudget = core.recommendEnemyBudget(budget, request.route.danger, request.route.act);
assert.deepEqual(enemyBudget, { hpMin: 42, hpMax: 84, hitMin: 5, hitMax: 13 });
assert.equal(core.formatEnemyBudget(enemyBudget), 'hp=42..84 hit=5..13');
assert.deepEqual(core.assessEnemyBudget(request, budget).warnings, []);

const lustPressureRequest = core.createBattleRequest({
  content: core.createContentPack({
    ...runtime,
    enemy: {
      ...runtime.enemy,
      actions: [{ name: '欲望注入', effects: [{ lust: 20 }] }],
    },
  }),
  player: request.player,
  route: request.route,
  runSeed: run.seed,
});
assert.deepEqual(
  core.assessEnemyBudget(lustPressureRequest, budget).warnings,
  [],
  'lust-only enemy actions count as pressure instead of being reported as risk-free',
);

const overflowPressureRequest = core.createBattleRequest({
  content: core.createContentPack({
    ...runtime,
    enemy: {
      ...runtime.enemy,
      actions: [{ name: '蓄力', effects: [{ block: 4 }] }],
      lust_effect: { name: '满溢反噬', effects: [{ damage: 8 }] },
    },
  }),
  player: request.player,
  route: request.route,
  runSeed: run.seed,
});
assert.deepEqual(
  core.assessEnemyBudget(overflowPressureRequest, budget).warnings,
  [],
  'enemy desire-overflow effects count as pressure even when regular actions are defensive',
);
const overtunedRequest = core.createBattleRequest({
  content: core.createContentPack({
    ...runtime,
    relics: runtime.artifacts,
    abilities: runtime.player_abilities,
    activeStatuses: runtime.player_status_effects,
    playerDesireEffect: runtime.player_lust_effect,
    enemy: { ...runtime.enemy, hp: 999, max_hp: 999, actions: [{ name: 'Delete', effects: [{ damage: 99 }] }] },
  }),
  player: request.player,
  route: request.route,
  runSeed: run.seed,
});
assert.equal(core.assessEnemyBudget(overtunedRequest, budget).warnings.length, 2);

const conditionalBurstRequest = core.createBattleRequest({
  content: core.createContentPack({
    ...runtime,
    enemy: {
      ...runtime.enemy,
      actions: [{ name: '低血爆发', effects: [{ damage: 'self.hp < self.max_hp / 2 ? 99 : 1' }] }],
    },
  }),
  player: request.player,
  route: request.route,
  runSeed: run.seed,
});
assert.match(
  core.assessEnemyBudget(conditionalBurstRequest, budget).warnings.join(' '),
  /单次估计伤害/,
  'dynamic enemy damage uses the shared scenario peak for diagnostics',
);

const result = core.createBattleResult({
  request,
  outcome: 'victory',
  player: { hp: 999, lust: -5 },
  items: [{ id: 'tonic', count: 1 }],
  turns: 7,
});
assert.deepEqual(result.player, { hp: 80, lust: 0 });
assert.deepEqual(result.route, { nodeId: run.currentNode.id, outcome: 'cleared' });
assert.deepEqual(result.items, [{ id: 'tonic', count: 1 }]);

console.log('ContentPack, BattleRequest/BattleResult, deterministic PRNG, and build budget passed.');
