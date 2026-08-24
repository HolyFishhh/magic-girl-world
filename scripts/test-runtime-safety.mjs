import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const sourceRoots = ['src/common', 'src/fish', 'src/runtime', 'src/start', 'src/game-core', 'src/adapters', 'src/portable'].map(path =>
  resolve(path),
);
const executableExtensions = new Set(['.js', '.mjs', '.ts', '.tsx']);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (executableExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const violations = [];
for (const root of sourceRoots) {
  for (const file of await collectFiles(root)) {
    const source = await readFile(file, 'utf8');
    if (/\bnew\s+Function\s*\(/.test(source)) violations.push(`${relative(process.cwd(), file)}: new Function`);
    if (/\beval\s*\(/.test(source)) violations.push(`${relative(process.cwd(), file)}: eval`);
  }
}

assert.deepEqual(violations, [], `Dynamic code execution is forbidden:\n${violations.join('\n')}`);
console.log('Runtime source contains no dynamic code execution.');
