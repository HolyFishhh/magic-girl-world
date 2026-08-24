import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

function readClassMethod(source, fileName, className, methodName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let method;

  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      method = node.members.find(
        member => ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === methodName,
      );
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  assert.ok(method, `${className}.${methodName} must exist`);
  return method.getText(file);
}

const executorPath = resolve('src/fish/combat/unifiedEffectExecutor.ts');
const executorSource = await readFile(executorPath, 'utf8');
const triggerHostPath = resolve('src/fish/core/battleTriggerHost.ts');
const source = await readFile(triggerHostPath, 'utf8');
const appPath = resolve('src/fish/index.ts');
const appSource = await readFile(appPath, 'utf8');
for (const target of ['player', 'enemy']) {
  for (const event of ['added', 'updated', 'removed']) {
    assert.match(appSource, new RegExp(`'${target}_status_${event}'`));
  }
}

assert.match(source, /new StatusLifecycleRuntime\(/);
assert.match(source, /dispatch: dispatches => this\.dispatch\(dispatches\)/);
assert.doesNotMatch(source, /resolveStatusOwnershipTriggerDispatch|processStatusOwnershipTriggers/);

const applyStatus = readClassMethod(source, triggerHostPath, 'TavernBattleTriggerHost', 'applyStatus');
assert.match(applyStatus, /this\.statusRuntime\.apply\(targetType, statusId, stacks\)/);
const removeStatuses = readClassMethod(source, triggerHostPath, 'TavernBattleTriggerHost', 'removeStatuses');
assert.match(removeStatuses, /this\.statusRuntime\.remove\(targetType, selection\)/);
const processTurnEnd = readClassMethod(
  source,
  triggerHostPath,
  'TavernBattleTriggerHost',
  'processStatusEffectsAtTurnEnd',
);
assert.match(processTurnEnd, /this\.statusRuntime\.processTurnEnd\(targetType\)/);
assert.doesNotMatch(
  source,
  /resolveStatusApplication|resolveStatusStacksChange|executeStatusTriggerTransaction|applyStatusStacksDecay|clearDirectModifiers|substituteLegacyStacks/,
);

const executorApplyStatus = readClassMethod(executorSource, executorPath, 'UnifiedEffectExecutor', 'applyStatusEffect');
assert.match(executorApplyStatus, /this\.triggerHost\.applyStatus\(targetType, statusId, stacks\)/);
const executorRemoveStatus = readClassMethod(
  executorSource,
  executorPath,
  'UnifiedEffectExecutor',
  'removeStatusEffect',
);
assert.match(executorRemoveStatus, /this\.triggerHost\.removeStatuses\(targetType, statusId\)/);
assert.doesNotMatch(executorSource, /processStatusOwnershipAbilityTriggers|applyStatusStacksDecay/);

console.log('Status gain/loss abilities are wired for holders and their opponents.');
