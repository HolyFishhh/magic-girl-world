import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createTowerEncounterPlan, TOWER_ENEMY_COUNT_WEIGHTS, TOWER_COUNTER_STRATEGY_CHANCE } = require('../src/game-core/towerEncounterPlan.ts');
const tower = require('../src/game-core/towerRequest.ts');
const { recommendTowerBattleRewardBudget } = require('../src/game-core/contentBudget.ts');
const job = { nodeId: 'count_fixture', requestId: 'count_request', basedOnRevision: 3, kind: 'battle', act: 1, floor: 4, contentSeed: 89, rewardSeed: 11, difficultyMultiplier: 1 };
const plan = createTowerEncounterPlan(job);
assert.ok(plan.enemyCount >= 1 && plan.enemyCount <= 5);
assert.deepEqual(createTowerEncounterPlan({ ...job, requestId: 'repair', basedOnRevision: 90 }), plan);
assert.deepEqual(createTowerEncounterPlan(JSON.parse(JSON.stringify(job))), plan);
assert.equal(createTowerEncounterPlan({ ...job, kind: 'event' }), undefined);
assert.equal(createTowerEncounterPlan({ ...job, contentSeed: undefined }), undefined, 'legacy saved snapshots remain readable');
for (const kind of ['battle', 'elite', 'boss']) {
  const bins = [0, 0, 0, 0, 0];
  let counterStrategies = 0;
  for (let seed = 0; seed < 20000; seed++) bins[createTowerEncounterPlan({ ...job, kind, contentSeed: seed }).enemyCount - 1]++;
  for (let seed = 0; seed < 20000; seed++) counterStrategies += Number(createTowerEncounterPlan({ ...job, kind, contentSeed: seed }).counterStrategy);
  bins.forEach((value, index) => assert.ok(Math.abs(value / 200 - TOWER_ENEMY_COUNT_WEIGHTS[kind][index]) < 1.5, `${kind}: ${bins}`));
  assert.ok(Math.abs(counterStrategies / 200 - TOWER_COUNTER_STRATEGY_CHANCE[kind]) < 1.5, `${kind}: ${counterStrategies}`);
}
const schema = tower.createTowerNodeJsonSchema(job.kind, job).value.properties.payload.properties.battle;
assert.equal(schema.properties.enemies.minItems, plan.enemyCount);
assert.equal(schema.properties.enemies.maxItems, plan.enemyCount);
assert.equal(schema.properties.enemy, undefined);
assert.deepEqual(schema.required, ['enemies']);
const prompt = tower.formatTowerNodeGenerationPrompt(job, { difficultyPercent: 80 });
assert.ok(prompt.includes(`必须恰好 ${plan.enemyCount} 名`));
assert.ok(prompt.includes('软克制思考'));
assert.doesNotMatch(prompt, /普通遭遇优先2至3|普通战斗优先考虑2至3/);
const budget = recommendTowerBattleRewardBudget(job);
const candidates = (kind, amount) => Array.from({ length: amount }, (_, index) => kind === 'card'
  ? { id: `c_${index}`, name: `奖励${index}`, type: 'Attack', rarity: budget.cards.slotRarities[index], cost: 1, effects: { damage: 6 } }
  : { id: `${kind}_${index}`, name: `奖励${index}`, effects: { heal: 3 } });
const reward = { card: candidates('card', 3), artifact: candidates('artifact', budget.artifacts?.candidates || 0), item: candidates('item', budget.items?.candidates || 0), limits: { cards: 1, artifacts: budget.artifacts?.pick || 0, items: budget.items?.pick || 0 } };
const value = { spec: tower.TOWER_NODE_RESULT_SPEC, node_id: job.nodeId, request_id: job.requestId, based_on_revision: job.basedOnRevision,
  kind: job.kind, title: '数量验证', narrative: '道路前方出现了敌人。', reward,
  payload: { battle: { enemies: Array.from({ length: plan.enemyCount }, (_, index) => ({ id: `enemy_${index}`, name: `敌人${index}`, hp: 20, max_hp: 20, lust: 0, max_lust: 100, actions: [{ name: '攻击', effects: { damage: 4 } }] })) } } };
assert.equal(tower.parseTowerNodeResult(JSON.stringify(value), job).payload.battle.enemies.length, plan.enemyCount);
const wrong = structuredClone(value);
wrong.payload.battle.enemies.push({ ...wrong.payload.battle.enemies[0], id: 'excess' });
assert.throws(() => tower.parseTowerNodeResult(JSON.stringify(wrong), job), /必须恰好/);
const old = structuredClone(value); old.payload.battle.enemy = old.payload.battle.enemies[0]; delete old.payload.battle.enemies;
assert.throws(() => tower.parseTowerNodeResult(JSON.stringify(old), job), /必须恰好/);
assert.equal(tower.parseTowerNodeResult(JSON.stringify(old), { ...job, contentSeed: undefined }).title, value.title);
console.log('Tower encounter plan: 1–5 weights, deterministic retries/save, exact prompt/schema/parser and explicit legacy compatibility verified.');
