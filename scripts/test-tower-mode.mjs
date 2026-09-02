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
  migrateGameModeInStat,
  normalizeGameMode,
  readGameMode,
  readGameModeLock,
} = require(resolve('src/game-core/index.ts'));

assert.equal(GAME_MODE_LOCK_SCHEMA_VERSION, 1);
assert.equal(normalizeGameMode('story'), 'story');
assert.equal(normalizeGameMode('tower'), 'tower');
assert.equal(normalizeGameMode('expedition'), 'tower');
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
lockGameModeInStat(newTower, 'expedition');
assert.deepEqual(newTower.game_mode_lock, { schemaVersion: 1, mode: 'tower' });
assert.equal(newTower.game_mode, 'tower');

const legacyRun = { game_mode: 'story', run: createRunState({ seed: 42 }) };
assert.equal(readGameMode(legacyRun), 'tower');
migrateGameModeInStat(legacyRun);
assert.deepEqual(legacyRun.game_mode_lock, { schemaVersion: 1, mode: 'tower' });
assert.equal(legacyRun.game_mode, 'tower');

const legacyNamed = { game_mode: 'expedition', run: null };
migrateGameModeInStat(legacyNamed);
assert.deepEqual(legacyNamed.game_mode_lock, { schemaVersion: 1, mode: 'tower' });

const oldStory = { run: null };
migrateGameModeInStat(oldStory);
assert.deepEqual(oldStory.game_mode_lock, { schemaVersion: 1, mode: 'story' });
assert.equal(oldStory.game_mode, 'story');

const invalidOldRun = { run: { schemaVersion: 999 }, game_mode: 'garbage' };
assert.equal(readGameMode(invalidOldRun), 'story');

const lockedStoryWithOldRun = {
  game_mode: 'tower',
  game_mode_lock: { schemaVersion: 1, mode: 'story' },
  run: createRunState({ seed: 7 }),
};
migrateGameModeInStat(lockedStoryWithOldRun);
assert.equal(lockedStoryWithOldRun.game_mode, 'story');
assert.equal(lockedStoryWithOldRun.run, null);

console.log(
  'Game mode selection is canonical, legacy-compatible, migrated once, and permanently locked without chat-text inference.',
);
