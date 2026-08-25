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
let beforeMessageUpdateListener;
let variableUpdateEndedListener;
const context = {
  console: { info() {}, warn() {}, error() {} },
  window: {},
  Mvu: {
    events: {
      BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
      VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    },
    getMvuData() {},
    replaceMvuData() {},
  },
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
    return [{ message: '纯剧情正文' }];
  },
  eventOn(eventName, listener) {
    if (eventName === 'mag_before_message_update') beforeMessageUpdateListener = listener;
    if (eventName === 'mag_variable_update_ended') variableUpdateEndedListener = listener;
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
assert.equal(sharedRuntime.getMessageText(7), '纯剧情正文');
assert.equal(chatMessageOptions, 7);
assert.equal(typeof beforeMessageUpdateListener, 'function');
assert.equal(typeof variableUpdateEndedListener, 'function');

const misplacedCardVariables = {
  stat_data: {
    battle: {
      cards: [],
      player_abilities: [
        {
          id: 'sword_slash',
          name: '剑斩',
          type: 'Attack',
          rarity: 'Common',
          cost: 1,
          quantity: 5,
          effects: { damage: 6 },
        },
        { id: 'battle_focus', name: '战斗专注', trigger: 'turn_start', effects: { block: 2 } },
      ],
    },
  },
};
variableUpdateEndedListener(misplacedCardVariables);
assert.equal(misplacedCardVariables.stat_data.battle.cards.length, 1);
assert.equal(misplacedCardVariables.stat_data.battle.cards[0].id, 'sword_slash');
assert.equal(misplacedCardVariables.stat_data.battle.player_abilities.length, 1);
assert.equal(misplacedCardVariables.stat_data.battle.player_abilities[0].id, 'battle_focus');

const pendingWithoutEnemy = {
  message_content: '敌人逼近。\n<BATTLE_PENDING>',
  variables: { stat_data: { battle: { enemy: { name: '雾影魔', actions: [] } } } },
};
beforeMessageUpdateListener(pendingWithoutEnemy);
assert.equal(
  pendingWithoutEnemy.message_content,
  '敌人逼近。\n<BATTLE_PENDING>',
  'battle marker must stay pending until the extra model registers playable enemy data',
);

const pendingWithEnemy = {
  message_content: '雾影魔从喷泉中成形。\n<BATTLE_PENDING>',
  variables: {
    stat_data: {
      battle: {
        core: { hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
        cards: [
          { id: 'strike', name: '斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 6 } },
          { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 5 } },
        ],
        artifacts: [{ id: 'stone', name: '护石', trigger: 'battle_start', effects: { block: 2 } }],
        items: [{ id: 'tonic', name: '药剂', count: 1, effects: { heal: 5 } }],
        player_lust_effect: { name: '满溢', effects: { damage: 5 } },
        level: 1,
        enemy: { name: '雾影魔', actions: [{ name: '撕扯', effects: { damage: 8 } }] },
      },
    },
  },
};
beforeMessageUpdateListener(pendingWithEnemy);
assert.equal(
  pendingWithEnemy.message_content,
  '雾影魔从喷泉中成形。\n\n<BATTLE_START>',
  'battle UI must activate only after the MVU update event exposes valid enemy data',
);

const directStart = {
  message_content: '模型越权启动。\n<BATTLE_START>',
  variables: pendingWithEnemy.variables,
};
beforeMessageUpdateListener(directStart);
assert.equal(directStart.message_content, '模型越权启动。', 'AI-authored BATTLE_START must never bypass the runtime gate');

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
  assert.equal(asset.styles.includes('\uFEFF'), false, `${view} styles must not contain an embedded BOM`);
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
