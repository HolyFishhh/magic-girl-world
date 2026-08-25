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
  profession: '自由魔法使',
  startingLocation: '海边小镇',
  customDescription: '  喜欢甜食  ',
  world: '现代都市怪谈',
  plot: '从一次失踪事件开始',
  card: '火焰与连击',
  mechanics: '灼烧，抽牌',
  limits: '避免过度血腥',
});

const lines = message.split('\n');
assert.equal(lines[0], '[角色创建]');
assert.equal(lines[2], '[剧情模式]');
assert.equal(lines[3], '[开始游戏]');
assert.deepEqual(JSON.parse(lines[1]), {
  mode: 'story',
  name: '测试者',
  faction: '魔法少女',
  profession: '自由魔法使',
  location: '海边小镇',
  note: '喜欢甜食',
  world: '现代都市怪谈',
  plot: '从一次失踪事件开始',
  card: '火焰与连击',
  mechanics: '灼烧，抽牌',
  limits: '避免过度血腥',
});
assert.doesNotMatch(message, /请根据以上信息|初始化变量/);
assert.ok(message.length < 320, 'the generated start handoff must stay compact even with custom story fields');
assert.ok(encode(message).length <= 130, 'the generated start handoff must stay within its AI token budget');

const minimalMessage = createCharacterStartMessage({ mode: 'story' });
assert.equal(minimalMessage, '[角色创建]\n{"mode":"story"}\n[剧情模式]\n[开始游戏]');
assert.ok(encode(minimalMessage).length <= 32, 'an empty optional form must produce a minimal handoff');

const startHtml = await readFile(resolve('src/start/index.html'), 'utf8');
assert.doesNotMatch(startHtml, /mode-card selected/, 'no mode may be selected before the player chooses one');
assert.match(startHtml, /data-mode="expedition"[^>]*disabled/, 'tower mode must remain visibly unavailable');
assert.match(startHtml, /id="story-config"[^>]*hidden/, 'story configuration must be collapsed by default');
for (const tab of ['角色', '世界', '剧情', '卡牌', '偏好']) assert.match(startHtml, new RegExp(`>\\s*${tab}\\s*<`));
assert.match(startHtml, /data-config-field="profession"/);
assert.match(startHtml, /data-config-field="startingLocation"/);
assert.doesNotMatch(
  startHtml,
  /剧情方向预设|data-config-field="pace"|data-config-field="style"|class="job-grid"|class="city-grid"/,
);

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
assert.match(creatorSource, /return config\.mode === 'story'/, 'story mode must be the only required form choice');

console.log('Character creation uses one compact shallow-JSON handoff with a stable world-book trigger.');
