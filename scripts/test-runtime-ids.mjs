import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

const path = resolve('src/game-core/runtimeIds.ts');
const source = await readFile(path, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ids = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

assert.equal(ids.allocateRuntimeId('strike', new Set()), 'strike__1');
assert.equal(ids.allocateRuntimeId('strike', new Set(['strike__1', 'strike__2'])), 'strike__3');
assert.equal(ids.allocateRuntimeId('  nested card  ', new Set()), 'nested_card__1');
assert.equal(ids.allocateRuntimeId('', new Set()), 'card__1');

console.log('Runtime IDs are deterministic, readable, and collision-free without host globals.');
