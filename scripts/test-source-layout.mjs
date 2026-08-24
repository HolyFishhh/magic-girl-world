import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const allowedDirectories = ['adapters', 'common', 'fish', 'game-core', 'portable', 'runtime', 'start'];
const actualDirectories = (await readdir(resolve('src'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

assert.deepEqual(
  actualDirectories,
  allowedDirectories,
  `Unexpected source trees must be integrated or removed: ${actualDirectories.join(', ')}`,
);
console.log('Source layout contains only the seven production and portable ownership roots.');
