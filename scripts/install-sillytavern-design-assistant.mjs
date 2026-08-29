import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const argumentIndex = process.argv.indexOf('--tavern');
const tavernRoot = path.resolve(
  argumentIndex >= 0 && process.argv[argumentIndex + 1]
    ? process.argv[argumentIndex + 1]
    : path.join(root, '..', '_codex-tavern-e2e'),
);
const publicRoot = path.resolve(tavernRoot, 'public');
const source = path.resolve(root, 'dist', 'sillytavern-extension', 'magic-girl-design-assistant');
const destination = path.resolve(
  publicRoot,
  'scripts',
  'extensions',
  'third-party',
  'magic-girl-design-assistant',
);

if (!destination.startsWith(`${publicRoot}${path.sep}`)) {
  throw new Error(`拒绝安装到 SillyTavern public 目录以外：${destination}`);
}
await fs.access(path.join(publicRoot, 'script.js'));
await fs.access(path.join(source, 'manifest.json'));
await fs.mkdir(destination, { recursive: true });
for (const file of await fs.readdir(source)) {
  const stat = await fs.stat(path.join(source, file));
  if (stat.isFile()) await fs.copyFile(path.join(source, file), path.join(destination, file));
}

console.log(`SillyTavern extension installed: ${destination}`);
