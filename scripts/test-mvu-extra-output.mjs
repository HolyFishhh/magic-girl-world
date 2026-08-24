import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const manifest = await readJson('worldbook_new/manifest.json');
const entryConfig = await readJson('worldbook_new/entry-config.json');
const dedicatedName = '额外模型变量更新格式';
const dedicated = await readFile(resolve(root, 'worldbook_new', manifest[dedicatedName]), 'utf8');

assert.match(dedicated, /<UpdateVariable>/);
assert.match(dedicated, /每个非空行都必须是一个完整的 MVU 函数命令/);
assert.match(dedicated, /不能把对象属性拆成标签或树形节点/);
assert.match(dedicated, /_\.assign\('battle\.statuses'/);

const config = entryConfig[dedicatedName];
assert.equal(config.comment, '[mvu_update] 额外模型变量更新格式');
assert.equal(config.constant, true, 'extra-model format must be an always-active update entry');
assert.equal(config.selective, false);
assert.equal(entryConfig['变量更新规则'].constant, true, 'variable rules must be always active for the update model');
assert.equal(config.extensions.group, '', 'format contract must not suppress another update entry through a group');
assert.equal(entryConfig['变量更新规则'].extensions.group, '');

const prompts = (
  await Promise.all(
    Object.values(manifest).map(async source => readFile(resolve(root, 'worldbook_new', source), 'utf8')),
  )
).join('\n');
for (const pattern of [/<Update>\s*<Set/, /<Set\s+name=/, /<Add>\s*<Item>/, /<battle\.[^>]+>/]) {
  assert.doesNotMatch(prompts, pattern, `production worldbook still teaches XML update syntax: ${pattern}`);
}

const hasSupportedCommand = value =>
  /_\.(?:set|insert|assign|remove|unset|delete|add)\s*\([\s\S]*?\)\s*;/.test(value);
const invalidUserOutput = `<UpdateVariable>\n<battle.enemy><Update><Set name="hp" value="42" /></Update></battle.enemy>\n</UpdateVariable>`;
const validOutput = `<UpdateVariable>\n<Analysis>Changed hp.</Analysis>\n_.set('battle.enemy.hp', 50, 42);\n</UpdateVariable>`;
assert.equal(hasSupportedCommand(invalidUserOutput), false, 'nested XML must be rejected like MVU extra-model parser');
assert.equal(hasSupportedCommand(validOutput), true, 'function-command output must be accepted by MVU parser');

console.log('MVU extra-model output contract passed.');
