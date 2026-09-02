import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from 'parse5';
import vm from 'node:vm';
import extractPngChunks from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const expectedWorldbookName = `${releaseConfig.worldbookPrefix}${releaseConfig.cardVersion}`;
const fishSourceHtml = await readFile(resolve(root, 'src/fish/index.html'), 'utf8');

assert.ok(
  fishSourceHtml.includes('正在恢复战斗...'),
  'battle interface must describe its pre-initialization state as loading',
);
assert.ok(
  !fishSourceHtml.includes('初始化失败，请重roll'),
  'battle interface must not present its normal loading placeholder as a failure',
);

async function importTypeScript(sourcePath, replacements = []) {
  let source = await readFile(sourcePath, 'utf8');
  for (const [find, replacement] of replacements) source = source.replace(find, replacement);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const runtimePath = resolve(root, 'src/runtime/tavernHost.ts');

if (process.argv.includes('--missing-host')) {
  const runtimeModule = await importTypeScript(runtimePath);
  assert.throws(() => runtimeModule.requireTavernHelperHost(), /酒馆助手接口缺失/);
  assert.equal(globalThis.getVariables, undefined, 'missing Tavern APIs must never be synthesized');
  console.log('Missing Tavern Helper host is rejected.');
  process.exit(0);
}

const calls = [];
const variables = { stat_data: { battle: { statuses: [] } }, schema: { type: 'object' } };
let pendingBattleReads = 2;
let pendingWorldbookErrors = 2;
globalThis.TavernHelper = {};
globalThis.getCurrentMessageId = () => 42;
globalThis.getLastMessageId = () => 42;
globalThis.getTavernHelperVersion = async () => '3.4.17';
globalThis.getVariables = option => {
  calls.push(['get', option]);
  if (pendingWorldbookErrors > 0) {
    pendingWorldbookErrors -= 1;
    throw new Error("未能找到世界书 '魔法少女世界0.5.32'");
  }
  if (pendingBattleReads > 0) {
    pendingBattleReads -= 1;
    return { stat_data: {} };
  }
  return structuredClone(variables);
};
globalThis.replaceVariables = (value, option) => calls.push(['replace', option, value]);
globalThis.updateVariablesWith = (updater, option) => {
  calls.push(['update', option]);
  return updater(structuredClone(variables));
};
globalThis.insertOrAssignVariables = (value, option) => {
  calls.push(['insertOrAssign', option, value]);
  return value;
};
globalThis.Mvu = {
  getMvuData: option => globalThis.getVariables(option),
  replaceMvuData: (value, option) => globalThis.replaceVariables(value, option),
};

const runtimeModule = await importTypeScript(runtimePath);
const runtimeUrl = `data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(await readFile(runtimePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
).toString('base64')}`;
const messageModule = await importTypeScript(resolve(root, 'src/runtime/messageVariables.ts'), [
  ["from './tavernHost'", `from '${runtimeUrl}'`],
]);

assert.equal(runtimeModule.requireTavernHelperHost(), globalThis);
await messageModule.ensureMvuRuntimeReady();
assert.equal(pendingWorldbookErrors, 0, 'battle startup must retry a transient missing-worldbook error');
assert.equal(pendingBattleReads, 0, 'battle startup must retry while the current message battle floor is still pending');
const stableGetVariables = globalThis.getVariables;
let hostOnlyVariableReads = 0;
globalThis.getVariables = () => {
  hostOnlyVariableReads += 1;
  return { stat_data: {} };
};
await messageModule.ensureMvuRuntimeReady({ mvuTimeoutMs: 200, requireBattleData: false });
assert.equal(hostOnlyVariableReads, 0, 'first-message setup must not wait for battle data before it can request initialization');
globalThis.getVariables = stableGetVariables;
globalThis.getVariables = () => {
  throw new Error('Type mismatch: expected object schema but got any at path battle.enemy');
};
await assert.rejects(
  () => messageModule.ensureMvuRuntimeReady(200),
  /Type mismatch: expected object schema/,
  'non-transient MUV errors must not be hidden by the worldbook retry',
);
globalThis.getVariables = stableGetVariables;
messageModule.getCurrentMessageVariables();
await messageModule.updateCurrentMessageVariablesWith(value => value);
messageModule.insertOrAssignCurrentMessageVariables({ stat_data: { battle: { statuses: [{ id: 'test' }] } } });

for (const [, option] of calls) {
  assert.equal(option.type, 'message');
  assert.equal(option.message_id, 42, 'every message variable operation must bind to its iframe floor');
}
const mergeCall = calls.find(([name]) => name === 'insertOrAssign');
assert.deepEqual(mergeCall[2], { stat_data: { battle: { statuses: [{ id: 'test' }] } } });
assert.ok(
  !Object.hasOwn(mergeCall[2], 'stat_data.battle.statuses'),
  'deep MUV writes must not use a dotted top-level key',
);

globalThis.getLastMessageId = () => 43;
assert.equal(messageModule.isCurrentMessageLatest(), false, 'older message iframes must be detected as history');
assert.throws(
  () => messageModule.updateCurrentMessageVariablesWith(value => value),
  /历史消息为只读状态/,
  'historical message snapshots must reject updates',
);
assert.throws(
  () => messageModule.insertOrAssignCurrentMessageVariables({ stat_data: {} }),
  /历史消息为只读状态/,
  'historical message snapshots must reject merges',
);
globalThis.getLastMessageId = () => 42;

// A first card import can spend more than the historical 8-second window in
// SillyTavern's embedded-worldbook confirmation dialog. The iframe must keep
// waiting and recover when the MUV global appears afterwards.
const stableMvu = globalThis.Mvu;
globalThis.Mvu = undefined;
globalThis.waitGlobalInitialized = async name => {
  assert.equal(name, 'Mvu');
};
setTimeout(() => {
  globalThis.Mvu = stableMvu;
}, 250);
assert.ok(
  messageModule.MVU_INITIALIZATION_TIMEOUT_MS > 8000,
  'the production MUV budget must cover delayed first-import confirmation',
);
await messageModule.ensureMvuRuntimeReady({ mvuTimeoutMs: 1000, battleDataTimeoutMs: 1000 });
assert.equal(globalThis.Mvu, stableMvu, 'delayed MUV initialization must resume without a page refresh');
delete globalThis.waitGlobalInitialized;
globalThis.Mvu = undefined;
setTimeout(() => {
  globalThis.Mvu = stableMvu;
}, 100);
await messageModule.ensureMvuRuntimeReady({ mvuTimeoutMs: 1000, battleDataTimeoutMs: 1000 });
assert.equal(globalThis.Mvu, stableMvu, 'MUV polling must also work without the optional global notification hook');

const [startExported, updateExported, commonExported, exported] = await Promise.all(
  ['start', 'update', 'common', 'fish'].map(async name =>
    JSON.parse(await readFile(resolve(root, `dist/tavern/${name}-interface.json`), 'utf8')),
  ),
);
const characterRuntimeSource = await readFile(resolve(root, 'dist/tavern/character-runtime.js'), 'utf8');
const characterRuntimeManifest = JSON.parse(
  await readFile(resolve(root, 'dist/tavern/character-runtime-manifest.json'), 'utf8'),
);
assert.equal(startExported.scriptName, '开始模块');
assert.deepEqual(startExported.placement, [2]);
assert.equal(startExported.minDepth, 0);
assert.equal(startExported.maxDepth, 0);
assert.ok(new RegExp(startExported.findRegex).test('[开始游戏]'));
assert.ok(startExported.replaceString.startsWith('```\n<body>'));
assert.ok(startExported.replaceString.endsWith('</body>\n```'));
assert.ok(
  startExported.replaceString.length < 6000,
  'start interface must remain lightweight enough for Tavern Helper',
);
assert.ok(!startExported.replaceString.includes('jQuery v3'), 'start interface must not bundle jQuery');
assert.ok(/(?:const|var) view = "start"/.test(startExported.replaceString));
assert.ok(startExported.replaceString.includes("waitGlobalInitialized('MagicGirlWorld')"));
assert.equal(updateExported.scriptName, '变量更新展示');
assert.deepEqual(updateExported.placement, [2]);
assert.equal(updateExported.minDepth, 0);
assert.equal(updateExported.maxDepth, 2);
assert.ok(new RegExp(updateExported.findRegex).test('<UpdateVariable>_.set(\'status.time\', \'新时间\');</UpdateVariable>'));
assert.equal(
  new RegExp(updateExported.findRegex).test(
    '<UpdateVariable>_.set(\'status.time\', \'新时间\');</UpdateVariable>\n<StatusPlaceHolderImpl/>',
  ),
  false,
  'the standalone update view must not create an adjacent fenced iframe before the common view',
);
assert.ok(updateExported.replaceString.startsWith('```\n<body>'));
assert.ok(updateExported.replaceString.endsWith('</body>\n```'));
assert.ok(/(?:const|var) view = "update"/.test(updateExported.replaceString));
assert.ok(updateExported.replaceString.includes("waitGlobalInitialized('MagicGirlWorld')"));
assert.equal(commonExported.scriptName, '通用模块');
assert.deepEqual(commonExported.placement, [2]);
assert.equal(commonExported.minDepth, 0);
assert.equal(commonExported.maxDepth, 2);
const ordinaryResponse = 'normal story\n<StatusPlaceHolderImpl/>';
const battleResponse = 'battle lead-in\n<UpdateVariable></UpdateVariable>\n<BATTLE_START>';
const mvuPlaceholder = '<StatusPlaceHolderImpl/>';
const displayOrdinaryResponse = 'normal story\n<StatusPlaceHolderImpl/>';
const displayOrdinaryUpdateResponse =
  "normal story\n<UpdateVariable>_.set('status.time', '新时间');</UpdateVariable>\n<StatusPlaceHolderImpl/>";
const displayBattleResponse = 'battle lead-in\n<BATTLE_START>\n<StatusPlaceHolderImpl/>';
assert.ok(new RegExp(commonExported.findRegex).test(ordinaryResponse));
const displayOrdinaryUpdateMatch = new RegExp(commonExported.findRegex).exec(displayOrdinaryUpdateResponse);
assert.ok(displayOrdinaryUpdateMatch?.[0].includes('<UpdateVariable>'));
assert.ok(displayOrdinaryUpdateMatch?.[0].includes('<StatusPlaceHolderImpl/>'));
assert.ok(
  new RegExp(commonExported.findRegex).test(`normal story\n${mvuPlaceholder}`),
  'common regex must tolerate the display placeholder appended by MUV',
);
const displayOrdinaryMatch = new RegExp(commonExported.findRegex).exec(displayOrdinaryResponse);
assert.ok(displayOrdinaryMatch?.[0].includes('<StatusPlaceHolderImpl/>'));
assert.equal(displayOrdinaryMatch?.length, 1, 'common regex must not transport message data through capture groups');
assert.ok(!new RegExp(commonExported.findRegex).test('[开始游戏]'));
assert.ok(
  new RegExp(startExported.findRegex).test('[开始游戏]\n<StatusPlaceHolderImpl/>'),
  'start regex must consume the MUV placeholder so common status does not render a second iframe',
);
assert.equal(
  new RegExp(startExported.findRegex).test(
    '开场剧情\n<CHARACTER_INIT_PENDING>\n<UpdateVariable>_.set(\'status.time\', \'新时间\');</UpdateVariable>\n<StatusPlaceHolderImpl/>',
  ),
  false,
  'the initialization handoff on a generated assistant floor must never mount the start view',
);
assert.ok(!new RegExp(commonExported.findRegex).test('plain story without an MUV protocol marker'));
assert.ok(!new RegExp(commonExported.findRegex).test(battleResponse), 'common status bar must not precede battle UI');
assert.ok(
  commonExported.replaceString.startsWith('```\n<body>'),
  'common interface must replace only protocol markers with a lightweight shell',
);
assert.ok(commonExported.replaceString.length < 6000, 'common regex must contain only a lightweight runtime shell');
assert.ok(commonExported.replaceString.includes("waitGlobalInitialized('MagicGirlWorld')"));
assert.equal(commonExported.replaceString.match(/\$(?:\d+|<[^>]+>)/g), null);
for (const payload of [startExported, updateExported, commonExported, exported]) {
  const bootstrap = payload.replaceString.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';
  assert.doesNotMatch(bootstrap, /`|\?\.|</, 'Tavern bootstrap must not be reparsed as HTML/modern syntax');
}
const renderedCommonMessage = displayOrdinaryResponse.replace(
  new RegExp(commonExported.findRegex),
  commonExported.replaceString,
);
assert.ok(renderedCommonMessage.startsWith('normal story\n```\n<body>'));
assert.ok(!renderedCommonMessage.includes('<StatusPlaceHolderImpl/>'));
const renderedCommonUpdateMessage = displayOrdinaryUpdateResponse.replace(
  new RegExp(commonExported.findRegex),
  commonExported.replaceString,
);
assert.equal(
  (renderedCommonUpdateMessage.match(/```/g) || []).length,
  2,
  'a story update must render exactly one fenced interface document',
);
assert.ok(!renderedCommonUpdateMessage.includes('<UpdateVariable>'));
assert.ok(!renderedCommonUpdateMessage.includes('<StatusPlaceHolderImpl/>'));
const firstGeneratedTowerResponse =
  '简短开场剧情\n<CHARACTER_INIT_PENDING>\n<UpdateVariable>_.set(\'battle.cards\', []);</UpdateVariable>\n<StatusPlaceHolderImpl/>';
let renderedFirstGeneratedTowerResponse = firstGeneratedTowerResponse;
for (const payload of [startExported, updateExported, commonExported, exported]) {
  renderedFirstGeneratedTowerResponse = renderedFirstGeneratedTowerResponse.replace(
    new RegExp(payload.findRegex),
    payload.replaceString,
  );
}
assert.equal(
  (renderedFirstGeneratedTowerResponse.match(/```/g) || []).length,
  2,
  'the first generated tower response must contain exactly one fenced interface document',
);
assert.match(renderedFirstGeneratedTowerResponse, /(?:const|var) view = "common"/);
assert.doesNotMatch(renderedFirstGeneratedTowerResponse, /(?:const|var) view = "start"/);
assert.doesNotMatch(renderedFirstGeneratedTowerResponse, /CHARACTER_INIT_PENDING|StatusPlaceHolderImpl|UpdateVariable/);
assert.ok(!commonExported.replaceString.includes('class="story-text"'), 'common iframe must not wrap story text');
assert.ok(
  !commonExported.replaceString.includes('tab-navigation'),
  'common iframe must not restore removed page tabs',
);
assert.deepEqual(exported.placement, [2], 'battle regex must only target AI output');
assert.equal(exported.minDepth, 0);
assert.equal(exported.maxDepth, 0);
assert.equal(exported.disabled, false);
assert.equal(exported.markdownOnly, true);
assert.equal(exported.promptOnly, false);
assert.ok(new RegExp(exported.findRegex).test(battleResponse));
assert.equal(
  new RegExp(exported.findRegex).exec(battleResponse)?.[0].includes('<UpdateVariable>'),
  true,
  'battle regex must consume UpdateVariable together with the battle marker to avoid adjacent fenced iframes',
);
assert.ok(
  new RegExp(exported.findRegex).test(`${battleResponse}\n${mvuPlaceholder}`),
  'battle regex must tolerate the display placeholder appended by MUV',
);
assert.ok(
  new RegExp(exported.findRegex).test(
    `battle lead-in\n<UpdateVariable></UpdateVariable>\n${mvuPlaceholder}\n<BATTLE_START>`,
  ),
  'battle regex must tolerate MUV placing its placeholder before the battle marker',
);
const displayBattleMatch = new RegExp(exported.findRegex).exec(displayBattleResponse);
assert.equal(displayBattleMatch?.length, 1, 'battle regex must not transport message data through capture groups');
assert.ok(!new RegExp(exported.findRegex).test(ordinaryResponse));
assert.ok(exported.replaceString.startsWith('```\n<body>'));
assert.ok(exported.replaceString.endsWith('</body>\n```'));
assert.ok(exported.replaceString.length < 6000, 'battle regex must contain only a lightweight runtime shell');
assert.ok(exported.replaceString.includes("waitGlobalInitialized('MagicGirlWorld')"));
assert.ok(
  characterRuntimeSource.includes('__magic_girl_world') && characterRuntimeSource.includes('battle_session'),
  'character runtime battle asset must persist a namespaced session in the current message',
);
assert.ok(
  !characterRuntimeSource.includes('fishRPG_gameState'),
  'character runtime battle asset must not use the removed character-wide game-state key',
);
assert.ok(
  !/<script\s+[^>]*src=/i.test(exported.replaceString),
  'release interface must not require external script files',
);
assert.ok(
  !/(?:from\s*|import\s*(?:\(\s*)?)["']https?:\/\//i.test(characterRuntimeSource),
  'default character runtime must not import view modules from the network',
);
assert.ok(!/<script\s+[^>]*src=/i.test(startExported.replaceString), 'start interface must be self-contained');
assert.ok(!/<script\s+[^>]*src=/i.test(updateExported.replaceString), 'update interface must be self-contained');
assert.ok(!/<script\s+[^>]*src=/i.test(commonExported.replaceString), 'common interface must be self-contained');
assert.equal(exported.replaceString.match(/\$(?:\d+|<[^>]+>)/g), null);
assert.ok(
  !/&(?!\s)(?:[a-zA-Z][a-zA-Z0-9]+|#\d+|#x[\da-fA-F]+);/.test(exported.replaceString),
  'HTML entities inside the bundled script must be encoded before Tavern Helper renders srcdoc',
);

const tavernRendered = displayBattleResponse.replace(new RegExp(exported.findRegex), exported.replaceString);
assert.ok(tavernRendered.startsWith('battle lead-in\n```\n<body>'));
assert.ok(!tavernRendered.includes('<BATTLE_START>'));

function extractFencedHtml(rendered) {
  const start = rendered.indexOf('```\n');
  const end = rendered.lastIndexOf('\n```');
  assert.ok(start >= 0 && end > start, 'fenced interface must contain one complete HTML code fence');
  return rendered.slice(start + 4, end);
}

const renderedDocument = parse(extractFencedHtml(exported.replaceString));
const allNodes = [];
const visit = node => {
  allNodes.push(node);
  node.childNodes?.forEach(visit);
};
visit(renderedDocument);
const renderedScripts = allNodes.filter(node => node.nodeName === 'script');
const runtimeLoading = allNodes.find(
  node =>
    node.nodeName === 'div' &&
    node.attrs?.some(
      attribute => attribute.name === 'class' && attribute.value.split(/\s+/).includes('mwg-runtime-loading'),
    ),
);
assert.equal(renderedScripts.length, 1, 'exported HTML shell must contain exactly one bootstrap script');
assert.ok(runtimeLoading, 'exported battle shell must preserve its bounded loading state');
const renderedScriptText = renderedScripts[0].childNodes?.map(node => node.value || '').join('') || '';
assert.doesNotMatch(
  renderedScriptText,
  /&(?:amp|lt|gt|quot|apos)(?=[^a-zA-Z0-9]|$)/i,
  'minified script identifiers must not form HTML entities after an ampersand operator',
);
assert.doesNotThrow(
  () => new vm.Script(renderedScriptText),
  'the final Tavern Helper battle script must remain valid classic JavaScript',
);

function inspectInterface(payload, substitutions = {}, fenced = true) {
  const rendered = payload.replaceString.replace(/\$(\d+)|\$<([^>]+)>/g, (match, index, name) => {
    const key = index || name;
    return Object.hasOwn(substitutions, key) ? substitutions[key] : match;
  });
  const document = parse(fenced ? extractFencedHtml(rendered) : rendered);
  const nodes = [];
  const visitNode = node => {
    nodes.push(node);
    node.childNodes?.forEach(visitNode);
  };
  visitNode(document);
  return nodes;
}

const startNodes = inspectInterface(startExported);
const updateNodes = inspectInterface(updateExported);
const commonNodes = inspectInterface(commonExported);
const hasClass = (nodes, className) =>
  nodes.some(node =>
    node.attrs?.some(attribute => attribute.name === 'class' && attribute.value.split(/\s+/).includes(className)),
  );
const countClass = (nodes, className) =>
  nodes.filter(node =>
    node.attrs?.some(attribute => attribute.name === 'class' && attribute.value.split(/\s+/).includes(className)),
  ).length;
const hasId = (nodes, id) => nodes.some(node => node.attrs?.some(attribute => attribute.name === 'id' && attribute.value === id));
assert.equal(startNodes.filter(node => node.nodeName === 'script').length, 1);
assert.ok(hasClass(startNodes, 'mwg-runtime-loading'), 'start regex must render a lightweight loading shell');
assert.equal(countClass(startNodes, 'mwg-runtime-loading'), 1, 'start regex must render exactly one loading shell');
assert.equal(startNodes.filter(node => node.nodeName === 'body').length, 1, 'start regex must render exactly one body');
assert.equal(updateNodes.filter(node => node.nodeName === 'script').length, 1);
assert.ok(hasClass(updateNodes, 'mwg-runtime-loading'), 'update regex must render a lightweight loading shell');
assert.ok(
  characterRuntimeSource.includes('magical-girl-creator') &&
    characterRuntimeSource.includes('create-character-btn') &&
    characterRuntimeSource.includes('validation-message') &&
    !characterRuntimeSource.includes('start-game-btn'),
  'character runtime must carry the complete start view instead of the regex shell',
);
assert.equal(commonNodes.filter(node => node.nodeName === 'script').length, 1);
assert.ok(hasClass(commonNodes, 'mwg-runtime-loading'), 'common regex must render a lightweight loading shell');
assert.ok(!hasId(commonNodes, 'mwg-options-source'), 'common shell must not carry captured message data');
assert.ok(!hasClass(commonNodes, 'story-text'), 'native story text must not be duplicated inside the status bar');
assert.ok(characterRuntimeSource.includes('删卡失败：未找到所选卡牌'));
assert.ok(characterRuntimeSource.includes('经验值异常：单次升级次数超过安全上限'));
assert.equal(characterRuntimeManifest.spec, 'mwg.tavern-runtime/v1');
assert.equal(characterRuntimeManifest.cardVersion, releaseConfig.cardVersion);
assert.doesNotThrow(() => new vm.Script(characterRuntimeSource), 'character runtime must be valid classic JavaScript');
assert.ok(
  characterRuntimeSource.includes("getVariables?.({ type: 'global' })") &&
    characterRuntimeSource.includes('extra_analysis') &&
    characterRuntimeSource.includes('COMMAND_PARSED'),
  'character runtime must follow MVU global extra-analysis lifecycle and capture the parsed update block',
);

const cardArgumentIndex = process.argv.indexOf('--card');
const patchedCardPath = cardArgumentIndex >= 0 && process.argv[cardArgumentIndex + 1]
  ? resolve(process.argv[cardArgumentIndex + 1])
  : resolve(root, '魔法少女世界.png');
const patchedChunks = extractPngChunks(new Uint8Array(await readFile(patchedCardPath)));
const patchedMetadata = patchedChunks
  .filter(chunk => chunk.name === 'tEXt')
  .map(chunk => PNGtext.decode(chunk.data))
  .find(chunk => chunk.keyword.toLowerCase() === 'ccv3');
assert.ok(patchedMetadata, 'patched card must contain ccv3 metadata');
const patchedCard = JSON.parse(Buffer.from(patchedMetadata.text, 'base64').toString('utf8'));
const patchedExtensions = patchedCard.data.extensions;
assert.equal(
  patchedExtensions.magic_girl_world?.design_assistant_scope,
  'mwg.design-assistant-card/v1',
  'patched card must opt into the external design assistant explicitly',
);
assert.equal(patchedExtensions.magic_girl_world?.card_version, releaseConfig.cardVersion);
assert.equal(patchedCard.name, releaseConfig.characterName);
assert.equal(patchedCard.data.name, releaseConfig.characterName);
assert.equal(patchedCard.data.character_version, releaseConfig.cardVersion);
assert.equal(
  patchedCard.data.creator_notes,
  '剧情模式可直接开始游玩；角色卡已内置世界书、MVU 变量框架与交互界面。爬塔模式需要另行安装 0.3.3 或更高版本的“魔法少女世界设计辅助器”扩展。',
  'patched card creator notes must describe the embedded current architecture',
);
assert.equal(
  patchedCard.data.first_mes,
  '[开始游戏]\n[剧情模式开场]',
  'patched card first_mes must contain the story opening marker without a Markdown fence',
);
assert.deepEqual(
  patchedCard.data.alternate_greetings,
  ['[开始游戏]\n[爬塔模式开场]'],
  'patched card must expose tower mode as an alternate first-message greeting',
);
assert.equal(patchedExtensions.regex_scripts.some(script => script.scriptName === '去除变量'), false);
assert.equal(patchedExtensions.regex_scripts.length, 7, 'update display must replace, not duplicate, the old removal regex');
for (const payload of [startExported, updateExported, commonExported, exported]) {
  const matchingRegexes = patchedExtensions.regex_scripts.filter(script => script.scriptName === payload.scriptName);
  assert.equal(matchingRegexes.length, 1, `patched card must contain exactly one ${payload.scriptName} regex`);
  assert.equal(matchingRegexes[0].findRegex, payload.findRegex);
  assert.equal(matchingRegexes[0].replaceString, payload.replaceString);
  assert.deepEqual(matchingRegexes[0].placement, payload.placement);
  assert.equal(matchingRegexes[0].minDepth, payload.minDepth);
  assert.equal(matchingRegexes[0].maxDepth, payload.maxDepth);
}
assert.ok(!Object.hasOwn(patchedExtensions, 'TavernHelper_scripts'), 'patched card must not use removed script storage');
assert.ok(
  !Object.hasOwn(patchedExtensions, 'TavernHelper_characterScriptVariables'),
  'patched card must not use removed character variable storage',
);
const patchedMvuScripts = patchedExtensions.tavern_helper.scripts.filter(
  entry => entry?.type === 'script' && entry.content?.includes('MagicalAstrogy/MagVarUpdate'),
);
assert.equal(patchedMvuScripts.length, 1, 'patched card must contain exactly one MUV script');
assert.ok(
  patchedMvuScripts[0].content.includes(`@${releaseConfig.mvuVersion}/`),
  'patched card must pin the configured MUV release',
);
assert.equal(patchedMvuScripts[0].button?.enabled, true, 'patched card must enable the MUV button group');
assert.equal(
  patchedMvuScripts[0].button?.buttons?.filter(button => button?.name === '重试额外模型解析' && button.visible === true)
    .length,
  1,
  'patched card must expose the real extra-model retry action instead of only the local reparse action',
);
assert.ok(
  patchedMvuScripts[0].content.includes(`__MAGIC_GIRL_WORLD_MVU_LOADER__`) &&
    patchedMvuScripts[0].content.includes(expectedWorldbookName) &&
    patchedMvuScripts[0].content.includes('getLorebookEntries'),
  'patched card must gate the MUV import until its embedded worldbook is readable',
);
assert.ok(
  patchedMvuScripts[0].content.includes("e.兼容假流式=true") &&
    patchedMvuScripts[0].content.includes("e.模型来源='与插头相同'") &&
    patchedMvuScripts[0].content.includes("e.破限方案='使用内置破限'") &&
    patchedMvuScripts[0].content.includes("e.其他预设名称=''") &&
    patchedMvuScripts[0].content.includes('e.关闭thinking=false') &&
    patchedMvuScripts[0].content.includes('e.随机头部=false') &&
    patchedMvuScripts[0].content.includes("e.应答格式='聊天消息'") &&
    patchedMvuScripts[0].content.includes("e.请求方式='依次请求，失败后重试'") &&
    patchedMvuScripts[0].content.includes('e.max_chat_history=2') &&
    patchedMvuScripts[0].content.includes('e.请求次数=2') &&
    patchedMvuScripts[0].content.includes('e.最大回复token数=20000') &&
    patchedMvuScripts[0].content.includes("e.世界书条目白名单正则='^\\\\[mvu_update\\\\]'") &&
    patchedMvuScripts[0].content.includes('已开启默认不兼容假流式=true') &&
    patchedMvuScripts[0].content.includes('魔法少女世界额外模型默认版本'),
  'the card loader must apply the unsupported-by-character-override extra-model defaults once',
);
assert.ok(
  !patchedMvuScripts[0].content.includes('__MAGIC_GIRL_WORLD_GENERATE_RAW_MONITOR__') &&
    !patchedMvuScripts[0].content.includes('g.generateRaw='),
  'the card loader must not monkey-patch Tavern Helper generation functions',
);
assert.ok(
  patchedMvuScripts[0].content.includes('g[k]?.promise') &&
    patchedMvuScripts[0].content.includes("lastError:''") &&
    !patchedMvuScripts[0].content.includes('g[k]=true'),
  'patched card must reuse one observable MUV loader promise instead of a write-only boolean flag',
);
assert.ok(
  patchedMvuScripts[0].content.includes("presetMode:'builtin'") &&
    !patchedMvuScripts[0].content.includes('getPreset') &&
    !patchedMvuScripts[0].content.includes('wrappedGetPreset') &&
    !patchedMvuScripts[0].content.includes('魔法少女世界卡内变量预设'),
  'patched card must use MVU built-in jailbreak without touching SillyTavern presets',
);
assert.ok(
  !Object.hasOwn(patchedExtensions.tavern_helper.variables || {}, 'battle_result'),
  'patched card must not ship stale battle state',
);
const patchedCharacterRuntimes = patchedExtensions.tavern_helper.scripts.filter(
  entry =>
    entry?.type === 'script' &&
    entry.id === `magic-girl-world-runtime-${releaseConfig.cardVersion.replace(/[^a-z0-9]+/gi, '-')}`,
);
assert.equal(patchedCharacterRuntimes.length, 1, 'patched card must contain exactly one Magic Girl World runtime');
assert.equal(patchedCharacterRuntimes[0].name, '魔法少女世界运行时');
assert.equal(patchedCharacterRuntimes[0].enabled, true);
assert.equal(patchedCharacterRuntimes[0].content, characterRuntimeSource);

const worldbookManifest = JSON.parse(await readFile(resolve(root, 'worldbook_new/manifest.json'), 'utf8'));
const worldbookEntryConfig = JSON.parse(await readFile(resolve(root, 'worldbook_new/entry-config.json'), 'utf8'));
const patchedWorldbookEntries = patchedCard.data.character_book?.entries || [];
assert.equal(
  patchedWorldbookEntries.length,
  Object.keys(worldbookManifest).length,
  'patched card world-book must contain only entries declared by the current manifest',
);
assert.equal(
  patchedCard.data.character_book?.name,
  expectedWorldbookName,
  'patched card must use a versioned world-book name so SillyTavern does not reuse an old schema cache',
);
assert.equal(
  patchedExtensions.world,
  expectedWorldbookName,
  'patched card linked world-book must match the embedded versioned world-book name',
);
for (const [entryName, sourceName] of Object.entries(worldbookManifest)) {
  const config = worldbookEntryConfig[entryName] || {};
  const expectedComment = typeof config.comment === 'string' ? config.comment : entryName;
  const matchingEntries = patchedWorldbookEntries.filter(entry => {
    const comment = entry.name || entry.comment;
    const canonical = value => String(value || '').replace(/\[mvu_(?:plot|update)\]/gi, '').trim();
    return comment === expectedComment || canonical(comment) === canonical(entryName);
  });
  assert.equal(matchingEntries.length, 1, `patched card must contain one ${entryName} world-book entry`);
  assert.equal(
    matchingEntries[0].content,
    await readFile(resolve(root, 'worldbook_new', sourceName), 'utf8'),
    `${entryName} must be synchronized from worldbook_new/${sourceName}`,
  );
  for (const field of ['constant', 'keys', 'secondary_keys', 'enabled', 'selective', 'use_regex']) {
    if (Object.hasOwn(config, field)) {
      assert.deepEqual(
        matchingEntries[0][field],
        config[field],
        `${entryName}.${field} must match worldbook_new/entry-config.json`,
      );
    }
  }
  if (worldbookEntryConfig[entryName]?.extensions) {
    for (const [field, expected] of Object.entries(worldbookEntryConfig[entryName].extensions)) {
      assert.deepEqual(
        matchingEntries[0].extensions?.[field],
        expected,
        `${entryName}.extensions.${field} must match worldbook_new/entry-config.json`,
      );
    }
  }
  if (!Object.hasOwn(worldbookEntryConfig[entryName]?.extensions || {}, 'group')) {
    assert.equal(
      matchingEntries[0].extensions?.group,
      '',
      `${entryName} must not inherit an unrelated world-book selection group`,
    );
    assert.equal(
      matchingEntries[0].extensions?.group_override,
      false,
      `${entryName} must not inherit group override from the source-card template`,
    );
  }
  assert.equal(
    matchingEntries[0].insertion_order,
    Object.keys(worldbookManifest).indexOf(entryName),
    `${entryName} must follow manifest order`,
  );
}

execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--missing-host'], { stdio: 'inherit' });
console.log('Tavern Helper + MUV contract passed.');
