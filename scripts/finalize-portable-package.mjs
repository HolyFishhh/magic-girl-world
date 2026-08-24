import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/portable');
const release = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const artifactNames = ['magic-girl-core.mjs', 'card-backend.mjs', 'battle-backend.mjs'];

const artifacts = [];
for (const name of artifactNames) {
  const file = resolve(output, name);
  const bytes = (await stat(file)).size;
  const sha256 = createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase();
  artifacts.push({ name, bytes, sha256 });
}

const packageJson = {
  name: '@magic-girl-world/portable-core',
  version: release.cardVersion,
  type: 'module',
  sideEffects: false,
  exports: {
    '.': { types: './types/portable/index.d.ts', import: './magic-girl-core.mjs' },
    './card': { types: './types/portable/cardBackend.d.ts', import: './card-backend.mjs' },
    './battle': { types: './types/portable/battleBackend.d.ts', import: './battle-backend.mjs' },
  },
};
const manifest = { schemaVersion: 1, version: release.cardVersion, artifacts };

await writeFile(resolve(output, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Portable core ${release.cardVersion}: ${artifacts.map(item => `${item.name}=${item.bytes}`).join(', ')}`);
