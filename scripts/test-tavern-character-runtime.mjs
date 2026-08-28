import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { parseFragment } from 'parse5';

const releaseConfig = JSON.parse(await readFile('release.config.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/tavern/character-runtime-manifest.json', 'utf8'));
const runtimeSource = await readFile('dist/tavern/character-runtime.js', 'utf8');
const interfacePayloads = Object.fromEntries(
  await Promise.all(
    ['start', 'common', 'fish', 'update'].map(async name => [
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
assert.match(runtimeSource, /class="mwg-tool-orb"/, 'settings must use an icon-only floating orb');
assert.match(runtimeSource, /class="mwg-settings-sheet"/, 'general settings must have its own sheet');
assert.match(runtimeSource, /class="mwg-mvu-panel"/, 'MVU progress must have an independent panel');
assert.match(runtimeSource, /data-mwg-monitor-setting="showMvuWindow"/);
assert.match(runtimeSource, /data-mwg-monitor-loading-title>正在生成变量/);
assert.match(runtimeSource, /setPointerCapture/);
assert.match(runtimeSource, /orbPosition/);
for (const productionInteractionToken of [
  'card-drag-slot',
  'pointercancel',
  'mwg:play-card',
  'requestFullscreen',
  '100vw',
  '2147483000',
  'mwg-fullscreen-active',
]) {
  assert.ok(
    runtimeSource.includes(productionInteractionToken),
    `exported character runtime must include ${productionInteractionToken}`,
  );
}
assert.match(
  runtimeSource,
  /if \(destroyed\)\s*\{?\s*return;/,
  'stale runtime callbacks must become inert after replacement',
);
assert.doesNotMatch(runtimeSource, /mwg-monitor-launcher/, 'the old text-wrapped settings button must stay removed');

let sharedName = '';
let sharedRuntime;
let readinessOptions;
let chatMessageOptions;
let beforeMessageUpdateListener;
let variableUpdateStartedListener;
let commandParsedListener;
let variableUpdateEndedListener;
let globalExtraAnalysis = false;
const intervalCallbacks = [];
const clearedIntervals = [];
const context = {
  console: { info() {}, warn() {}, error() {} },
  window: {
    parent: {
      Mvu: {
        events: {
          BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
          VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
          COMMAND_PARSED: 'mag_command_parsed',
          VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
        },
        getMvuData() {},
        replaceMvuData() {},
      },
    },
  },
  getVariables(options) {
    if (options?.type === 'global') return { extra_analysis: globalExtraAnalysis };
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
    if (eventName === 'mag_variable_update_started') variableUpdateStartedListener = listener;
    if (eventName === 'mag_command_parsed') commandParsedListener = listener;
    if (eventName === 'mag_variable_update_ended') variableUpdateEndedListener = listener;
  },
  setInterval(callback) {
    intervalCallbacks.push(callback);
    return intervalCallbacks.length;
  },
  clearInterval(intervalId) {
    clearedIntervals.push(intervalId);
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
assert.deepEqual(Array.from(sharedRuntime.getDiagnostics().views), ['start', 'common', 'fish', 'update']);
await sharedRuntime.waitForMessageReady(7);
assert.equal(readinessOptions.type, 'message');
assert.equal(readinessOptions.message_id, 7);
assert.equal(sharedRuntime.getMessageText(7), '纯剧情正文');
assert.equal(chatMessageOptions, 7);
assert.equal(typeof beforeMessageUpdateListener, 'function');
assert.equal(typeof variableUpdateStartedListener, 'function');
assert.equal(typeof commandParsedListener, 'function');
assert.equal(typeof variableUpdateEndedListener, 'function');
assert.equal(typeof context.MagicGirlWorldMvuMonitor?.begin, 'function');
assert.deepEqual(JSON.parse(JSON.stringify(context.MagicGirlWorldMvuMonitor.getSettings())), {
  showMvuWindow: true,
});
assert.doesNotThrow(() => {
  globalExtraAnalysis = true;
  intervalCallbacks.forEach(callback => callback());
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().phase, 'generating');
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().open, true);

  globalExtraAnalysis = false;
  intervalCallbacks.forEach(callback => callback());
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().phase, 'applying');

  variableUpdateStartedListener();
  commandParsedListener(
    {},
    [],
    '剧情正文\n\n<UpdateVariable><Analysis>Update.</Analysis>\n_.set(\'status.time\', \'old\', \'new\');\n</UpdateVariable>',
  );
  assert.equal(
    context.MagicGirlWorldMvuMonitor.getSnapshot().output,
    '当前时间：old → new',
    'MVU COMMAND_PARSED must expose a natural-language change summary instead of raw commands',
  );
  context.MagicGirlWorldMvuMonitor.success();
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().phase, 'success');
  assert.ok(context.MagicGirlWorldMvuMonitor.getSnapshot().finishedAt > 0);
  assert.ok(clearedIntervals.length > 0, 'the elapsed timer must stop when the second-stage update succeeds');
});
assert.doesNotThrow(() => {
  context.MagicGirlWorldMvuMonitor.begin({ generationId: 'reverse-event-order' });
  variableUpdateEndedListener({ stat_data: { battle: { cards: [] } } });
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().phase, 'success');
  commandParsedListener(
    {},
    [],
    '<UpdateVariable><Analysis>Update.</Analysis>\n_.set(\'status.time\', \'old\', \'new\');\n</UpdateVariable>',
  );
  assert.equal(
    context.MagicGirlWorldMvuMonitor.getSnapshot().phase,
    'success',
    'late COMMAND_PARSED must not move an already-completed update back to applying',
  );
});
assert.doesNotThrow(() => {
  context.MagicGirlWorldMvuMonitor.begin({ generationId: 'extra-test' });
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().phase, 'generating');
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().open, true);
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().settingsVisible, false);
  context.MagicGirlWorldMvuMonitor.stream('<UpdateVariable>test</UpdateVariable>', 'extra-test');
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().output, '', 'partial output stays hidden while generating');
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().pendingOutput, '<UpdateVariable>test</UpdateVariable>');
  context.MagicGirlWorldMvuMonitor.complete(
    '<UpdateVariable>\n<Analysis>Update.</Analysis>\n_.set(\'status.time\', \'旧时间\', \'新时间\');\n_.assign(\'battle.cards\', {"id":"new_card","name":"新卡"});\n</UpdateVariable>',
    'extra-test',
  );
  assert.equal(context.MagicGirlWorldMvuMonitor.getSnapshot().output, '当前时间：旧时间 → 新时间\n卡牌：新增 新卡');
  variableUpdateStartedListener();
});
assert.doesNotThrow(() => {
  context.MagicGirlWorldMvuMonitor.begin({ generationId: 'zero-value-summary' });
  context.MagicGirlWorldMvuMonitor.complete(
    '<UpdateVariable><Analysis>Update.</Analysis>\n_.set(\'battle.exp\', 5, 0);\n</UpdateVariable>',
    'zero-value-summary',
  );
  assert.equal(
    context.MagicGirlWorldMvuMonitor.getSnapshot().output,
    '经验：5 → 0',
    'numeric zero must not be summarized as an empty value',
  );
});

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

