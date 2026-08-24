import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const sourcePath = resolve('src/game-core/battleMath.ts');
const source = await readFile(sourcePath, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const math = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

assert.equal(math.applyNumericOperator(10, '+', 4), 14);
assert.equal(math.applyNumericOperator(10, '-', 4), 6);
assert.equal(math.applyNumericOperator(10, '*', 1.5), 15);
assert.equal(math.applyNumericOperator(10, '/', 4), 2.5);
assert.equal(math.applyNumericOperator(10, '/', 0), 10);
assert.equal(math.applyNumericOperator(10, 'set', 0), 0);

assert.equal(math.parseBattleNumericLiteral('2'), 2);
assert.equal(math.parseBattleNumericLiteral('-1.5'), -1.5);
assert.equal(math.parseBattleNumericLiteral('2 + 3'), null);
assert.equal(math.parseBattleNumericLiteral('(2 + 3)'), null);
assert.equal(math.parseBattleNumericLiteral('2 trailing'), null);

assert.equal(math.clampBattleAttribute('hp', -2, { maxHp: 80 }), 0);
assert.equal(math.clampBattleAttribute('hp', 90, { maxHp: 80 }), 80);
assert.equal(math.clampBattleAttribute('lust', 120, { maxLust: 100 }), 100);
assert.equal(math.clampBattleAttribute('block', -1), 0);
assert.equal(math.clampBattleAttribute('max_energy', 0), 1);
assert.equal(math.roundBattleValue(4.26), 4.3);

assert.deepEqual(math.absorbDamageWithBlock(8, 6), {
  damage: 2,
  blockUsed: 6,
  remainingBlock: 0,
});
assert.deepEqual(math.absorbDamageWithBlock(4, 9), {
  damage: 0,
  blockUsed: 4,
  remainingBlock: 5,
});

assert.equal(math.evaluateBattleMathExpression('2 + 3 * 4'), 14);
assert.equal(math.evaluateBattleMathExpression('(2 + 3) * 4'), 20);
assert.equal(math.evaluateBattleMathExpression('10 / 4'), 2, 'dynamic effect math keeps the existing floor behavior');
assert.equal(math.evaluateBattleMathExpression('-(2 + 1.5)'), -4);
assert.throws(() => math.evaluateBattleMathExpression('1 / 0'), /Division by zero/);
assert.throws(() => math.evaluateBattleMathExpression('globalThis.alert(1)'), /Invalid number|Unexpected token/);
assert.throws(() => math.evaluateBattleMathExpression('2 ** 3'), /Invalid number/);

assert.equal(math.evaluateBattleConditionExpression('80 < 100'), true);
assert.equal(math.evaluateBattleConditionExpression('80 >= 100'), false);
assert.equal(math.evaluateBattleConditionExpression('(8 + 2) * 2 = 20'), true);
assert.equal(math.evaluateBattleConditionExpression('1 < 2 && (3 >= 3 || 0 > 1)'), true);
assert.equal(math.evaluateBattleConditionExpression('!(4 != 4)'), true);
assert.equal(math.evaluateBattleConditionExpression('2 ≤ 3'), true);
assert.throws(() => math.evaluateBattleConditionExpression('1'), /must resolve to a boolean/);
assert.throws(() => math.evaluateBattleConditionExpression('alert(1)'), /Unexpected token/);

console.log('Battle numeric operations and safe expression parser passed.');
