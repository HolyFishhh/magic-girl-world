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

const cardSystemPath = resolve('src/fish/combat/cardSystem.ts');
const source = await readFile(cardSystemPath, 'utf8');

const discardTrigger = readClassMethod(source, cardSystemPath, 'CardSystem', 'triggerDiscardEffect');
assert.match(discardTrigger, /runTriggerTransaction\(/);
assert.match(discardTrigger, /triggerTransactionPorts\(\)/);
assert.match(discardTrigger, /recover-and-continue/);
assert.doesNotMatch(discardTrigger, /卡牌弃牌效果执行失败/);

const curseTrigger = readClassMethod(source, cardSystemPath, 'CardSystem', 'executeCurseTurnEndTransaction');
assert.match(curseTrigger, /runTriggerTransaction\(/);
assert.match(curseTrigger, /triggerTransactionPorts\(\)/);
assert.match(curseTrigger, /await executor\.executeEffectProgram\(curse\.effectProgram/);
assert.match(curseTrigger, /recover-and-continue/);

const onTurnEnd = readClassMethod(source, cardSystemPath, 'CardSystem', 'onTurnEnd');
assert.match(onTurnEnd, /selectTurnEndCurseTriggers\(player\.hand \|\| \[\]\)/);
assert.match(onTurnEnd, /for \(const curse of cursesInHand\)/);
assert.match(onTurnEnd, /await this\.executeCurseTurnEndTransaction\(curse\)/);
assert.match(onTurnEnd, /if \(this\.gameStateManager\.isGameOver\(\)\) return/);
assert.ok(
  onTurnEnd.indexOf('executeCurseTurnEndTransaction(curse)') < onTurnEnd.indexOf('await this.discardHand()'),
  'curses, including ethereal curses, must trigger before hand disposal',
);
assert.doesNotMatch(onTurnEnd, /诅咒牌回合结束触发失败/);
assert.doesNotMatch(onTurnEnd, /relicEffectManager|triggerOnTurnEnd/);

console.log('Discard and curse card triggers use isolated game-state transactions.');
