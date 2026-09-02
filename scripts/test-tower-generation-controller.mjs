import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { DesignAssistantController } = require(resolve('src/sillytavern-extension/controller.ts'));
const {
  DESIGN_ASSISTANT_CARD_SCOPE,
  DESIGN_ASSISTANT_EXTENSION_ID,
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
  TOWER_ARCHIVE_METADATA_KEY,
} = require(resolve('src/sillytavern-extension/types.ts'));
const { TowerGenerationCancelledError } = require(resolve('src/sillytavern-extension/towerGenerationQueue.ts'));
const { completeRunNode, createRunState, enterRunNode } = require(resolve('src/game-core/runState.ts'));
const towerContent = require(resolve('src/game-core/towerContentState.ts'));
const towerState = require(resolve('src/runtime/towerStateAdapter.ts'));
const towerOpening = require(resolve('src/runtime/towerOpeningAdapter.ts'));

class FakeEvents {
  listeners = new Map();

  on(event, listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter(value => value !== listener));
  }

  async emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) await listener(...args);
  }
}

const scopedCharacter = {
  data: {
    extensions: {
      magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE },
    },
  },
};
const events = new FakeEvents();
const context = {
  chatId: 'tower-chat',
  chat: [{ mes: 'user' }, { mes: 'assistant' }, { mes: 'assistant-latest' }],
  characterId: 0,
  groupId: null,
  characters: [scopedCharacter],
  extensionSettings: {
    [DESIGN_ASSISTANT_EXTENSION_ID]: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS, enabled: false },
  },
  saveSettingsDebounced() {},
  chatMetadata: {},
  saveMetadataDebounced() {},
  eventSource: events,
  eventTypes: {
    GENERATE_AFTER_DATA: 'generate_after_data',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_CHANGED: 'chat_id_changed',
  },
};

