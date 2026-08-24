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

const relicPath = resolve('src/fish/core/relicTriggerHost.ts');
const relicSource = await readFile(relicPath, 'utf8');
const triggerRelics = readClassMethod(relicSource, relicPath, 'TavernRelicTriggerHost', 'triggerRelics');
assert.match(relicSource, /new RelicTriggerRuntime\(/);
assert.match(triggerRelics, /this\.runtime\.run\(trigger, context\)/);
assert.doesNotMatch(relicSource, /activeTriggers|getTriggeredEffectSegments|hasTriggeredEffect/);

assert.doesNotMatch(relicSource, /public async triggerOn[A-Z]/);
assert.doesNotMatch(relicSource, /UnifiedEffectExecutor|from ['"]\.\.\/combat\/unifiedEffectExecutor/);

const executorPath = resolve('src/fish/combat/unifiedEffectExecutor.ts');
const executorSource = await readFile(executorPath, 'utf8');
const triggerHostPath = resolve('src/fish/core/battleTriggerHost.ts');
const triggerHostSource = await readFile(triggerHostPath, 'utf8');
const dispatchBattleTriggers = readClassMethod(
  executorSource,
  executorPath,
  'UnifiedEffectExecutor',
  'dispatchBattleTriggers',
);
assert.match(dispatchBattleTriggers, /this\.triggerHost\.dispatch\(dispatches\)/);
const hostDispatch = readClassMethod(triggerHostSource, triggerHostPath, 'TavernBattleTriggerHost', 'dispatch');
assert.match(hostDispatch, /runBattleTriggerDispatches\(dispatches/);
assert.match(hostDispatch, /processAbilitiesByTrigger\(target, trigger, context\)/);
assert.match(hostDispatch, /ports\.runRelic\(trigger, context\)/);
assert.match(executorSource, /relicTriggerHost\.triggerRelics\(trigger/);

const basicAttribute = readClassMethod(
  executorSource,
  executorPath,
  'UnifiedEffectExecutor',
  'executeBasicAttributeEffect',
);
assert.match(basicAttribute, /resolveAttributeTriggerDispatch\(\{/);
assert.match(basicAttribute, /change: -absorption\.blockUsed/);
assert.match(
  basicAttribute,
  /dispatchBattleTriggers\([\s\S]*entity = this\.getEntity\(targetType\)[\s\S]*currentValue = this\.getCurrentAttributeValue\(entity, attribute\)[\s\S]*modifiedValue = absorption\.damage/,
);
assert.ok(
  basicAttribute.indexOf('currentValue = this.getCurrentAttributeValue(entity, attribute)', 500) <
    basicAttribute.indexOf('const newValue = applyNumericOperator(currentValue, operator, modifiedValue)'),
  'damage must use the HP baseline after block-loss triggers finish',
);

const appPath = resolve('src/fish/index.ts');
const appSource = await readFile(appPath, 'utf8');
const initializeTriggers = readClassMethod(appSource, appPath, 'FishRPGCoordinator', 'triggerBattleStartEffects');
const executeInitializationStep = readClassMethod(
  appSource,
  appPath,
  'FishRPGCoordinator',
  'executeBattleStartFlowStep',
);
assert.match(initializeTriggers, /await startBattleSession\(\{/);
assert.match(initializeTriggers, /gate: this\.sessionHost\.gate/);
assert.match(initializeTriggers, /executeStartStep: step => this\.executeBattleStartFlowStep\(step\)/);
assert.match(executeInitializationStep, /triggerRelics\('ability_gain', \{ initial: true \}\)/);
assert.match(executeInitializationStep, /triggerRelics\('battle_start'\)/);
assert.doesNotMatch(initializeTriggers, /createSnapshot|restoreSnapshot|deleteSnapshot|runBattleStartFlow/);

const statusRuntimePath = resolve('src/game-core/statusLifecycleRuntime.ts');
const statusRuntimeSource = await readFile(statusRuntimePath, 'utf8');
const statusOwnership = readClassMethod(
  statusRuntimeSource,
  statusRuntimePath,
  'StatusLifecycleRuntime',
  'dispatchOwnership',
);
assert.match(statusOwnership, /resolveStatusOwnershipTriggerDispatch\(/);
assert.match(statusOwnership, /this\.ports\.dispatch\(/);
assert.doesNotMatch(triggerHostSource, /resolveStatusOwnershipTriggerDispatch|processStatusOwnershipTriggers/);

const addAbility = readClassMethod(triggerHostSource, triggerHostPath, 'TavernBattleTriggerHost', 'registerAbility');
assert.match(addAbility, /processAbilitiesByTrigger\(targetType, 'ability_gain'\)/);
assert.match(addAbility, /targetType === 'player'/);
assert.match(addAbility, /ports\.runRelic\('ability_gain'/);
assert.ok(
  addAbility.indexOf("processAbilitiesByTrigger(targetType, 'ability_gain')") <
    addAbility.indexOf("ports.runRelic('ability_gain'"),
  'ability-gain abilities must run before player relics',
);

const executorRegister = readClassMethod(executorSource, executorPath, 'UnifiedEffectExecutor', 'registerAbility');
assert.match(executorRegister, /this\.triggerHost\.registerAbility\(targetType, definition\)/);

console.log('Relics share a guarded trigger path for the complete runtime event matrix.');
