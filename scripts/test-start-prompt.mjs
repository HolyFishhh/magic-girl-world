import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createCharacterStartMessage } = require(resolve('src/start/core/promptGenerator.ts'));

const message = createCharacterStartMessage({
  mode: 'story',
  name: '测试者',
  faction: 'magical_girl',
  ordinaryIdentity: { id: 'student', name: '学生', description: '不应重复进入提示', icon: 'x' },
  supernaturalIdentity: {
    id: 'guardian',
    name: '魔法守护者',
    description: '不应重复进入提示',
    detailedDescription: '不应重复进入提示',
    icon: 'x',
    faction: 'magical_girl',
  },
  city: { id: 'shiroki', name: '白木市', description: '不应重复进入提示', emoji: 'x', status: 'available' },
  location: { id: 'school', name: '白木高中', description: '不应重复进入提示', category: 'school' },
  customDescription: '  喜欢甜食  ',
});

const lines = message.split('\n');
assert.equal(lines[0], '[角色创建]');
assert.equal(lines[2], '[剧情模式]');
assert.equal(lines[3], '[开始游戏]');
assert.deepEqual(JSON.parse(lines[1]), {
  mode: 'story',
  name: '测试者',
  faction: '魔法少女',
  ordinary: '学生',
  city: '白木市',
  location: '白木高中',
  supernatural: '魔法守护者',
  note: '喜欢甜食',
});
assert.doesNotMatch(message, /不应重复进入提示|请根据以上信息|初始化变量/);
assert.ok(message.length < 220, 'the generated start handoff must stay compact');
assert.ok(encode(message).length <= 75, 'the generated start handoff must stay within its AI token budget');

const creatorSource = await readFile(resolve('src/start/core/characterCreator.ts'), 'utf8');
assert.match(creatorSource, /TavernContinuationHost\.getInstance\(\)/);
assert.match(creatorSource, /ensureMvuRuntimeReady\(\{ mvuTimeoutMs: 30000, battleDataTimeoutMs: 30000 \}\)/);
assert.match(
  creatorSource,
  /await ensureMvuRuntimeReady\(\{ mvuTimeoutMs: 30000, battleDataTimeoutMs: 30000 \}\);[\s\S]*await updateCurrentMessageVariablesWith/,
  'the first generation must wait for the chat-level MVU listener before writing or sending the handoff',
);
assert.doesNotMatch(creatorSource, /游戏模式暂未写入 MUV/);
assert.match(creatorSource, /continuationHost\.continueWithPrompt\(\{ prompt: startMessage \}\)/);
assert.doesNotMatch(creatorSource, /triggerSlash\(`\/send|triggerSlash\('\/send/);

console.log('Character creation uses one compact shallow-JSON handoff with a stable world-book trigger.');
