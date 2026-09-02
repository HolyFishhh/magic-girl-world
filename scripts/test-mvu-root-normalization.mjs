import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { normalizeLatestMvuRoot } = require(resolve('src/sillytavern-extension/controller.ts'));

const direct = {
  initialized_lorebooks: {},
  stat_data: { game_mode_lock: { schemaVersion: 1, mode: 'tower' } },
};

assert.equal(normalizeLatestMvuRoot(direct), direct);
assert.equal(normalizeLatestMvuRoot([direct]), direct);
assert.equal(normalizeLatestMvuRoot({ 0: direct }), direct);
assert.equal(normalizeLatestMvuRoot({ 0: [direct] }), direct);
assert.equal(normalizeLatestMvuRoot({ 0: direct, 1: direct }), null);
assert.equal(normalizeLatestMvuRoot({ stat_data: null }), null);
assert.equal(normalizeLatestMvuRoot([]), null);

console.log('MVU root normalization tests passed.');
