import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  GAME_MODE_LOCK_SCHEMA_VERSION,
  createRunState,
  lockGameModeInStat,
  synchronizeGameModeInStat,
  normalizeGameMode,
  readGameMode,
  readGameModeLock,
} = require(resolve('src/game-core/index.ts'));

assert.equal(GAME_MODE_LOCK_SCHEMA_VERSION, 1);
assert.equal(normalizeGameMode('story'), 'story');
assert.equal(normalizeGameMode('tower'), 'tower');
assert.equal(normalizeGameMode('expedition'), null);
assert.equal(normalizeGameMode('unknown'), null);

const newStory = { game_mode: 'story', run: { invalid: true }, game_mode_lock: null };
assert.deepEqual(lockGameModeInStat(newStory, 'story'), { schemaVersion: 1, mode: 'story' });
assert.equal(newStory.run, null);
assert.equal(newStory.game_mode, 'story');

// Once locked, neither a retired mode nor any later text-derived request can change it.
newStory.game_mode = 'expedition';
lockGameModeInStat(newStory, 'tower');
assert.deepEqual(readGameModeLock(newStory), { schemaVersion: 1, mode: 'story' });
assert.equal(readGameMode(newStory), 'story');
assert.equal(newStory.game_mode, 'story');

const newTower = { game_mode: 'story', run: null, game_mode_lock: null };
assert.throws(() => lockGameModeInStat(newTower, 'expedition'), /unsupported/);
lockGameModeInStat(newTower, 'tower');
assert.deepEqual(newTower.game_mode_lock, { schemaVersion: 1, mode: 'tower' });
assert.equal(newTower.game_mode, 'tower');

const legacyRun = { game_mode: 'story', run: createRunState({ seed: 42 }) };
assert.equal(readGameMode(legacyRun), 'story', 'route content cannot override explicit current mode');
const legacyNamed = { game_mode: 'expedition', run: null };
const original = JSON.stringify(legacyNamed);
assert.throws(() => synchronizeGameModeInStat(legacyNamed), /旧版模式存档不受支持/);
assert.equal(JSON.stringify(legacyNamed), original, 'unsupported save remains untouched');

const oldStory = { run: null };
synchronizeGameModeInStat(oldStory);
assert.deepEqual(oldStory.game_mode_lock, { schemaVersion: 1, mode: 'story' });
assert.equal(oldStory.game_mode, 'story');

const invalidOldRun = { run: { schemaVersion: 999 }, game_mode: 'garbage' };
assert.equal(readGameMode(invalidOldRun), 'story');

const lockedStoryWithOldRun = {
  game_mode: 'tower',
  game_mode_lock: { schemaVersion: 1, mode: 'story' },
  run: createRunState({ seed: 7 }),
};
synchronizeGameModeInStat(lockedStoryWithOldRun);
assert.equal(lockedStoryWithOldRun.game_mode, 'story');
assert.equal(lockedStoryWithOldRun.run, null);

console.log(
  'Game mode selection is canonical, current-only, retired modes rejected without mutation, and permanently locked without chat-text inference.',
);
