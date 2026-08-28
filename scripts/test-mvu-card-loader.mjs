import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMvuCardLoader } from './lib/mvu-card-loader.mjs';

const releaseConfig = JSON.parse(await readFile('release.config.json', 'utf8'));
const cardVersion = releaseConfig.cardVersion;
const worldbookName = `${releaseConfig.worldbookPrefix}${cardVersion}`;

let presetApiCalls = 0;
globalThis.getPresetNames = () => {
  presetApiCalls += 1;
  return ['现有剧情预设'];
};
globalThis.getPreset = name => {
  presetApiCalls += 1;
  return { prompts: [], source: name };
};
globalThis.getLorebookEntries = async name => {
  assert.equal(name, worldbookName);
  return [];
};
globalThis.SillyTavern = {
  extensionSettings: {},
  saveSettingsDebounced() {
    globalThis.__mwgSavedSettings = (globalThis.__mwgSavedSettings || 0) + 1;
  },
};
globalThis.__mwgMvuImported = 0;
globalThis.MagicGirlWorldMvuMonitor = { getSettings: () => ({ requestThinking: true }) };
const originalGenerateRaw = async () => '<UpdateVariable>fixed</UpdateVariable>';
globalThis.generateRaw = originalGenerateRaw;

const moduleSource = encodeURIComponent('globalThis.__mwgMvuImported += 1; //');
const loader = buildMvuCardLoader({
  cardVersion,
  worldbookName,
  mvuUrl: `data:text/javascript,${moduleSource}`,
});
await (0, eval)(loader);

const settings = globalThis.SillyTavern.extensionSettings.mvu_settings;
const extra = settings.额外模型解析配置;
assert.equal(settings.更新方式, '额外模型解析');
assert.equal(extra.破限方案, '使用内置破限');
assert.equal(extra.其他预设名称, '');
assert.equal(extra.兼容假流式, true);
assert.equal(settings.通知.额外模型解析中, true);
assert.equal(extra.关闭thinking, true);
assert.equal(extra.随机头部, false);
assert.equal(extra.应答格式, '聊天消息');
assert.equal(extra.请求方式, '依次请求，失败后重试');
assert.equal(extra.请求次数, 2);
assert.equal(extra.max_chat_history, 2);
assert.equal(extra.最大回复token数, 20000);
assert.equal(extra.世界书条目白名单正则, '^\\[mvu_update\\]');
assert.equal(settings.internal.已开启默认不兼容假流式, true);
assert.equal(settings.internal.魔法少女世界额外模型默认版本, cardVersion);
assert.equal(globalThis.__mwgSavedSettings, 1);
assert.equal(globalThis.__mwgMvuImported, 1);
assert.equal(presetApiCalls, 0, 'the card must not register, inspect, or replace any SillyTavern preset');
assert.equal(globalThis[`__MAGIC_GIRL_WORLD_MVU_LOADER__${cardVersion}`].state.presetMode, 'builtin');

assert.equal(
  globalThis.generateRaw,
  originalGenerateRaw,
  'the card loader must not monkey-patch Tavern Helper generation functions',
);

delete globalThis.getPresetNames;
delete globalThis.getPreset;
delete globalThis.getLorebookEntries;
delete globalThis.SillyTavern;
delete globalThis.__mwgSavedSettings;
delete globalThis.__mwgMvuImported;
delete globalThis.MagicGirlWorldMvuMonitor;
delete globalThis.generateRaw;
delete globalThis[`__MAGIC_GIRL_WORLD_MVU_LOADER__${cardVersion}`];

console.log('Card MVU loader uses built-in jailbreak without touching Tavern presets or generation functions.');
