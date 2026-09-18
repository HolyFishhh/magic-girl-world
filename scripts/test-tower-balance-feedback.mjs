import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  assertTowerBalanceFeedbackPreservation,
  TowerBalanceFeedbackPreservationError,
} = require(resolve('src/runtime/towerBalanceFeedback.ts'));

const enemy = (id, name) => ({
  id, name, emoji: '👾', description: `${name}守在旧塔入口。`, dialogue: '它记得这条道路。', description_meta: { chapter: 2 },
  hp: 48, max_hp: 48, lust: 0, max_lust: 100, block: 0,
  actions: [{ id: 'hit', name: '挥击', weight: 1, effects: { damage: 7 } }],
  abilities: [], status_effects: [], resources: { rage: { current: 1, max: 5 } },
  action_mode: 'random', action_config: {},
  defeat_reward: { gold: 19, artifact: ['old_key'] },
});

const original = {
  core: { emoji: '✨', hp: 32, max_hp: 40, resources: [{ id: 'mana', current: 2, max: 3 }] },
  cards: [{ id: 'strike', name: '星火斩', effects: { damage: 6 } }],
  statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
  enemies: [enemy('gate_guard', '门卫'), enemy('roof_guard', '屋顶守卫')],
};
const originalSnapshot = structuredClone(original);

const legal = structuredClone(original);
legal.enemies[0].hp = 60;
legal.enemies[0].max_hp = 60;
legal.enemies[0].actions = [{ id: 'heavy_hit', name: '重击', weight: 2, effects: { damage: 11 } }];
legal.enemies[0].abilities = [{ id: 'ward', trigger: 'turn_start', effects: { block: 3 } }];
legal.enemies[0].status_effects = [{ id: 'armored', stacks: 2 }];
legal.enemies[0].resources.rage.current = 4;
delete legal.enemies[0].resources;
legal.enemies[0].escape_when = 'self.hp < 5';
assert.doesNotThrow(() => assertTowerBalanceFeedbackPreservation(original, legal));
assert.deepEqual(original, originalSnapshot, 'the preservation helper must never mutate the original battle');

function rejects(label, mutate, expectedPath) {
  const candidate = structuredClone(original);
  mutate(candidate);
  const candidateSnapshot = structuredClone(candidate);
  assert.throws(
    () => assertTowerBalanceFeedbackPreservation(original, candidate),
    error => error instanceof TowerBalanceFeedbackPreservationError && error.path === expectedPath,
    label,
  );
  assert.deepEqual(original, originalSnapshot, `${label} must not mutate the original input`);
  assert.deepEqual(candidate, candidateSnapshot, `${label} must not mutate the candidate input`);
}

rejects('enemy id changes are rejected', candidate => { candidate.enemies[0].id = 'different_guard'; }, 'battle.enemies[0].id');
rejects('enemy name changes are rejected', candidate => { candidate.enemies[0].name = '改名守卫'; }, 'battle.enemies[0].name');
rejects('enemy story changes are rejected', candidate => { candidate.enemies[0].description = '改写了剧情。'; }, 'battle.enemies[0].description');
rejects('enemy story metadata numbers remain frozen', candidate => { candidate.enemies[0].description_meta.chapter = 3; }, 'battle.enemies[0].description_meta.chapter');
rejects('enemy defeat reward changes are rejected', candidate => { candidate.enemies[0].defeat_reward.gold = 99; }, 'battle.enemies[0].defeat_reward.gold');
rejects('player/shared fields are rejected', candidate => { candidate.core.hp = 1; }, 'battle.core.hp');
rejects('empty shared fields use structural preservation too', candidate => { candidate.statuses.push({ id: 'invented' }); }, 'battle.statuses');
rejects('enemy roster size changes are rejected', candidate => { candidate.enemies.pop(); }, 'battle.enemies');
rejects('enemy order changes are rejected', candidate => { candidate.enemies.reverse(); }, 'battle.enemies[0].id');

console.log('Tower balance feedback preserves the full player/shared battle and enemy story/loot/roster while allowing enemy numbers and executable mechanics.');