function prepareTowerNode(seed, activeBattle = false, requestIndex = 0, kindOverride = null) {
  const stat = {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    battle: {
      core: { emoji: '🧙', hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
      cards: [
        { id: 'strike', name: '攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
        { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
      ],
      statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [],
      player_lust_effect: { name: '反击', effects: { damage: 8 } },
      enemy: null, enemies: [],
    },
    run: createRunState({ seed }),
  };
  const candidates = stat.run.map.nodes.filter(node => node.act === stat.run.act);
  const preferredCandidates = kindOverride
    ? candidates.filter(node => node.kind === kindOverride)
    : candidates.filter(node => ['battle', 'elite', 'boss'].includes(node.kind));
  const node = preferredCandidates[requestIndex % preferredCandidates.length] || candidates[requestIndex % candidates.length];
  const queued = towerContent.queueTowerNodeContent(stat.run.nodeContent, node.id, stat.run.stateRevision);
  stat.run = { ...stat.run, nodeContent: queued.store };
  const claimed = towerState.claimTowerGenerationInStat(stat, node.id, queued.envelope.requestId).request;
  return {
    variables: {
      stat_data: stat,
      ...(activeBattle ? { __magic_girl_world: { battle_session: { id: `battle-${seed}` } } } : {}),
    },
    request: claimed,
  };
}

function validNodeResponse(request) {
  return nodeResponseWithEnemy(request, {
    id: 'test_enemy', name: '测试敌人', emoji: '👾', hp: 45, max_hp: 45, lust: 0, max_lust: 100,
    actions: [{ id: 'hit', name: '试探', weight: 1, effects: { damage: 6 } }],
    abilities: [], status_effects: [], action_mode: 'random', action_config: {},
    lust_effect: { name: '失衡追击', effects: { damage: 5 } },
  });
}

function nodeResponseWithEnemy(request, enemy) {
  const cards = ['cut', 'guard', 'cycle'].map((suffix, index) => ({
    id: `${request.nodeId}_${suffix}`,
    name: `节点奖励${index + 1}`,
    type: index === 0 ? 'Attack' : 'Skill',
    rarity: request.kind === 'boss' ? 'Rare' : 'Common',
    cost: 1,
    quantity: 1,
    effects: index === 0 ? { damage: 7 } : index === 1 ? { block: 7 } : { draw: 1 },
  }));
  const artifacts = request.kind === 'boss'
    ? [0, 1, 2].map(index => ({
      id: `${request.nodeId}_relic_${index}`,
      name: `首领遗物${index + 1}`,
      rarity: 'Rare',
      trigger: { on: 'battle_start', effects: { block: index + 1 } },
    }))
    : request.kind === 'elite'
      ? [{
        id: `${request.nodeId}_relic`,
        name: '精英遗物',
        rarity: 'Uncommon',
        trigger: { on: 'battle_start', effects: { block: 2 } },
      }]
      : [];
  const items = request.kind === 'battle'
    ? [{ id: `${request.nodeId}_salve`, name: '节点药剂', count: 1, effects: { heal: 6 } }]
    : [];
  return `<TOWER_NODE_RESULT>${JSON.stringify({
    spec: 'mwg.tower-node-result/v1',
    node_id: request.nodeId,
    request_id: request.requestId,
    based_on_revision: request.revision,
    kind: request.kind,
    title: '道路遭遇',
    narrative: '短暂的敌意在前方凝聚。',
    payload: { battle: { enemy } },
    reward: { card: cards, artifact: artifacts, item: items },
  })}</TOWER_NODE_RESULT>`;
}

function eventNodeResponse(request, includeEffects) {
  const card = {
    id: `${request.nodeId}_orbit_leap`,
    name: '轨道跃迁',
    type: 'Skill',
    rarity: 'Common',
    cost: 0,
    quantity: 1,
    description: '借星轨残影抽牌并保护自己。',
    ...(includeEffects ? { effects: { draw: 1, block: 4 } } : {}),
  };
  return `<TOWER_NODE_RESULT>${JSON.stringify({
    spec: 'mwg.tower-node-result/v1',
    node_id: request.nodeId,
    request_id: request.requestId,
    based_on_revision: request.revision,
    kind: request.kind,
    title: '失控星象的低语',
    narrative: '赤道仪残骸间传来低沉的星轨回响。',
    payload: { event: { choices: [
      {
        id: 'trace',
        label: '循迹深入',
        outcome: {
          outcome: 'cleared',
          hp: -3,
          reward: { cards: [card], limits: { cards: 1 } },
        },
      },
      { id: 'leave', label: '离开', outcome: { outcome: 'escaped' } },
    ] } },
  })}</TOWER_NODE_RESULT>`;
}

function validOpeningResponse(request) {
  return `<TOWER_OPENING_RESULT>${JSON.stringify({
    spec: 'mwg.tower-opening-result/v1',
    request_id: request.requestId,
    based_on_revision: request.revision,
    title: '旅途开始',
    narrative: '某个与世界相符的存在在旅途起点等待。',
    choices: [
      { id: 'gift', label: '接受馈赠', outcome: { reward: {} } },
      { id: 'trade', label: '承担代价', outcome: { hp: -5, reward: {} } },
    ],
  })}</TOWER_OPENING_RESULT>`;
}

let variables = {
  stat_data: {
    game_mode: 'story',
    game_mode_lock: { schemaVersion: 1, mode: 'story' },
    battle: { cards: [] },
  },
};
const calls = [];
let generatedText = '';
let narrativeText = '';
let generationError = null;
let internalEventError = null;
let pendingReject = null;
let pendingResolve = null;
let pendingMode = false;
const towerPorts = {
  currentChatId: () => context.chatId,
  createChatMessages: async (messages, options) => calls.push(['create', structuredClone(messages), options]),
  generate: async config => {
    calls.push(['generate', config]);
    if (pendingMode) return new Promise((resolvePending, reject) => {
      pendingResolve = () => resolvePending(typeof generatedText === 'function' ? generatedText(config) : generatedText);
      pendingReject = reject;
    });
    if (generationError) throw generationError;
    return typeof generatedText === 'function' ? generatedText(config) : generatedText;
  },
  generateNarrative: async config => {
    calls.push(['narrative', config]);
    if (generationError) throw generationError;
    return typeof narrativeText === 'function' ? narrativeText(config) : narrativeText;
  },
  stopGenerationById: generationId => {
    calls.push(['stop', generationId]);
    pendingReject?.(new TowerGenerationCancelledError());
    return true;
  },
  emitInternalEvent: async (name, payload) => {
    calls.push(['event', name, payload]);
    if (internalEventError) throw internalEventError;
  },
};

const statuses = [];
const completed = [];
const failed = [];
const previousMonitor = globalThis.MagicGirlWorldMvuMonitor;
globalThis.MagicGirlWorldMvuMonitor = {
  receiveTowerGenerationStatus: status => statuses.push(status),
  receiveTowerGenerationCompleted: payload => completed.push(payload),
  receiveTowerGenerationFailed: payload => failed.push(payload),
};

const mvu = {
  getMvuData: () => variables,
  replaceMvuData: async (next, options) => {
    calls.push(['replace', structuredClone(next), options]);
    variables = structuredClone(next);
  },
  isDuringExtraAnalysis: () => false,
};
const controller = new DesignAssistantController({
  context: () => context,
  mvu: () => mvu,
  now: () => 24680,
  notify() {},
}, undefined, towerPorts, { towerCoordinator: false });
controller.activate();
assert.deepEqual(controller.getCapabilities(), {
  spec: 'mwg.design-assistant/v1',
  version: '0.3.1',
  towerGeneration: true,
  towerCoordinator: true,
  towerArchive: true,
  persistentMvuRepair: true,
  singleFloorStart: true,
});

const noOpRequest = {
  nodeId: 'act-1-floor-1-col-2',
  requestId: 'request-1',
  basedOnRevision: 0,
  kind: 'battle',
  prompt: '只生成这个可达节点',
};

// Story mode is an exact no-op: no model, message, MVU or bridge mutation.
assert.equal(await controller.requestTowerGeneration(noOpRequest), null);
assert.equal(calls.length, 0);
assert.equal(statuses.length, 0);
assert.equal(completed.length, 0);
assert.equal(failed.length, 0);

// Generate and commit while a battle iframe is active. No chat floor may be
// created during play. This focused test later invokes the low-level archive
// primitive directly; a coordinator may do that only at run end/explicit exit.
const prepared = prepareTowerNode(20260830, true);
variables = prepared.variables;
generatedText = validNodeResponse(prepared.request);
const bridgeRequest = {
  chatId: 'spoofed-chat-id',
  nodeId: prepared.request.nodeId,
  requestId: prepared.request.requestId,
  basedOnRevision: prepared.request.revision,
  kind: prepared.request.kind,
  prompt: '只生成这个可达节点',
};
const result = await controller.requestTowerGeneration(bridgeRequest);
assert.match(result.response, /TOWER_NODE_RESULT/);
assert.deepEqual(calls.map(call => call[0]), ['generate', 'replace', 'event']);
assert.equal(calls.some(call => call[0] === 'create'), false, 'active play must not append a floor');
assert.equal(calls[0][1].user_input, bridgeRequest.prompt);
assert.equal(calls[0][1].should_silence, true);
assert.equal(calls[0][1].max_chat_history, 0);
assert.equal(calls[0][1].json_schema.name, 'mwg_tower_battle_result');
assert.deepEqual(calls[1][2], { type: 'message', message_id: 2 });
assert.equal(variables.stat_data.run.nodeContent[prepared.request.nodeId].phase, 'ready');
assert.equal(completed.length, 1);
assert.equal(completed[0].chatId, 'tower-chat', 'iframe cannot spoof chat scope');
assert.equal(completed[0].mvuData.stat_data.run.nodeContent[prepared.request.nodeId].phase, 'ready');
assert.ok(calls.findIndex(call => call[0] === 'replace') < calls.findIndex(call => call[0] === 'event'));
assert.equal(
  context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY],
  undefined,
  'committed node state is authoritative; request/response text is not copied into chat metadata',
);

// A delayed iframe may still hold a structurally valid but older whole-run
// snapshot. Revision monotonicity is the final guard against that snapshot
// replacing newer progress on the same message.
const originalCurrentRevision = variables.stat_data.run.stateRevision;
variables.stat_data.run.stateRevision = Math.max(5, Number(originalCurrentRevision) || 0);
const currentRevision = variables.stat_data.run.stateRevision;
const staleRevisionData = structuredClone(variables);
staleRevisionData.stat_data.run.stateRevision = currentRevision - 1;
const replacesBeforeStaleRevision = calls.filter(call => call[0] === 'replace').length;
await assert.rejects(
  controller.replaceLatestMvuData(staleRevisionData, 'tower-chat', 2),
  error => error instanceof TowerGenerationCancelledError && /stale tower state revision/.test(error.message),
);
assert.equal(
  calls.filter(call => call[0] === 'replace').length,
  replacesBeforeStaleRevision,
  'an older run revision must never reach MVU replace',
);
variables.stat_data.run.stateRevision = originalCurrentRevision;
assert.equal(await controller.persistTowerGeneration(bridgeRequest), false, 'battle session blocks persistence');
assert.equal(calls.some(call => call[0] === 'create'), false);

delete variables.__magic_girl_world;
assert.equal(await controller.persistTowerGeneration(bridgeRequest), true);
assert.equal(calls.some(call => call[0] === 'create'), false, 'single-floor play never appends hidden archive floors');
assert.equal(context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY], undefined);

const completedCallCount = calls.length;
const statusCount = statuses.length;
assert.equal((await controller.requestTowerGeneration(bridgeRequest)).generationId, result.generationId);
assert.equal(calls.length, completedCallCount, 'duplicate request must not repeat generation, commit or persistence');
assert.equal(statuses.length, statusCount);
assert.equal(completed.length, 1);

// The enemy is scored only after the first authored result exists. If bounded
// numeric calibration still cannot make it winnable, exactly one constrained
// repair request is allowed before the ready node is committed.
const repairCase = prepareTowerNode(20260836, false, 5);
variables = repairCase.variables;
const impossibleEnemy = {
  id: 'immortal_hunter', name: '不灭猎手', emoji: '🦾',
  hp: 1_000_000_000, max_hp: 1_000_000_000, lust: 0, max_lust: 100,
  description: '沿用剧情身份的压迫性猎手。',
  actions: [{ id: 'erase', name: '抹除', weight: 1, effects: { damage: '999' } }],
  abilities: [], status_effects: [], action_mode: 'random', action_config: {},
  lust_effect: { name: '追猎', effects: { damage: 9 } },
};
const repairedEnemy = {
  ...structuredClone(impossibleEnemy),
  hp: 58,
  max_hp: 58,
  actions: [{ id: 'erase', name: '抹除', weight: 1, effects: { damage: 7 } }],
};
generatedText = config => config.user_input.includes('[爬塔敌人可通关性修复]')
  ? nodeResponseWithEnemy(repairCase.request, repairedEnemy)
  : nodeResponseWithEnemy(repairCase.request, impossibleEnemy);
calls.length = 0;
await controller.requestTowerGeneration({
  nodeId: repairCase.request.nodeId,
  requestId: repairCase.request.requestId,
  basedOnRevision: repairCase.request.revision,
  kind: repairCase.request.kind,
  prompt: '生成需要反向评分的敌人',
});
const repairGenerateCalls = calls.filter(call => call[0] === 'generate');
assert.equal(repairGenerateCalls.length, 2, 'at most one model repair follows the authored enemy');
assert.match(repairGenerateCalls[1][1].user_input, /只修复 payload\.battle/);
assert.match(repairGenerateCalls[1][1].user_input, /保留敌人的剧情身份/);
const balancedContent = variables.stat_data.run.nodeContent[repairCase.request.nodeId].content;
assert.equal(balancedContent.program_balance.modelRepairUsed, true);
assert.equal(balancedContent.program_balance.winnableAtCurrentResources, true);
assert.equal(balancedContent.payload.battle.enemy.name, '不灭猎手');
assert.equal(balancedContent.payload.battle.enemy.actions[0].name, '抹除');
assert.equal(calls.filter(call => call[0] === 'replace').length, 1, 'only the final safe result is committed');

// A structurally incomplete enemy gets one isolated schema repair before any
// node content is committed. The repaired response keeps the original scope.
const structureCase = prepareTowerNode(20260838, false, 6);
variables = structureCase.variables;
const missingEffectsEnemy = {
  id: 'hollow_guard', name: '空壳守卫', emoji: '🗿', hp: 45, max_hp: 45, lust: 0, max_lust: 100,
  actions: [{ id: 'empty_swing', name: '空挥', weight: 1, description: '只有说明，没有效果。' }],
  abilities: [], status_effects: [], action_mode: 'random', action_config: {},
  lust_effect: { name: '震慑', effects: { damage: 5 } },
};
generatedText = config => config.user_input.includes('[爬塔后台节点结构修复]')
  ? validNodeResponse(structureCase.request)
  : nodeResponseWithEnemy(structureCase.request, missingEffectsEnemy);
calls.length = 0;
await controller.requestTowerGeneration({
  nodeId: structureCase.request.nodeId,
  requestId: structureCase.request.requestId,
  basedOnRevision: structureCase.request.revision,
  kind: structureCase.request.kind,
  prompt: '生成敌人行动结构',
});
const structureGenerateCalls = calls.filter(call => call[0] === 'generate');
assert.equal(structureGenerateCalls.length, 2, 'one structure repair follows an unusable authored result');
assert.match(structureGenerateCalls[1][1].user_input, /每个 action 必须有非空 name 和可执行 effects/);
assert.equal(variables.stat_data.run.nodeContent[structureCase.request.nodeId].phase, 'ready');
assert.equal(calls.filter(call => call[0] === 'replace').length, 1, 'only the repaired structure is committed');

// Optional event rewards are executable content too. A card described only in
// prose must be repaired during lookahead generation, not several floors later
// when the player clicks the already-ready event.
const eventRewardRepairCase = prepareTowerNode(20260839, false, 0, 'event');
variables = eventRewardRepairCase.variables;
generatedText = config => config.user_input.includes('[爬塔后台节点结构修复]')
  ? eventNodeResponse(eventRewardRepairCase.request, true)
  : eventNodeResponse(eventRewardRepairCase.request, false);
calls.length = 0;
await controller.requestTowerGeneration({
  nodeId: eventRewardRepairCase.request.nodeId,
  requestId: eventRewardRepairCase.request.requestId,
  basedOnRevision: eventRewardRepairCase.request.revision,
  kind: eventRewardRepairCase.request.kind,
  prompt: '生成带可选卡牌奖励的事件',
});
const eventRewardRepairCalls = calls.filter(call => call[0] === 'generate');
assert.equal(
  eventRewardRepairCalls.length,
  2,
  `invalid event rewards receive one bounded structure repair: ${JSON.stringify(eventRewardRepairCalls)}`,
);
assert.match(eventRewardRepairCalls[1][1].user_input, /必须提供浅层 effects/);
assert.equal(variables.stat_data.run.nodeContent[eventRewardRepairCase.request.nodeId].phase, 'ready');
assert.deepEqual(
  variables.stat_data.run.nodeContent[eventRewardRepairCase.request.nodeId]
    .content.payload.event.choices[0].outcome.reward.cards[0].effects,
  { draw: 1, block: 4 },
);
assert.equal(calls.filter(call => call[0] === 'replace').length, 1);

// A provider may repeat an incomplete reward once even after the first repair.
// The second bounded structure repair must receive the new error, explicitly
// add the missing candidates, and commit only the final complete node.
const repeatedRewardCase = prepareTowerNode(20260840, false, 7);
variables = repeatedRewardCase.variables;
const completeRepeatedReward = validNodeResponse(repeatedRewardCase.request);
const incompleteRepeatedReward = completeRepeatedReward.replace(
  /"card":\[(.*?)\],"artifact"/,
  (_match, cardsBody) => `"card":[${cardsBody.split('},{')[0]}}],"artifact"`,
);
let repeatedRewardRepairs = 0;
generatedText = config => {
  if (!config.user_input.includes('[爬塔后台节点结构修复]')) return incompleteRepeatedReward;
  repeatedRewardRepairs += 1;
  return repeatedRewardRepairs >= 2 ? completeRepeatedReward : incompleteRepeatedReward;
};
calls.length = 0;
await controller.requestTowerGeneration({
  nodeId: repeatedRewardCase.request.nodeId,
  requestId: repeatedRewardCase.request.requestId,
  basedOnRevision: repeatedRewardCase.request.revision,
  kind: repeatedRewardCase.request.kind,
  prompt: '生成奖励候选数量不足的节点',
});
const repeatedRewardGenerateCalls = calls.filter(call => call[0] === 'generate');
assert.equal(repeatedRewardGenerateCalls.length, 3, 'one authored result plus two bounded structure repairs');
assert.match(repeatedRewardGenerateCalls[1][1].user_input, /奖励候选数量不足/);
assert.match(repeatedRewardGenerateCalls[1][1].user_input, /新写不同 id、不同机制的候选补足/);
assert.equal(variables.stat_data.run.nodeContent[repeatedRewardCase.request.nodeId].phase, 'ready');
assert.equal(variables.stat_data.run.nodeContent[repeatedRewardCase.request.nodeId].reward.card.length, 3);
assert.equal(calls.filter(call => call[0] === 'replace').length, 1, 'incomplete repair attempts never reach MVU');

// A parser/contract failure never commits opaque content or emits an internal
// completion event, but it does safely move the exact in-flight request to
// failed so the UI cannot remain stuck in `generating`.
const invalid = prepareTowerNode(20260831, false, 1);
variables = invalid.variables;
generatedText = '<TOWER_NODE_RESULT>{"ready":true}</TOWER_NODE_RESULT>';
generationError = null;
calls.length = 0;
await assert.rejects(controller.requestTowerGeneration({
  nodeId: invalid.request.nodeId,
  requestId: invalid.request.requestId,
  basedOnRevision: invalid.request.revision,
  kind: invalid.request.kind,
  prompt: '返回了错误契约的节点',
}), /spec is invalid/);
assert.deepEqual(calls.map(call => call[0]), ['generate', 'generate', 'generate', 'replace']);
assert.equal(variables.stat_data.run.nodeContent[invalid.request.nodeId].phase, 'failed');
assert.equal(failed.at(-1).requestId, invalid.request.requestId);

// A model/API failure uses the failure adapter and atomically replaces latest
// MVU with only this request marked failed.
const broken = prepareTowerNode(20260832, false, 2);
variables = broken.variables;
generatedText = '';
generationError = new Error('模型接口暂时不可用');
calls.length = 0;
await assert.rejects(controller.requestTowerGeneration({
  nodeId: broken.request.nodeId,
  requestId: broken.request.requestId,
  basedOnRevision: broken.request.revision,
  kind: broken.request.kind,
  prompt: '生成失败节点',
  maxAttempts: 1,
}), /模型接口暂时不可用/);
assert.deepEqual(calls.map(call => call[0]), ['generate', 'replace']);
assert.equal(variables.stat_data.run.nodeContent[broken.request.nodeId].phase, 'failed');
assert.equal(failed.at(-1).mvuData.stat_data.run.nodeContent[broken.request.nodeId].phase, 'failed');

// Once latest MVU is successfully committed as ready, a downstream internal
// event delivery failure must not roll it back to failed.
const eventBroken = prepareTowerNode(20260835, false, 4);
variables = eventBroken.variables;
generationError = null;
internalEventError = new Error('内部事件监听器暂时不可用');
generatedText = validNodeResponse(eventBroken.request);
calls.length = 0;
await assert.rejects(controller.requestTowerGeneration({
  nodeId: eventBroken.request.nodeId,
  requestId: eventBroken.request.requestId,
  basedOnRevision: eventBroken.request.revision,
  kind: eventBroken.request.kind,
  prompt: '生成已成功但事件派发失败的节点',
}), /内部事件监听器暂时不可用/);
assert.deepEqual(calls.map(call => call[0]), ['generate', 'replace', 'event']);
assert.equal(variables.stat_data.run.nodeContent[eventBroken.request.nodeId].phase, 'ready');
assert.equal(failed.at(-1).requestId, eventBroken.request.requestId);
internalEventError = null;

// Opening generation follows the same parse -> MVU replace -> completion order.
const openingStat = {
  game_mode: 'tower',
  game_mode_lock: { schemaVersion: 1, mode: 'tower' },
  run: createRunState({ seed: 20260833 }),
};
const openingRequest = towerOpening.queueTowerOpeningInStat(openingStat).request;
towerOpening.claimTowerOpeningInStat(openingStat, openingRequest.requestId);
variables = { stat_data: openingStat };
generationError = null;
let openingStructureRepairs = 0;
const invalidOpeningResponse = validOpeningResponse(openingRequest).replace(
  '"reward":{}',
  '"reward":{"cards":"broken"}',
);
generatedText = config => {
  if (!config.user_input.includes('[爬塔开局馈赠结构修复]')) return invalidOpeningResponse;
  openingStructureRepairs += 1;
  return validOpeningResponse(openingRequest);
};
narrativeText = '旅途的引路者从朦胧光影中现身，将不同的馈赠摆在玩家面前。\n<UpdateVariable>_.set(\'status.time\', \'错误变量\');</UpdateVariable>';
calls.length = 0;
await controller.requestTowerGeneration({
  generationType: 'opening',
  requestId: openingRequest.requestId,
  revision: openingRequest.revision,
  prompt: '生成开局馈赠事件',
});
assert.equal(openingStructureRepairs, 1, 'an invalid opening reward receives one bounded structure repair');
assert.match(calls.filter(call => call[0] === 'generate')[1][1].user_input, /reward 只允许 cards、artifacts、items 数组/);
assert.deepEqual(calls.map(call => call[0]), ['generate', 'generate', 'replace', 'event']);
assert.equal(variables.stat_data.run.opening.phase, 'ready');
assert.equal(variables.stat_data.run.opening.narrativePhase, 'pending');
assert.equal(calls[0][1].json_schema.name, 'mwg_tower_opening_result');
for (let index = 0; index < 100 && variables.stat_data.run.opening.narrativePhase !== 'ready'; index += 1) {
  await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
}
assert.equal(variables.stat_data.run.opening.narrativePhase, 'ready');
assert.equal(variables.stat_data.run.opening.content.narrative_source, 'preset');
assert.match(variables.stat_data.run.opening.content.narrative, /引路者从朦胧光影中现身/);
assert.doesNotMatch(variables.stat_data.run.opening.content.narrative, /UpdateVariable|错误变量/);
const openingNarrativeCall = calls.find(call => call[0] === 'narrative');
assert.ok(openingNarrativeCall);
assert.equal(openingNarrativeCall[1].preset_name, 'in_use');
assert.equal(openingNarrativeCall[1].max_chat_history, 'all');
assert.equal('json_schema' in openingNarrativeCall[1], false);
assert.equal('ordered_prompts' in openingNarrativeCall[1], false);
assert.equal(calls.some(call => call[0] === 'create'), false);

// Active-node prose uses the player's current preset through the silent
// narrative port, keeps arbitrary prose length, strips accidental MVU blocks,
// and replaces only the still-active node without creating a Tavern floor.
const narrativeStart = createRunState({ seed: 20260839 });
const narrativeChoice = narrativeStart.choices[0];
const narrativeRun = enterRunNode(narrativeStart, narrativeChoice.id);
variables = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    status: { location: '测试高塔入口' },
    battle: {
      core: { emoji: '🧙', hp: 80, max_hp: 80, lust: 0, max_lust: 100 },
      cards: [], statuses: [], artifacts: [], items: [],
      enemy: null, enemies: [],
    },
    run: narrativeRun,
    run_node: {
      schemaVersion: 1,
      node_id: narrativeChoice.id,
      kind: narrativeChoice.kind,
      title: '雾中门扉',
      narrative: '备用情境摘要。',
      narrative_source: 'fallback',
      narrative_phase: 'pending',
      narrative_request_id: 'narrative-request-1',
    },
  },
};
narrativeText = '门扉在雾中缓缓开启。\n\n角色依照自己的步调向前。\n<UpdateVariable>_.set(\'status.time\', \'错误变量\');</UpdateVariable>';
generationError = null;
calls.length = 0;
const completedBeforeNarrative = completed.length;
assert.equal(controller.scheduleTowerGeneration('node-activated'), true);
for (let index = 0; index < 100 && variables.stat_data.run_node.narrative_phase !== 'ready'; index += 1) {
  await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
}
assert.equal(variables.stat_data.run_node.narrative_phase, 'ready');
assert.equal(variables.stat_data.run_node.narrative_source, 'preset');
assert.match(variables.stat_data.run_node.narrative, /角色依照自己的步调向前/);
assert.doesNotMatch(variables.stat_data.run_node.narrative, /UpdateVariable|错误变量/);
const narrativeCall = calls.find(call => call[0] === 'narrative');
assert.ok(narrativeCall);
assert.equal(narrativeCall[1].preset_name, 'in_use');
assert.equal(narrativeCall[1].should_stream, true);
assert.equal(narrativeCall[1].max_chat_history, 'all');
assert.equal('json_schema' in narrativeCall[1], false);
assert.equal('ordered_prompts' in narrativeCall[1], false);
assert.equal(calls.some(call => call[0] === 'create'), false);
assert.equal(completed.length, completedBeforeNarrative + 1);
assert.equal(completed.at(-1).parsedResult.type, 'narrative');

