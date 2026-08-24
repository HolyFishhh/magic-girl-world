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
const endPlayerTurn = readClassMethod(battleManagerSource, battleManagerPath, 'BattleManager', 'endPlayerTurn');

assert.match(endPlayerTurn, /await advanceBattleSessionTurn\(\{/);
assert.match(endPlayerTurn, /gate: this\.sessionHost\.gate/);
assert.match(endPlayerTurn, /beginTransaction: action => this\.sessionHost\.beginTransaction\(action\)/);
assert.match(endPlayerTurn, /commitTransaction: token => this\.sessionHost\.commitTransaction\(token\)/);
assert.match(endPlayerTurn, /rollbackTransaction: token => this\.sessionHost\.rollbackTransaction\(token\)/);
assert.match(endPlayerTurn, /canEndTurn: \(\) => this\.canPlayerAct\(\)/);
assert.match(endPlayerTurn, /beginEnemyTurn: \(\) => this\.gameStateManager\.beginEnemyTurn\(\)/);
assert.match(endPlayerTurn, /executeTurnStep: step => this\.executeTurnFlowStep\(step\)/);
assert.doesNotMatch(endPlayerTurn, /isEndingTurn|createSnapshot|restoreSnapshot|deleteSnapshot|runBattleTurnFlow/);
assert.doesNotMatch(endPlayerTurn, /cardSystem\.onTurnEnd|processAbilitiesAtTurnEnd|processStatusEffectsAtTurnEnd/);

const executeTurnFlowStep = readClassMethod(
  battleManagerSource,
  battleManagerPath,
  'BattleManager',
  'executeTurnFlowStep',
);
assert.match(executeTurnFlowStep, /case 'player_cards_end':[\s\S]*cardSystem\.onTurnEnd\(\)/);
assert.match(executeTurnFlowStep, /case 'player_relics_end':[\s\S]*relicTriggerHost\.triggerRelics\('turn_end'\)/);
assert.match(
  executeTurnFlowStep,
  /case 'player_abilities_end':[\s\S]*processAbilitiesByTrigger\('player', 'turn_end'\)/,
);
assert.match(executeTurnFlowStep, /case 'player_statuses_end':[\s\S]*processStatusEffectsAtTurnEnd\('player'\)/);
assert.match(executeTurnFlowStep, /case 'enemy_abilities_end':[\s\S]*processAbilitiesByTrigger\('enemy', 'turn_end'\)/);
assert.match(executeTurnFlowStep, /case 'enemy_statuses_end':[\s\S]*processStatusEffectsAtTurnEnd\('enemy'\)/);
assert.match(executeTurnFlowStep, /case 'player_begin':[\s\S]*beginPlayerTurn\(\)/);
assert.match(executeTurnFlowStep, /case 'player_draw':[\s\S]*cardSystem\.onTurnStart\(\)/);
assert.doesNotMatch(battleManagerSource, /private async (?:startPlayerTurn|startNewTurn|executeEnemyTurn)\(/);

console.log('Player turn transactions delegate one complete cycle to the portable flow without duplicate branches.');
