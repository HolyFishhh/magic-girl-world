import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = await readFile(resolve('src/fish/core/battleDataContract.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const contract = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const battle = {
  core: { emoji: '🧙', hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
  cards: [{ id: 'strike', quantity: 4 }],
  enemy: { name: 'Training Dummy', hp: 60, max_hp: 60, lust: 0, max_lust: 100 },
};

assert.deepEqual(
  contract.readBattleDataContract({ stat_data: { battle } }),
  { data: battle, source: 'stat_data.battle' },
);
assert.equal(contract.readBattleDataContract({ battle }), null, 'flat battle data is outside the current contract');
assert.equal(contract.isBattleDataContract(battle), true);
assert.equal(contract.readBattleDataContract({ stat_data: { battle: { ...battle, enemy: {} } } }), null);
assert.equal(contract.readBattleDataContract({ stat_data: { battle: { ...battle, core: { hp: 80 } } } }), null);
assert.equal(contract.readBattleDataContract({ stat_data: { battle: { ...battle, cards: {} } } }), null);

assert.deepEqual(contract.inspectBattleDataContract({}), {
  ok: false,
  issue: { code: 'MISSING_BATTLE', path: 'battle', message: '未找到战斗数据' },
});
assert.deepEqual(
  contract.inspectBattleDataContract({ stat_data: { battle: { ...battle, cards: 'not-an-array' } } }),
  {
    ok: false,
    issue: { code: 'INVALID_TYPE', path: 'battle.cards', message: '必须是数组' },
  },
);
assert.deepEqual(
  contract.inspectBattleDataContract({
    stat_data: { battle: { ...battle, core: { ...battle.core, hp: '80' } } },
  }),
  {
    ok: false,
    issue: { code: 'INVALID_TYPE', path: 'battle.core.hp', message: '必须是最多两位小数的有限数值' },
  },
);
assert.deepEqual(
  contract.inspectBattleDataContract({
    stat_data: { battle: { ...battle, enemy: { ...battle.enemy, max_hp: Number.NaN } } },
  }),
  {
    ok: false,
    issue: { code: 'INVALID_TYPE', path: 'battle.enemy.max_hp', message: '必须是最多两位小数的有限数值' },
  },
);
assert.deepEqual(
  contract.inspectBattleDataContract({
    stat_data: { battle: { ...battle, enemy: { ...battle.enemy, lust: '0', max_lust: 100 } } },
  }),
  {
    ok: false,
    issue: { code: 'INVALID_TYPE', path: 'battle.enemy.lust', message: '必须是最多两位小数的有限数值' },
  },
);
assert.equal(
  contract.inspectBattleDataContract({
    stat_data: { battle: { ...battle, enemy: { ...battle.enemy, hp: 46.2 } } },
  }).ok,
  true,
);
assert.equal(
  contract.inspectBattleDataContract({
    stat_data: { battle: { ...battle, enemy: { ...battle.enemy, hp: 46.237 } } },
  }).ok,
  false,
  'runtime battle state accepts at most two decimal places',
);
assert.deepEqual(
  contract.inspectBattleDataContract({
    stat_data: { battle: { ...battle, cards: 'canonical-is-invalid' } },
    battle,
  }),
  {
    ok: false,
    issue: { code: 'INVALID_TYPE', path: 'battle.cards', message: '必须是数组' },
  },
  'an invalid canonical battle must never fall back to a flat battle value',
);

const gameStateSource = await readFile(resolve('src/fish/core/gameStateManager.ts'), 'utf8');
assert.match(gameStateSource, /const battleData = readBattleDataContract\(variables\)\?\.data/);
assert.match(gameStateSource, /const rawCards = battleData\?\.cards/);
assert.match(gameStateSource, /buildMvuStatusDisplayContext\(battleData\?\.statuses\)/);
assert.match(gameStateSource, /const battleData = battleContract\?\.data/);
assert.match(gameStateSource, /const mvuEnemies = Array\.isArray\(battleData\?\.enemies\)/);
assert.match(gameStateSource, /convertMvuEnemies\(mvuEnemies/);
assert.equal(
  (gameStateSource.match(/buildMvuStatusDisplayContext\(battleData\?\.statuses\)/g) || []).length,
  2,
  'card sync and enemy recovery must share the status display context',
);
assert.match(gameStateSource, /buildMvuStatusDisplayContext\(battleData\.statuses\)/);
assert.match(gameStateSource, /const battleInspection = inspectBattleDataContract\(variables\)/);
assert.match(gameStateSource, /battleInspection\.issue\.code !== 'MISSING_BATTLE'/);
assert.match(gameStateSource, /战斗数据校验失败：\$\{battleInspection\.issue\.path\}/);
assert.ok(
  gameStateSource.indexOf('const battleInspection = inspectBattleDataContract(variables)') <
    gameStateSource.indexOf('this.battleSessionStore.prepare(variables, battleRequest)'),
  'MUV input must be inspected before a saved battle session can be restored',
);
assert.doesNotMatch(gameStateSource, /cardsRuntime|variables2\?\.battle\?\.cards/);
assert.doesNotMatch(gameStateSource, /variables\?\.battle\?\.enemy \|\| variables\?\.stat_data/);
assert.doesNotMatch(gameStateSource, /完整的MVU变量调试信息|variables 根对象/);
assert.doesNotMatch(gameStateSource, /heal:15|apply_status:enemy:weak/);
assert.match(gameStateSource, /effectProgram:[\s\S]*op: 'damage'[\s\S]*op: 'heal'/);

console.log('MUV battle data contract passed.');
