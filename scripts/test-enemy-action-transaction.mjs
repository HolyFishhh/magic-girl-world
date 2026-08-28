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

const battleManagerPath = resolve('src/fish/combat/battleManager.ts');
const battleManagerSource = await readFile(battleManagerPath, 'utf8');
const executionBridge = readClassMethod(
  battleManagerSource,
  battleManagerPath,
  'BattleManager',
  'executeEnemyEffect',
);

assert.match(
  executionBridge,
  /UnifiedEffectExecutor\.getInstance\(\)\.executeEffectProgram\(effectProgram, false/,
);
assert.doesNotMatch(executionBridge, /executeEffectString|\.effect\b/);
assert.doesNotMatch(executionBridge, /catch \(error\)|createSnapshot|restoreSnapshot|deleteSnapshot|Date\.now/);

const executeEnemyAction = readClassMethod(
  battleManagerSource,
  battleManagerPath,
  'BattleManager',
  'executeEnemyAction',
);
assert.match(executeEnemyAction, /executeEnemyEffect\(action\.effectProgram, action\.name, entry\.enemyId\)/);
assert.doesNotMatch(executeEnemyAction, /catch \(error\)/, 'enemy action errors must reach the session coordinator');

const executeDefaultEnemyAction = readClassMethod(
  battleManagerSource,
  battleManagerPath,
  'BattleManager',
  'executeDefaultEnemyAction',
);
assert.match(executeDefaultEnemyAction, /rollDefaultEnemyAttackDamage\(\(\) => this\.gameStateManager\.nextRandom\(\)\)/);
assert.match(executeDefaultEnemyAction, /op: 'damage'[\s\S]*amount: damage/);

assert.doesNotMatch(battleManagerSource, /executeEnemyEffectTransaction|enemy_action_\$\{Date\.now\(\)\}/);
assert.doesNotMatch(battleManagerSource, /public updateEnemyAI|public adjustDifficulty|adjustActionEffect/);

console.log('Enemy actions delegate one complete transaction to the battle-session coordinator.');
