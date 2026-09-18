import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const argumentIndex = process.argv.indexOf('--tavern');
const tavernRoot = path.resolve(
  argumentIndex >= 0 && process.argv[argumentIndex + 1]
    ? process.argv[argumentIndex + 1]
    : path.join(root, '..', '_codex-tavern-e2e'),
);
const publicRoot = path.resolve(tavernRoot, 'public');
const sourceIndex = process.argv.indexOf('--source');
const source = sourceIndex >= 0 && process.argv[sourceIndex + 1]
  ? path.resolve(process.argv[sourceIndex + 1])
  : path.resolve(root, 'dist', 'sillytavern-extension', 'magic-girl-design-assistant');
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
const files = ['index.js', 'design-worker.js', 'encounter-worker.js', 'index.css', 'manifest.json'];
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceContents = new Map();
for (const file of files) {
  const content = await fs.readFile(path.join(source, file));
  if (!content.length) throw new Error(`拒绝安装空产物：${file}`);
  sourceContents.set(file, content);
}
const manifest = JSON.parse(sourceContents.get('manifest.json').toString('utf8'));
if (manifest.js !== 'index.js' || manifest.css !== 'index.css'
  || !manifest.dependencies?.includes('third-party/JS-Slash-Runner')) throw new Error('安装源不是受支持的设计辅助器产物');
await fs.mkdir(destination, { recursive: true });
const realPublic = await fs.realpath(publicRoot);
const realDestination = await fs.realpath(destination);
if (!realDestination.startsWith(`${realPublic}${path.sep}`) || realDestination === await fs.realpath(source)) {
  throw new Error('拒绝经链接写入 public 以外或覆盖安装源自身');
}
const backupRoot = path.join(root, 'tmp', 'tavern-extension-backups');
await fs.mkdir(backupRoot, { recursive: true });
const backup = path.join(backupRoot, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
await fs.mkdir(backup);
const previous = new Map();
for (const file of files) {
  try {
    if ((await fs.lstat(path.join(destination, file))).isSymbolicLink()) throw new Error(`拒绝覆盖符号链接产物：${file}`);
    previous.set(file, await fs.readFile(path.join(destination, file)));
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const [file, content] of previous) await fs.writeFile(path.join(backup, file), content, { flag: 'wx' });
await fs.writeFile(path.join(backup, 'restore.json'), JSON.stringify({
  spec: 'mwg.extension-install-backup/v1', destination: realDestination, source,
  createdAt: new Date().toISOString(),
  files: files.map(file => ({ file, before: previous.has(file) ? hash(previous.get(file)) : null, after: hash(sourceContents.get(file)) })),
}, null, 2), { flag: 'wx' });
try {
  for (const [file, content] of sourceContents) {
    await fs.writeFile(path.join(realDestination, file), content);
    if (hash(await fs.readFile(path.join(realDestination, file))) !== hash(content)) throw new Error(`安装后校验失败：${file}`);
  }
} catch (error) {
  // Only the explicitly resolved artifact files can be restored/removed.
  // No recursive deletion, directory replacement, or chat data is involved.
  for (const file of files) {
    if (previous.has(file)) await fs.writeFile(path.join(realDestination, file), previous.get(file));
    else await fs.rm(path.join(realDestination, file), { force: true });
  }
  throw new Error(`安装失败，已还原原有产物。回滚副本：${backup}`, { cause: error });
}

console.log(JSON.stringify({ installed: realDestination, backup, files: files.map(file => ({ file, sha256: hash(sourceContents.get(file)) })) }, null, 2));
