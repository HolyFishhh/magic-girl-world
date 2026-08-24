import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const roots = [
  { path: resolve('src/game-core'), allowed: /^\.\//, packages: new Set(['jsep']) },
  { path: resolve('src/adapters'), allowed: /^(?:\.\/|\.\.\/game-core(?:\/|$))/, packages: new Set() },
  { path: resolve('src/portable'), allowed: /^\.\.?\/(?:game-core|adapters|portable)(?:\/|$)|^\.\//, packages: new Set() },
];

async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await collect(path)));
    else if (extname(entry.name) === '.ts') result.push(path);
  }
  return result;
}

const violations = [];
for (const root of roots) {
  for (const file of await collect(root.path)) {
    const source = await readFile(file, 'utf8');
    const label = relative(process.cwd(), file);
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const request = match[1];
      if (!root.allowed.test(request) && !root.packages.has(request)) violations.push(`${label}: import ${request}`);
      if (/(?:^|\/)(?:fish|runtime|common|start)(?:\/|$)/.test(request)) violations.push(`${label}: host import ${request}`);
    }
    for (const [name, pattern] of [
      ['DOM global', /\b(?:document|window|localStorage|globalThis)\s*[.([]/],
      ['wall clock', /\bDate\.now\s*\(/],
      ['global random', /\bMath\.random\s*\(/],
      ['dynamic function', /\bnew\s+Function\s*\(/],
      ['eval', /\beval\s*\(/],
      ['MUV schema marker', /\$__META_EXTENSIBLE__\$/],
    ]) {
      if (pattern.test(source)) violations.push(`${label}: ${name}`);
    }
  }
}

assert.deepEqual(violations, [], `Portable boundary violations:\n${violations.join('\n')}`);

function runtimeModuleRequests(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const requests = [];
  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (
        clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every(element => element.isTypeOnly)
      ) {
        continue;
      }
      requests.push(statement.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.isTypeOnly) continue;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        if (statement.exportClause.elements.every(element => element.isTypeOnly)) continue;
      }
      requests.push(statement.moduleSpecifier.text);
    }
  }
  return requests;
}

async function resolveLocalModule(importer, request) {
  if (!request.startsWith('.')) return null;
  const candidate = resolve(dirname(importer), request);
  for (const path of [`${candidate}.ts`, join(candidate, 'index.ts')]) {
    try {
      await readFile(path, 'utf8');
      return path;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Cannot resolve ${request} from ${relative(process.cwd(), importer)}`);
}

async function runtimeClosure(entry) {
  const pending = [resolve(entry)];
  const visited = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    for (const request of runtimeModuleRequests(source, file)) {
      const dependency = await resolveLocalModule(file, request);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }
  return visited;
}

const cardClosure = await runtimeClosure('src/portable/cardBackend.ts');
const battleClosure = await runtimeClosure('src/portable/battleBackend.ts');
const battleOnlyModules = new Set([
  'battleContract.ts',
  'battleSnapshot.ts',
  'battleState.ts',
  'battleEffectRuntime.ts',
  'battleEventDispatch.ts',
  'battleTriggerRuntime.ts',
  'battleSessionCoordinator.ts',
  'battleOutcome.ts',
  'battleTerminal.ts',
  'battleEndPrompt.ts',
  'statusLifecycleRuntime.ts',
  'enemyActionSelector.ts',
  'turnState.ts',
  'battleTurnFlow.ts',
  'triggerDefinitionRuntime.ts',
  'triggerTransaction.ts',
  'referenceBattleRuntimeHost.ts',
  'referenceBattleSessionHost.ts',
]);
const cardBattleLeaks = [...cardClosure]
  .filter(path => battleOnlyModules.has(path.split(/[\\/]/).at(-1)))
  .map(path => relative(process.cwd(), path));
assert.deepEqual(cardBattleLeaks, [], `Card backend imported battle-only runtime modules:\n${cardBattleLeaks.join('\n')}`);
assert.ok(
  [...cardClosure].every(path => /src[\\/](?:portable|game-core)[\\/]/.test(path)),
  'card backend runtime closure must stay inside portable/game-core',
);
for (const cardModule of cardClosure) {
  assert.ok(battleClosure.has(cardModule), `battle backend must reuse the card backend module ${relative(process.cwd(), cardModule)}`);
}
assert.ok(
  [...battleClosure].some(path => path.endsWith(`${join('adapters', 'referenceBattleRuntimeHost.ts')}`)),
  'battle backend must expose the reference host adapter',
);

console.log(
  `Portable boundaries passed: card=${cardClosure.size} runtime modules, battle=${battleClosure.size}; no host globals or reverse dependency.`,
);
