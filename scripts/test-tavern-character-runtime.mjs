import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { parseFragment } from 'parse5';

const releaseConfig = JSON.parse(await readFile('release.config.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/tavern/character-runtime-manifest.json', 'utf8'));
const runtimeSource = await readFile('dist/tavern/character-runtime.js', 'utf8');
const interfacePayloads = Object.fromEntries(
  await Promise.all(
    ['start', 'common', 'fish'].map(async name => [
      name,
      JSON.parse(await readFile(`dist/tavern/${name}-interface.json`, 'utf8')),
    ]),
  ),
);

assert.equal(manifest.spec, 'mwg.tavern-runtime/v1');
assert.equal(manifest.cardVersion, releaseConfig.cardVersion);
assert.equal('generatedAt' in manifest, false, 'runtime metadata must remain reproducible');
assert.equal(manifest.runtimeBytes, Buffer.byteLength(runtimeSource, 'utf8'));
assert.doesNotMatch(runtimeSource, /__MWG_(?:VIEW_ASSETS|BUILD_INFO)__/);
assert.doesNotMatch(runtimeSource, /<\/script/i);
assert.doesNotThrow(() => new vm.Script(runtimeSource), 'character runtime must be valid classic JavaScript');

let sharedName = '';
let sharedRuntime;
let readinessOptions;
let chatMessageOptions;
const context = {
  console: { info() {}, error() {} },
  window: {},
  Mvu: { getMvuData() {}, replaceMvuData() {} },
  getVariables(options) {
    readinessOptions = options;
    return { stat_data: { battle: {} } };
  },
  replaceVariables() {},
  updateVariablesWith() {},
  insertOrAssignVariables() {},
  getCurrentMessageId() {
    return 7;
  },
  getLastMessageId() {
    return 7;
  },
  getTavernHelperVersion() {
    return '3.4.17';
  },
  getChatMessages(messageId) {
    chatMessageOptions = messageId;
    return [{ message: '<Options><Option>continue</Option></Options>' }];
  },
  initializeGlobal(name, value) {
    sharedName = name;
    sharedRuntime = value;
  },
  $(target) {
    if (typeof target === 'function') target();
    return { on() {} };
  },
};
context.globalThis = context;
vm.runInNewContext(runtimeSource, context);

assert.equal(sharedName, 'MagicGirlWorld');
assert.equal(sharedRuntime.spec, 'mwg.tavern-runtime/v1');
assert.equal(sharedRuntime.version, releaseConfig.cardVersion);
assert.deepEqual(Array.from(sharedRuntime.getDiagnostics().views), ['start', 'common', 'fish']);
await sharedRuntime.waitForMessageReady(7);
assert.equal(readinessOptions.type, 'message');
assert.equal(readinessOptions.message_id, 7);
assert.equal(sharedRuntime.getMessageText(7), '<Options><Option>continue</Option></Options>');
assert.equal(chatMessageOptions, 7);

function collectNodes(node, output = []) {
  output.push(node);
  node.childNodes?.forEach(child => collectNodes(child, output));
  if (node.content) collectNodes(node.content, output);
  return output;
}

const expectedRoots = { start: 'magical-girl-creator', common: 'mwg-statusbar', fish: 'card-game-container' };
for (const [view, rootClass] of Object.entries(expectedRoots)) {
  const asset = sharedRuntime.getViewAsset(view);
  assert.ok(asset.title);
  assert.ok(asset.bodyHtml.length > 1000);
  assert.ok(asset.styles.length > 1000);
  assert.ok(asset.script.length > 10000);
  assert.doesNotThrow(() => new vm.Script(asset.script), `${view} asset must remain valid classic JavaScript`);
  const nodes = collectNodes(parseFragment(asset.bodyHtml));
  assert.ok(
    nodes.some(node =>
      node.attrs?.some(attribute => attribute.name === 'class' && attribute.value.split(/\s+/).includes(rootClass)),
    ),
    `${view} asset must preserve .${rootClass}`,
  );
  assert.equal(
    nodes.filter(node => node.nodeName === 'script').length,
    0,
    `${view} body asset must not duplicate scripts`,
  );
}

const startBootstrap = interfacePayloads.start.replaceString;
assert.match(
  startBootstrap,
  /view === ['"]start['"][\s\S]*messageId === null \|\| messageId === 0/,
  'start view must be restricted to the first assistant message floor',
);
assert.match(startBootstrap, /dataset\.mwgMountedView/);

assert.match(interfacePayloads.common.replaceString, /\[0, 1, 2\]\.indexOf\(latestMessageId - messageId\)/);
assert.match(interfacePayloads.common.replaceString, /recent-only/);
assert.match(interfacePayloads.fish.replaceString, /messageId === latestMessageId/);
assert.match(interfacePayloads.fish.replaceString, /latest-only/);

assert.equal((sharedRuntime.getViewAsset('common').bodyHtml.match(/\$2/g) || []).length, 0);
assert.throws(() => sharedRuntime.getViewAsset('unknown'), /未知的魔法少女世界视图/);

for (const [view, payload] of Object.entries(interfacePayloads)) {
  assert.ok(payload.replaceString.length < 10000, `${view} regex shell must stay lightweight`);
  assert.equal(payload.minDepth, 0, `${view} regex must only run on the latest message floor`);
  assert.equal(payload.maxDepth, view === 'common' ? 2 : 0, `${view} regex must use its configured history window`);
  assert.match(payload.replaceString, /waitGlobalInitialized\('MagicGirlWorld'\)/);
  assert.match(
    payload.replaceString,
    new RegExp(`expectedVersion = ["']${releaseConfig.cardVersion.replaceAll('.', '\\.')}["']`),
  );
  assert.match(payload.replaceString, new RegExp(`(?:const|var) view = ["']${view}["']`));
  const scriptSource = payload.replaceString.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';
  assert.doesNotMatch(scriptSource, /`|\?\.|</, `${view} bootstrap must survive Tavern Helper reparsing`);
  assert.doesNotMatch(payload.replaceString, /<script\s+[^>]*src=/i);
}

console.log('Character runtime publishes versioned start/common/fish assets behind lightweight Tavern regex shells.');
