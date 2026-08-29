import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const source = path.join(root, 'sillytavern-extension', 'manifest.json');
const output = path.join(root, 'dist', 'sillytavern-extension', 'magic-girl-design-assistant');

await fs.mkdir(output, { recursive: true });
await fs.copyFile(source, path.join(output, 'manifest.json'));

const required = ['index.js', 'design-worker.js', 'index.css', 'manifest.json'];
for (const file of required) {
  const stat = await fs.stat(path.join(output, file));
  if (!stat.isFile() || stat.size === 0) throw new Error(`扩展构建产物无效：${file}`);
}

console.log(`SillyTavern extension finalized: ${output}`);