// Even a valid tower lock is a no-op outside this character card.
context.characters = [{ data: { extensions: {} } }];
const callCountBeforeForeignCard = calls.length;
assert.equal(await controller.requestTowerGeneration({ ...noOpRequest, requestId: 'foreign' }), null);
assert.equal(calls.length, callCountBeforeForeignCard);
context.characters = [scopedCharacter];

// Adding another floor inside the same chat invalidates an older silent task.
// This is the real failure mode that used to let an old iframe overwrite a
// newer tower revision through MVU's transient `latest` alias.
const messageSwitching = prepareTowerNode(20260841, false, 9);
variables = messageSwitching.variables;
generatedText = validNodeResponse(messageSwitching.request);
pendingMode = true;
pendingReject = null;
pendingResolve = null;
calls.length = 0;
const sameChatPending = controller.requestTowerGeneration({
  nodeId: messageSwitching.request.nodeId,
  requestId: messageSwitching.request.requestId,
  basedOnRevision: messageSwitching.request.revision,
  kind: messageSwitching.request.kind,
  prompt: 'generate for the current concrete message only',
});
const sameChatOutcome = sameChatPending.catch(error => error);
for (let index = 0; index < 100 && !pendingResolve; index += 1) {
  await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
}
assert.ok(pendingResolve, `same-chat generation did not start: ${calls.map(call => call[0]).join(',')}`);
const replaceCountBeforeNewFloor = calls.filter(call => call[0] === 'replace').length;
context.chat.push({ mes: 'newer-assistant-floor' });
pendingResolve();
assert.ok(await sameChatOutcome instanceof TowerGenerationCancelledError);
assert.equal(
  calls.filter(call => call[0] === 'replace').length,
  replaceCountBeforeNewFloor,
  'a task bound to the previous message cannot write after a new floor appears',
);
context.chat.pop();
pendingMode = false;
pendingResolve = null;
pendingReject = null;