const settlementBefore = {
  stat_data: {
    status: { time: '旧时间', location: '旧地点', inventory: ['保留物品'], permanent_status: [] },
    battle: {
      core: { emoji: '✨', hp: 0, max_hp: 100, lust: 0, max_lust: 100 },
      level: 1,
      exp: 25,
      cards: [{ id: 'strike', name: '攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 10, effects: { damage: 6 } }],
      artifacts: [{ id: 'keepsake', name: '护符' }],
      items: [{ id: 'potion', name: '药剂', count: 1 }],
      statuses: [],
      player_abilities: [],
      player_status_effects: [],
      player_lust_effect: { name: '共鸣' },
      enemy: { name: '', actions: [], hp: 0, max_hp: 0 },
    },
    reward: {
      card: [],
      artifact: [],
      item: [],
      limits: {},
      request: { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'defeat', penalty: true, enemy: { name: '积水童' } },
    },
  },
};
const settlementAfter = JSON.parse(JSON.stringify(settlementBefore));
settlementAfter.stat_data.battle.core.hp = 100;
settlementAfter.stat_data.battle.enemy = { name: '积水童', hp: 34, max_hp: 34, actions: [{ name: '水击' }] };
settlementAfter.stat_data.battle.items = [];
settlementAfter.stat_data.status.inventory = [];
settlementAfter.stat_data.battle.cards.push({ id: 'water_curse', name: '湿冷诅咒', type: 'Curse', quantity: 1 });
settlementAfter.stat_data.battle.artifacts.push({ id: 'water_relic', name: '浸水护符' });
settlementAfter.stat_data.status.permanent_status.push({ id: 'water_mark', name: '水纹印记' });
settlementAfter.stat_data.reward.request = null;
variableUpdateEndedListener(settlementAfter, settlementBefore);
assert.equal(settlementAfter.stat_data.battle.core.hp, 0);
assert.equal(settlementAfter.stat_data.battle.enemy.name, '');
assert.equal(
  JSON.stringify(settlementAfter.stat_data.battle.items),
  JSON.stringify(settlementBefore.stat_data.battle.items),
  'settled consumables must be restored by value across the runtime VM boundary',
);
assert.deepEqual(settlementAfter.stat_data.status.inventory, []);
assert.equal(settlementAfter.stat_data.battle.cards.length, 2);
assert.equal(settlementAfter.stat_data.battle.artifacts.length, 2);
assert.equal(settlementAfter.stat_data.status.permanent_status.length, 1);
assert.equal(settlementAfter.stat_data.reward.request, null);

const firstTurnVariablesBeforeUpdate = { stat_data: { battle: { cards: [] } } };
const incompleteFirstTurn = {
  message_content: '石甲山魈扑向玩家。\n<BATTLE_PENDING>',
  variables: {
    stat_data: {
      battle: {
        core: { emoji: '🧙', hp: 100, max_hp: 100, lust: 0, max_lust: 100 },
        cards: [
          { id: 'strike', name: '斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 6 } },
          { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 5 } },
        ],
        artifacts: [],
        items: [],
        player_lust_effect: { name: '满溢', effects: { damage: 5 } },
        level: 1,
        enemy: { name: '石甲山魈', actions: [{ name: '扑击', effects: { damage: 8 } }] },
      },
    },
  },
};
variableUpdateEndedListener(incompleteFirstTurn.variables, firstTurnVariablesBeforeUpdate);
beforeMessageUpdateListener(incompleteFirstTurn);
assert.equal(
  incompleteFirstTurn.message_content,
  '石甲山魈扑向玩家。\n<BATTLE_PENDING>',
  'an empty pre-update deck must require complete first-turn resources even when the plot model omitted the init marker',
);

const completeFirstTurn = JSON.parse(JSON.stringify(incompleteFirstTurn));
completeFirstTurn.variables.stat_data.battle.artifacts = [
  { id: 'stone', name: '护石', trigger: 'battle_start', effects: { block: 2 } },
];
completeFirstTurn.variables.stat_data.battle.items = [
  { id: 'tonic', name: '药剂', count: 1, effects: { heal: 10 } },
];
variableUpdateEndedListener(completeFirstTurn.variables, firstTurnVariablesBeforeUpdate);
beforeMessageUpdateListener(completeFirstTurn);
assert.equal(
  completeFirstTurn.message_content,
  '石甲山魈扑向玩家。\n\n<BATTLE_START>',
  'a complete first-turn update must pass the runtime gate without relying on CHARACTER_INIT_PENDING',
);

const completedInitializationWithoutBattle = JSON.parse(JSON.stringify(completeFirstTurn));
completedInitializationWithoutBattle.message_content = '墨染在据点整理好自己的行装。\n<CHARACTER_INIT_PENDING>';
completedInitializationWithoutBattle.variables.stat_data.battle.enemy = { name: '', actions: [] };
variableUpdateEndedListener(completedInitializationWithoutBattle.variables, firstTurnVariablesBeforeUpdate);
beforeMessageUpdateListener(completedInitializationWithoutBattle);
assert.equal(
  completedInitializationWithoutBattle.message_content,
  '墨染在据点整理好自己的行装。',
  'a completed non-battle initialization must consume its one-shot marker so later turns cannot reinitialize the deck',
);

const expandedCompleteFirstTurn = JSON.parse(JSON.stringify(completeFirstTurn));
expandedCompleteFirstTurn.message_content = '石甲山魈扑向玩家。\n<BATTLE_PENDING>';
expandedCompleteFirstTurn.variables.stat_data.battle.cards.forEach(card => {
  card.quantity = 7;
});
variableUpdateEndedListener(expandedCompleteFirstTurn.variables, firstTurnVariablesBeforeUpdate);
beforeMessageUpdateListener(expandedCompleteFirstTurn);
assert.equal(
  expandedCompleteFirstTurn.message_content,
  '石甲山魈扑向玩家。\n\n<BATTLE_START>',
  'a legal initial deck above 13 total copies must remain initialized and start battle',
);

const inferredBattleStart = JSON.parse(JSON.stringify(completeFirstTurn));
inferredBattleStart.message_content = '石甲山魈已经扑到面前，战斗一触即发。';
variableUpdateEndedListener(inferredBattleStart.variables, {
  stat_data: {
    battle: {
      cards: [],
      enemy: { name: '', actions: [] },
    },
  },
});
beforeMessageUpdateListener(inferredBattleStart);
assert.equal(
  inferredBattleStart.message_content,
  '石甲山魈已经扑到面前，战斗一触即发。\n\n<BATTLE_START>',
  'a newly registered playable enemy must start battle even when the plot model omitted BATTLE_PENDING',
);

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
        core: { emoji: '🧙', hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
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

const fullWidthPending = {
  message_content: '敌人已经挥拳袭来。\n〈BATTLE_PENDING〉',
  variables: pendingWithEnemy.variables,
};
beforeMessageUpdateListener(fullWidthPending);
assert.equal(
  fullWidthPending.message_content,
  '敌人已经挥拳袭来。\n\n<BATTLE_START>',
  'runtime must canonicalize a model-written full-width handoff marker',
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
  assert.ok(Buffer.byteLength(asset.script, 'utf8') > 10000, `${view} script must remain a non-trivial inline asset`);
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
  assert.equal(
    payload.maxDepth,
    view === 'common' || view === 'update' ? 2 : 0,
    `${view} regex must use its configured history window`,
  );
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
