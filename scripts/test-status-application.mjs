import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = await readFile(resolve('src/game-core/statusApplication.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const status = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

assert.deepEqual(status.resolveStatusApplication(undefined, 2), { nextStacks: 2, trigger: 'apply' });
assert.deepEqual(status.resolveStatusApplication(2, 1), { nextStacks: 3, trigger: 'stack' });
assert.deepEqual(status.resolveStatusApplication(2, 5, 4), { nextStacks: 4, trigger: 'stack' });
assert.deepEqual(status.resolveStatusApplication(2, 0, 4), { nextStacks: 2, trigger: null });
assert.deepEqual(status.resolveStatusApplication(undefined, 0), { nextStacks: 0, trigger: null });
assert.deepEqual(status.resolveStatusApplication(2, Number.NaN), { nextStacks: 2, trigger: null });
assert.equal(status.resolveStatusStacksChange(5, -1), 4);
assert.equal(status.resolveStatusStacksChange(5, 2), 7);
assert.equal(status.resolveStatusStacksChange(5, 'x0.5'), 2);
assert.equal(status.resolveStatusStacksChange(5, 'reset'), 0);
assert.equal(status.resolveStatusStacksChange(5, 'keep'), 5);
assert.equal(status.resolveStatusStacksChange(5, 'xnope'), 5);

console.log('Status application and stack trigger contract passed.');