// CHAT_CHANGED cancels the precise old generation; no stale terminal bridge or
// MVU mutation is allowed to enter the replacement chat.
const switching = prepareTowerNode(20260834, false, 3);
variables = switching.variables;
pendingMode = true;
pendingReject = null;
pendingResolve = null;
calls.length = 0;
const pending = controller.requestTowerGeneration({
  nodeId: switching.request.nodeId,
  requestId: switching.request.requestId,
  basedOnRevision: switching.request.revision,
  kind: switching.request.kind,
  prompt: '生成下一层敌人',
});
const outcome = pending.catch(error => error);
while (!pendingReject) await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
const bridgeCountsBeforeSwitch = {
  status: statuses.length,
  completed: completed.length,
  failed: failed.length,
};
context.chatId = 'replacement-chat';
context.chatMetadata = {};
await events.emit('chat_id_changed');
assert.ok(await outcome instanceof TowerGenerationCancelledError);
assert.deepEqual(calls.map(call => call[0]), ['generate', 'stop']);
assert.equal(statuses.length, bridgeCountsBeforeSwitch.status);
assert.equal(completed.length, bridgeCountsBeforeSwitch.completed);
assert.equal(failed.length, bridgeCountsBeforeSwitch.failed);

controller.deactivate();

// A controller reload migrates away the obsolete prompt/response archive.
// The committed run state remains authoritative and terminal handling never
// appends hidden chat floors.
context.chatId = 'archive-chat';
context.characters = [scopedCharacter];
const terminalStart = createRunState({ seed: 20260837 });
const terminalRun = completeRunNode(
  enterRunNode(terminalStart, terminalStart.choices[0].id),
  { outcome: 'failed' },
);
variables = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    run: terminalRun,
    battle: { cards: [] },
  },
};
const archivedRecords = ['opening', 'node-a'].map((nodeId, index) => ({
  spec: 'mwg.tower-archive-record/v1',
  chatId: 'archive-chat',
  nodeId,
  requestId: `archive-request-${index}`,
  prompt: `归档请求 ${index}`,
  response: `归档响应 ${index}`,
  generationId: `archive-generation-${index}`,
}));
context.chatMetadata = {
  [TOWER_ARCHIVE_METADATA_KEY]: {
    spec: 'mwg.tower-archive-store/v1',
    chatId: 'archive-chat',
    records: structuredClone(archivedRecords),
  },
};
const archiveCreates = [];
const archiveController = new DesignAssistantController({
  context: () => context,
  mvu: () => mvu,
  now: () => 35791,
  notify() {},
}, undefined, {
  ...towerPorts,
  currentChatId: () => context.chatId,
  createChatMessages: async (messages, options) => {
    archiveCreates.push([structuredClone(messages), options]);
  },
}, { towerCoordinator: false });
archiveController.activate();
assert.equal(context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY], undefined, 'legacy archive is removed during activation');
assert.equal(await archiveController.archiveTowerRun(), 0);
assert.equal(archiveCreates.length, 0, 'terminal handling does not create hidden messages');
assert.equal(context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY], undefined);
assert.equal(await archiveController.archiveTowerRun(), 0, 'terminal archive is idempotent');
archiveController.deactivate();

