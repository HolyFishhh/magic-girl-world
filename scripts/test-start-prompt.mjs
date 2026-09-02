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
  customDescription: '  喜欢甜食  ',
  world: '现代都市怪谈',
  profession: '自由魔法使',
  opening: '从一次失踪事件开始',
  card: '火焰与连击',
});

const lines = message.split('\n');
assert.equal(lines[0], '[角色创建]');
assert.equal(lines[2], '[剧情模式]');
assert.equal(lines[3], '[开始游戏]');
assert.deepEqual(JSON.parse(lines[1]), {
  mode: 'story',
  name: '测试者',
  appearance: '喜欢甜食',
  world: '现代都市怪谈',
  identity: '自由魔法使',
  opening: '从一次失踪事件开始',
  card: '火焰与连击',
});
assert.doesNotMatch(message, /faction|location|mechanics|limits|初始化变量/);
assert.ok(message.length < 260, 'the generated start handoff must stay compact with custom story fields');
assert.ok(encode(message).length <= 110, 'the generated start handoff must stay within its AI token budget');

const minimalMessage = createCharacterStartMessage({ mode: 'story' });
assert.equal(minimalMessage, '[角色创建]\n{"mode":"story"}\n[剧情模式]\n[开始游戏]');
assert.ok(encode(minimalMessage).length <= 32, 'an empty optional form must produce a minimal handoff');

const towerMessage = createCharacterStartMessage({
  mode: 'tower',
  world: '随机世界',
  towerRequirements: '短叙事，事件更偏向高风险取舍',
});
assert.equal(
  towerMessage,
  '[角色创建]\n{"mode":"tower","world":"随机世界","tower_requirements":"短叙事，事件更偏向高风险取舍"}\n[爬塔模式]\n[开始游戏]',
);
assert.doesNotMatch(towerMessage, /爬塔开局要求|中文字符|短段落|不直接开战/);
assert.doesNotMatch(message, /爬塔开局要求|中文字符/, '剧情模式不能继承爬塔开局衔接说明');
const legacyExpeditionMessage = createCharacterStartMessage({ mode: 'expedition' });
assert.equal(
  legacyExpeditionMessage,
  '[角色创建]\n{"mode":"tower"}\n[爬塔模式]\n[开始游戏]',
);

const startHtml = await readFile(resolve('src/start/index.html'), 'utf8');
assert.doesNotMatch(startHtml, /setup-tab|story-config|偏好|阵营/);
assert.match(startHtml, /class="mode-card selected"[^>]*data-mode="story"/);
assert.match(startHtml, /class="mode-card"[^>]*data-mode="tower"[^>]*aria-checked="false"/);
assert.doesNotMatch(startHtml, /data-mode="tower"[^>]*disabled/);
assert.match(startHtml, /data-tower-extension-check/);
assert.match(startHtml, /data-action="install-tower-extension"/);
assert.match(startHtml, /你也可以通过直接描述一段内容来开始游戏，体验卡牌战斗内容/);
for (const field of ['name', 'customDescription', 'profession', 'opening', 'world', 'card', 'towerRequirements']) {
  assert.match(startHtml, new RegExp(`data-config-field="${field}"`));
}
assert.match(startHtml, /data-mode-only="tower"/);
assert.match(startHtml, /难度控制/);
assert.ok((startHtml.match(/data-preset-field="world"/g) || []).length >= 10, 'world presets must be discoverable');
assert.ok((startHtml.match(/data-preset-field="card"/g) || []).length >= 10, 'card presets must be discoverable');
for (const title of ['魔法少女', '现代都市', '修仙世界', '蒸汽朋克', '均衡构筑', '连击构筑', '状态持续']) {
  assert.match(
    startHtml,
    new RegExp(`<strong>${title}</strong><span>`),
    `${title} must use one title followed by its description`,
  );
}
for (const removedTitle of ['白木市', '魔法公开', '双层世界', '经典构筑', '元素构筑', '叙事构筑']) {
  assert.doesNotMatch(
    startHtml,
    new RegExp(`<strong>${removedTitle}</strong>`),
    `${removedTitle} must not remain in the rewritten presets`,
  );
}
assert.doesNotMatch(
  startHtml,
  /<strong>[^<]+ [^<]+<\/strong>/,
  'preset cards must not merge a subtitle into the title',
);
assert.doesNotMatch(
  startHtml,
  /data-config-field="startingLocation"|data-config-field="faction"|data-config-field="theme"|data-config-field="plot"/,
);

const creatorSource = await readFile(resolve('src/start/core/characterCreator.ts'), 'utf8');
assert.match(creatorSource, /TavernContinuationHost\.getInstance\(\)/);
assert.match(creatorSource, /requireBattleData:\s*false/);
assert.match(
  creatorSource,
  /await ensureMvuRuntimeReady\([\s\S]*?requireBattleData:\s*false,[\s\S]*?\);[\s\S]*await updateCurrentMessageVariablesWith/,
  'the first generation must wait for the MVU host without deadlocking on battle data that it creates itself',
);
assert.match(creatorSource, /this\.updateStartButtonText\(\);[\s\S]*this\.validateForm\(\);/);
assert.doesNotMatch(creatorSource, /游戏模式暂未写入 MUV/);
assert.match(creatorSource, /continuationHost\.continueWithPrompt\(\{ prompt: startMessage \}\)/);
assert.doesNotMatch(creatorSource, /triggerSlash\(`\/send|triggerSlash\('\/send/);
assert.match(creatorSource, /return normalizeGameMode\(config\.mode\) !== null/, 'both start modes must be accepted');
assert.doesNotMatch(creatorSource, /selectFaction|FACTION_INFO|startingLocation|\.setup-tab/);
assert.match(creatorSource, /preset-card\[data-preset-field/);
assert.match(creatorSource, /selectMode\('story'\)/);
assert.match(creatorSource, /lockGameModeInStat\(variables\.stat_data, config\.mode\)/);
assert.match(
  creatorSource,
  /await updateCurrentMessageVariablesWith\(persistStartMode\);[\s\S]*await updateCurrentChatVariablesWith\(persistStartMode\);/,
  'the immutable mode lock must survive from the start-message floor into the generated assistant floor',
);
assert.doesNotMatch(creatorSource, / \u00b7 /, 'start preview must not restore the removed title separator');

const patcherSource = await readFile(resolve('scripts/patch-character-card.mjs'), 'utf8');
const mvuLoaderSource = await readFile(resolve('scripts/lib/mvu-card-loader.mjs'), 'utf8');
assert.match(patcherSource, /buildMvuCardLoader/);
assert.match(mvuLoaderSource, /破限方案='使用内置破限'/);
assert.match(mvuLoaderSource, /其他预设名称=''/);
assert.doesNotMatch(mvuLoaderSource, /getPreset|wrappedGetPreset|卡内变量预设/);
assert.match(mvuLoaderSource, /关闭thinking=false/);
assert.doesNotMatch(mvuLoaderSource, /MAGIC_GIRL_WORLD_GENERATE_RAW_MONITOR|g\.generateRaw=/);
assert.match(mvuLoaderSource, /随机头部=false/);
assert.match(mvuLoaderSource, /max_chat_history=2/);
assert.match(mvuLoaderSource, /请求次数=2/);
assert.match(mvuLoaderSource, /最大回复token数=20000/);
assert.match(mvuLoaderSource, /世界书条目白名单正则/);
assert.match(mvuLoaderSource, /已开启默认不兼容假流式=true/);
assert.match(mvuLoaderSource, /额外模型解析中=true/);

console.log('Character creation uses one compact shallow-JSON handoff with a stable world-book trigger.');
