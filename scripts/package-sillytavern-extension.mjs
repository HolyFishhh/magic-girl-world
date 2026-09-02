import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const parent = path.join(root, 'dist', 'sillytavern-extension');
const folderName = 'magic-girl-design-assistant';
const source = path.join(parent, folderName);
const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
const version = String(manifest.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`扩展版本无效：${version || '空'}`);

for (const file of ['index.js', 'design-worker.js', 'index.css', 'manifest.json']) {
  const stat = await fs.stat(path.join(source, file));
  if (!stat.isFile() || stat.size === 0) throw new Error(`扩展发布文件缺失：${file}`);
}

const releaseDir = path.join(root, 'dist', 'release');
await fs.mkdir(releaseDir, { recursive: true });
const archive = path.join(releaseDir, `${folderName}-${version}.zip`);
await fs.rm(archive, { force: true });
const packed = spawnSync('tar', ['-a', '-cf', archive, '-C', parent, folderName], {
  cwd: root,
  encoding: 'utf8',
});
if (packed.status !== 0) {
  throw new Error(`扩展压缩失败：${packed.stderr || packed.stdout || `exit ${packed.status}`}`);
}
const bytes = await fs.readFile(archive);
if (bytes.length < 1024) throw new Error('扩展压缩包异常过小');
const sha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase();
await fs.writeFile(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`, 'utf8');

console.log(`SillyTavern extension package: ${archive}`);
console.log(`SHA-256: ${sha256}`);