// A page reload clears the in-memory lifecycle event, but the failed request
// remains authoritative in MVU. An empty retry request must recover the nearest
// reachable failed node from that save instead of requiring an event nodeId.
context.chatId = 'retry-chat';
context.chatMetadata = {};
context.characters = [scopedCharacter];
const persistedRetry = prepareTowerNode(20260841, false, 0);
towerState.failTowerGenerationInStat(persistedRetry.variables.stat_data, {
  nodeId: persistedRetry.request.nodeId,
  requestId: persistedRetry.request.requestId,
  revision: persistedRetry.request.revision,
  error: 'persisted generation failure',
});
variables = persistedRetry.variables;
generationError = null;
generatedText = () => {
  const run = variables.stat_data.run;
  const entry = Object.values(run.nodeContent).find(value => value?.phase === 'generating');
  const node = run.map.nodes.find(value => value.id === entry.nodeId);
  return validNodeResponse({
    nodeId: entry.nodeId,
    requestId: entry.requestId,
    revision: entry.basedOnRevision,
    kind: node.kind,
  });
};
calls.length = 0;
const restoredController = new DesignAssistantController({
  context: () => context,
  mvu: () => mvu,
  now: () => 24681,
  notify() {},
}, undefined, towerPorts);
restoredController.activate();
assert.equal(await restoredController.retryTowerGeneration({}), true);
assert.ok(
  ['queued', 'generating', 'ready'].includes(
    variables.stat_data.run.nodeContent[persistedRetry.request.nodeId].phase,
  ),
  'the persisted failed node must be requeued even without an in-memory event snapshot',
);
assert.equal(variables.stat_data.run.nodeContent[persistedRetry.request.nodeId].attempts, 2);
restoredController.deactivate();

