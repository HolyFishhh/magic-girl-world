import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mwg-extension-install-'));
const source = path.join(root, 'source');
const tavern = path.join(root, 'tavern');
const destination = path.join(tavern, 'public/scripts/extensions/third-party/magic-girl-design-assistant');
await fs.mkdir(source, { recursive: true });
await fs.mkdir(destination, { recursive: true });
await fs.writeFile(path.join(tavern, 'public/script.js'), '// fixture');
const manifest = { js: 'index.js', css: 'index.css', dependencies: ['third-party/JS-Slash-Runner'] };
for (const file of ['index.js', 'design-worker.js', 'encounter-worker.js', 'index.css', 'manifest.json']) {
  await fs.writeFile(path.join(source, file), file === 'manifest.json' ? JSON.stringify(manifest) : `new ${file}`);
  if (file !== 'encounter-worker.js') await fs.writeFile(path.join(destination, file), `original ${file}`);
}
await fs.writeFile(path.join(destination, 'unrelated.txt'), 'preserved');
const run = () => spawnSync(process.execPath, ['scripts/install-sillytavern-design-assistant.mjs', '--tavern', tavern, '--source', source], { encoding: 'utf8' });
const installed = run();
assert.equal(installed.status, 0, installed.stderr);
const result = JSON.parse(installed.stdout);
for (const file of ['index.js', 'design-worker.js', 'index.css', 'manifest.json']) {
  assert.equal(await fs.readFile(path.join(result.backup, file), 'utf8'), `original ${file}`);
  assert.deepEqual(await fs.readFile(path.join(destination, file)), await fs.readFile(path.join(source, file)));
}
assert.deepEqual(await fs.readFile(path.join(destination, 'encounter-worker.js')), await fs.readFile(path.join(source, 'encounter-worker.js')));
assert.equal(await fs.readFile(path.join(destination, 'unrelated.txt'), 'utf8'), 'preserved');
const before = await fs.readFile(path.join(destination, 'index.js'));
await fs.writeFile(path.join(source, 'design-worker.js'), '');
const rejected = run();
assert.notEqual(rejected.status, 0);
assert.deepEqual(await fs.readFile(path.join(destination, 'index.js')), before, 'incomplete source is rejected before overwriting any artifact');
assert.equal(JSON.parse(await fs.readFile(path.join(result.backup, 'restore.json'), 'utf8')).files.length, 5);
console.log('Extension installation validates all artifacts, backs up originals, verifies copies and preserves unrelated files.');
