import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = await readFile(resolve('src/common/statusAdapter.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const adapter = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

assert.equal(adapter.readStatusLocation({ location: '白木市（学园区）' }), '白木市（学园区）');
assert.equal(adapter.readStatusLocation({ location_weather: '已移除字段' }), '');
assert.deepEqual(
  adapter.readStatusProfession({ profession: { name: '见习魔法少女', ability: '星光卡牌' } }),
  { name: '见习魔法少女', ability: '星光卡牌' },
);
assert.deepEqual(adapter.readStatusProfession({ profession: '已移除字符串格式' }), { name: '', ability: '' });

console.log('Canonical status adapter passed.');