// A failed opening must release every in-memory terminal cache before retrying.
// The second request receives a new id and really reaches the model again.
context.chatId = 'opening-retry-chat';
context.chatMetadata = {};
context.characters = [scopedCharacter];
pendingMode = false;
pendingResolve = null;
pendingReject = null;
const openingRetryBase = prepareTowerNode(20260902, false, 0).variables.stat_data.battle;
const openingRetryStat = {
  game_mode: 'tower',
  game_mode_lock: { schemaVersion: 1, mode: 'tower' },
  battle: structuredClone(openingRetryBase),
  run: createRunState({ seed: 20260902 }),
};
const firstOpening = towerOpening.queueTowerOpeningInStat(openingRetryStat).request;
towerOpening.claimTowerOpeningInStat(openingRetryStat, firstOpening.requestId);
variables = { stat_data: openingRetryStat };
generationError = new Error('first opening generation failed');
calls.length = 0;
const openingRetryController = new DesignAssistantController({
  context: () => context,
  mvu: () => mvu,
  now: () => 97531,
  notify() {},
}, undefined, towerPorts);
// Keep the coordinator dormant while creating the first terminal failure so
// it cannot race the explicit request below.
openingRetryController.active = true;
openingRetryController.towerChatId = context.chatId;
openingRetryController.towerGenerationHost.activateChat(context.chatId);
await assert.rejects(openingRetryController.requestTowerGeneration({
  generationType: 'opening',
  requestId: firstOpening.requestId,
  revision: firstOpening.revision,
  prompt: 'generate opening once and fail',
  maxAttempts: 1,
}), /first opening generation failed/);
assert.equal(variables.stat_data.run.opening.phase, 'failed');
assert.equal(variables.stat_data.run.opening.requestId, firstOpening.requestId);
const failedGenerationCount = calls.filter(call => call[0] === 'generate').length;

