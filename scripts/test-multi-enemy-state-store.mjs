import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const enemy = (id, hp = 10) => ({
  id, name: id, maxHp: 10, currentHp: hp, maxLust: 100, currentLust: 0, energy: 0, maxEnergy: 0,
  block: 0, statusEffects: [], intent: { type: 'attack', description: '', emoji: '' }, emoji: '', actions: [],
  nextAction: null, dialogue: '',
});

const legacy = core.createEmptyBattleState();
legacy.enemy = enemy('legacy');
delete legacy.enemies;
delete legacy.activeEnemyId;
const migrated = new core.BattleStateStore(legacy);
assert.deepEqual(migrated.getEnemies().map(value => value.id), ['legacy']);
assert.equal(migrated.getEnemy().id, 'legacy');

const store = new core.BattleStateStore();
store.setEnemies([enemy('front', 8), enemy('back', 10)], 'back');
assert.equal(store.getEnemy().id, 'back');
assert.equal(store.getGameState().activeEnemyId, 'back');
store.updateEnemy({ block: 5 });
assert.equal(store.getEnemyById('back').block, 5);
assert.equal(store.getEnemyById('front').block, 0);
store.updateEnemyById('front', { currentHp: 0 });
assert.equal(store.getEnemies().length, 2, 'death and removal are separate observable phases');
assert.deepEqual(store.removeDefeatedEnemies().map(value => value.id), ['front']);
assert.deepEqual(store.getEnemies().map(value => value.id), ['back']);

store.setEnemies([enemy('first', 4), enemy('second', 6)], 'first');
store.createSnapshot('before');
store.updateEnemyById('first', { currentHp: 0 });
assert.equal(store.getEnemy().id, 'second', 'legacy alias advances to the next living enemy');
assert.equal(store.restoreSnapshot('before'), true);
assert.equal(store.getEnemy().id, 'first');
assert.equal(store.getEnemyById('first').currentHp, 4);

const serialized = JSON.parse(JSON.stringify(store.getGameState()));
const restored = new core.BattleStateStore(serialized);
assert.deepEqual(restored.getEnemies().map(value => value.id), ['first', 'second']);
assert.equal(restored.getEnemy().id, 'first');
assert.throws(() => store.setEnemies([enemy('x'), enemy('x')]), /unique/);
console.log('Multi-enemy state store migrates legacy saves and synchronizes active aliases, updates, death phases, snapshots, and restore.');