generationError = null;
generatedText = () => validOpeningResponse({
  requestId: variables.stat_data.run.opening.requestId,
  revision: variables.stat_data.run.opening.basedOnRevision,
});
narrativeText = '引路者重新整理了馈赠，让旅者再次选择。';
openingRetryController.towerCoordinator.activateChat(context.chatId);
assert.equal(await openingRetryController.retryTowerGeneration({ generationType: 'opening' }), true);
assert.notEqual(variables.stat_data.run.opening.requestId, firstOpening.requestId);
for (let index = 0; index < 300 && variables.stat_data.run.opening.phase !== 'ready'; index += 1) {
  await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
}
assert.equal(variables.stat_data.run.opening.phase, 'ready');
assert.ok(
  calls.filter(call => call[0] === 'generate').length > failedGenerationCount,
  'manual opening retry must perform another real model call',
);
openingRetryController.deactivate();

if (previousMonitor === undefined) delete globalThis.MagicGirlWorldMvuMonitor;
else globalThis.MagicGirlWorldMvuMonitor = previousMonitor;

const indexSource = await readFile(resolve('src/sillytavern-extension/index.ts'), 'utf8');
const controllerSource = await readFile(resolve('src/sillytavern-extension/controller.ts'), 'utf8');
assert.match(indexSource, /createGlobalTowerGenerationPorts/);
assert.match(indexSource, /new DesignAssistantController\([\s\S]*createGlobalTowerGenerationPorts\(\)/);
assert.match(controllerSource, /scheduleTowerGeneration\(reason = 'character-runtime'\)/);
assert.match(controllerSource, /this\.towerCoordinator\?\.schedule\(`runtime:\$\{normalizedReason\}`\)/);

console.log('Tower generation controller scope, MVU commit, deferred persistence, failure, opening, and cancellation tests passed.');
