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
const { recommendTowerBattleRewardBudget } = require(resolve('src/game-core/contentBudget.ts'));
const { createTowerEncounterPlan } = require(resolve('src/game-core/towerEncounterPlan.ts'));

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

function installMeasuredReviewEvaluator(target, seedCount = 6) {
  const seeds = Array.from({ length: seedCount }, (_, index) => 17 + index);
  const evaluation = {
    status: 'measured', seeds, decisionCoverage: 'bounded', engine: 'production-battle-runtime',
    trials: seeds.map(seed => ({ seed, policy: 'engine', outcome: 'victory', hpLost: 2, blocked: 1, turns: 3 })),
    policies: [{ policy: 'engine', completed: seedCount, wins: seedCount, winRate: 1, winRateInterval: [0.6, 1], medianTurns: 3, medianNetHpLost: 2 }],
    limitations: [],
  };
  target.encounterEvaluator = {
    measure: async () => ({
      spec: 'mwg.tower-build-measurement/v1', damageByTurn: [5, 6, 7, 7, 7], defensePerTurn: 2,
      maxHp: 80, status: 'measured', decisionCoverage: 'bounded', evidence: [],
    }),
    balance: async input => ({
      generatedBattle: structuredClone(input.generatedBattle), original: evaluation, evaluation,
      changedPaths: [], hpScale: 1, damageScale: 1, feedback: ['fixture requests one review'],
      needsReview: true, requiresRegeneration: false,
    }),
  };
}

function nodeResponseWithEnemy(request, enemy) {
  const plannedNode = variables?.stat_data?.run?.map?.nodes?.find(node => node.id === request.nodeId);
  const route = {
    ...request,
    kind: plannedNode?.kind || request.kind,
    act: plannedNode?.act || request.act,
    floor: plannedNode?.floor || request.floor,
    contentSeed: plannedNode?.contentSeed ?? request.contentSeed,
    rewardSeed: plannedNode?.rewardSeed || request.rewardSeed,
  };
  const budget = recommendTowerBattleRewardBudget(route);
  const cards = ['cut', 'guard', 'cycle'].map((suffix, index) => ({
    id: `${request.nodeId}_${suffix}`,
    name: `节点奖励${index + 1}`,
    type: index === 0 ? 'Attack' : 'Skill',
    rarity: budget.cards.slotRarities[index],
    cost: 1,
    quantity: 1,
    effects: index === 0 ? { damage: 7 } : index === 1 ? { block: 7 } : { draw: 1 },
  }));
  const artifacts = Array.from({length:budget.artifacts?.candidates || 0}, (_, index) => ({
      id: `${request.nodeId}_relic_${index}`,
      name: `首领遗物${index + 1}`,
      rarity: budget.artifacts.slotRarities[index],
      trigger: { on: 'battle_start', effects: { block: index + 1 } },
    }));
  const items = budget.items
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
    payload: { battle: { enemies: Array.from({ length: createTowerEncounterPlan({
      nodeId: route.nodeId, kind: route.kind, contentSeed: route.contentSeed, act: route.act, floor: route.floor,
    })?.enemyCount || 1 }, (_, index) => index === 0 ? enemy : {
      ...structuredClone(enemy), id: `${enemy.id}_${index + 1}`, name: `${enemy.name} ${index + 1}`,
    }) } },
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
      { id: 'prepare', label: '整备行装', outcome: { gold: 20 } },
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
const stateChanges = [];
const structuredProgress = [];
const monitorEvents = [];
const previousMonitor = globalThis.MagicGirlWorldMvuMonitor;
globalThis.MagicGirlWorldMvuMonitor = {
  receiveTowerStateChanged: scope => {
    assert.equal(scope.chatId, context.chatId, 'refresh belongs to the current chat');
    assert.ok(calls.some(call => call[0] === 'replace'), 'refresh follows authoritative persistence');
    stateChanges.push(structuredClone(scope));
  },
  receiveTowerGenerationStatus: status => statuses.push(status),
  beginStructuredOperation: input => {
    structuredProgress.push({ phase: 'begin', ...structuredClone(input) });
    monitorEvents.push({ type: 'begin', detail: input.detail });
  },
  applyStructuredOperation: input => {
    structuredProgress.push({ phase: 'applying', ...structuredClone(input) });
    monitorEvents.push({ type: 'applying', detail: input.detail });
  },
  receiveTowerGenerationCompleted: payload => {
    completed.push(payload);
    monitorEvents.push({ type: 'completed', requestId: payload.requestId });
  },
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
assert.deepEqual(controller.getTowerGenerationDiagnostics(), [], 'inactive controller does not expose metadata');
controller.activate();
assert.deepEqual(controller.getCapabilities(), {
  spec: 'mwg.design-assistant/v1',
  version: '0.3.5',
  towerGeneration: true,
  towerCoordinator: true,
  towerArchive: true,
  persistentMvuRepair: true,
  singleFloorStart: true,
  initialStartCancellation: true,
});
{
  const apply = globalThis.MagicGirlWorldMvuMonitor.applyStructuredOperation;
  globalThis.MagicGirlWorldMvuMonitor.applyStructuredOperation = () => { throw new Error('display observer failure'); };
  assert.doesNotThrow(() => controller.onStructuredRepairProgress({
    phase: 'applying', generationId: 'retained-draft', detail: '草稿已返回，正在解析与校验',
  }), 'monitor rendering is observational and cannot reject a returned draft');
  globalThis.MagicGirlWorldMvuMonitor.applyStructuredOperation = apply;
}

const noOpRequest = {
  nodeId: 'act-1-floor-1-col-2',
  requestId: 'request-1',
  basedOnRevision: 0,
  kind: 'battle',
  prompt: '只生成这个可达节点',
};

// Story mode is an exact no-op: no model, message, MVU or bridge mutation.
assert.equal(await controller.requestTowerGeneration(noOpRequest), null);
assert.deepEqual(controller.getTowerGenerationDiagnostics(), [], 'story mode is outside this diagnostic scope');
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
structuredProgress.length = 0;
monitorEvents.length = 0;
const bridgeRequest = {
  chatId: 'spoofed-chat-id',
  nodeId: prepared.request.nodeId,
  requestId: prepared.request.requestId,
  basedOnRevision: prepared.request.revision,
  kind: prepared.request.kind,
  prompt: '只生成这个可达节点',
};
const result = await controller.requestTowerGeneration(bridgeRequest);
assert.equal(controller.getTowerGenerationDiagnostics().at(-1).outcome, 'returned');
assert.equal(controller.getTowerGenerationDiagnostics().at(-1).stage, 'structured');
assert.doesNotMatch(JSON.stringify(controller.getTowerGenerationDiagnostics()), /只生成这个可达节点|TOWER_NODE_RESULT/);
assert.match(result.response, /TOWER_NODE_RESULT/);
assert.deepEqual(calls.map(call => call[0]), ['generate', 'replace', 'event']);
assert.equal(calls.some(call => call[0] === 'create'), false, 'active play must not append a floor');
assert.match(calls[0][1].user_input, new RegExp(`^${bridgeRequest.prompt}`));
assert.equal(calls[0][1].should_silence, true);
assert.equal(calls[0][1].max_chat_history, 0);
assert.equal(calls[0][1].json_schema.name, 'mwg_tower_battle_result');
assert.deepEqual(calls[1][2], { type: 'message', message_id: 2 });
assert.equal(variables.stat_data.run.nodeContent[prepared.request.nodeId].phase, 'ready');
assert.equal(completed.length, 1);
assert.equal(completed[0].chatId, 'tower-chat', 'iframe cannot spoof chat scope');
assert.equal(completed[0].mvuData.stat_data.run.nodeContent[prepared.request.nodeId].phase, 'ready');
assert.ok(calls.findIndex(call => call[0] === 'replace') < calls.findIndex(call => call[0] === 'event'));
const requiredProgress = [
  '正在本地测量战斗强度，无需 AI',
  '正在请求 AI 生成内容',
  'AI 内容已返回，正在校验游戏内容',
  '正在本地复测战斗强度',
  '校验完成，正在保存当前楼层',
  '当前楼层已保存，正在发布结果',
];
let requiredProgressCursor = 0;
for (const entry of structuredProgress) {
  if (entry.phase === 'begin') assert.equal(entry.autoOpen, false, 'background node progress must not auto-open the monitor');
  assert.equal(entry.generationId, `tower-task:${prepared.request.requestId}`);
  if (entry.detail === requiredProgress[requiredProgressCursor]) requiredProgressCursor += 1;
}
assert.equal(requiredProgressCursor, requiredProgress.length,
  'one parent operation shows measurement, AI request/return, local review, and durable save in order');
assert.equal(structuredProgress.filter(entry => entry.phase === 'begin').length, 1,
  'later phases update the same operation and cannot reopen a manually closed monitor');
assert.ok(
  monitorEvents.findIndex(entry => entry.detail === '当前楼层已保存，正在发布结果')
    < monitorEvents.findIndex(entry => entry.type === 'completed'),
  'completion is published only after the save progress is visible',
);
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

// The enemy is scored only after the first authored result exists. Numeric
// strength remains advisory and must never cause a rewrite or repair request.
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
generatedText = () => nodeResponseWithEnemy(repairCase.request, impossibleEnemy);
calls.length = 0;
await controller.requestTowerGeneration({
  nodeId: repairCase.request.nodeId,
  requestId: repairCase.request.requestId,
  basedOnRevision: repairCase.request.revision,
  kind: repairCase.request.kind,
  prompt: '生成需要反向评分的敌人',
});
const repairGenerateCalls = calls.filter(call => call[0] === 'generate');
assert.equal(repairGenerateCalls.length, 1, 'numeric strength must not trigger a model repair');
const balancedContent = variables.stat_data.run.nodeContent[repairCase.request.nodeId].content;
assert.equal(balancedContent.program_balance.modelRepairUsed, false);
assert.equal(balancedContent.program_balance.assessment, 'inconclusive');
assert.equal(balancedContent.program_balance.needsReview, true);
assert.equal(balancedContent.program_balance.resourceAssessment, 'not-assessed');
assert.equal(balancedContent.payload.battle.enemies[0].name, '不灭猎手');
assert.equal(balancedContent.payload.battle.enemies[0].actions[0].name, '抹除');
assert.equal(balancedContent.payload.battle.enemies[0].max_hp, 1_000_000_000);
assert.equal(calls.filter(call => call[0] === 'replace').length, 1, 'the authored executable result is committed once');

// The final publication gate reuses the semantic checks after advisory balance.
// This injected mutation is a regression probe, not a current balance behavior.
const postBalanceCase = prepareTowerNode(20260977, false, 3);
variables = postBalanceCase.variables;
const beforePostBalance = structuredClone(variables.stat_data.battle);
generatedText = validNodeResponse(postBalanceCase.request);
calls.length = 0;
const savedBalance = controller.balanceTowerNodeResult;
controller.balanceTowerNodeResult = async value => {
  const changed = structuredClone(value);
  changed.reward.card[0].description = '造成7点伤害；下一回合开始时造成7点伤害。';
  return changed;
};
try {
  await assert.rejects(controller.requestTowerGeneration({
    ...postBalanceCase.request, basedOnRevision: postBalanceCase.request.revision,
    prompt: 'publication gate probe', maxAttempts: 1,
  }), /(EXPLICIT_LITERAL_EFFECT_MISMATCH|字面规则修复必须完整实现)/);
  assert.equal(calls.filter(call => call[0] === 'generate').length, 1);
  assert.equal(variables.stat_data.run.nodeContent[postBalanceCase.request.nodeId].phase, 'failed');
  assert.equal(Object.hasOwn(variables.stat_data.run.nodeContent[postBalanceCase.request.nodeId], 'content'), false);
  assert.deepEqual(variables.stat_data.battle, beforePostBalance);
} finally { controller.balanceTowerNodeResult = savedBalance; }

// A transport retry, a structure repair, and a balance review all share one
// additional-request budget. The production controller must pass the consumed
// budget into the real balance branch, not merely annotate a parsed response.
const savedEncounterEvaluator = controller.encounterEvaluator;
try {
  installMeasuredReviewEvaluator(controller, 2);
  const previewOnlyCase = prepareTowerNode(20261030, false, 0);
  variables = previewOnlyCase.variables;
  calls.length = 0;
  generatedText = () => nodeResponseWithEnemy(previewOnlyCase.request, {
    id: 'preview_enemy', name: '预筛守卫', emoji: '👾', hp: 1, max_hp: 1, lust: 0, max_lust: 100,
    actions: [{ id: 'tap', name: '试探', weight: 1, effects: { damage: 1 } }],
    abilities: [], status_effects: [], action_mode: 'random', action_config: {},
    lust_effect: { name: '失衡追击', effects: { damage: 1 } },
  });
  await controller.requestTowerGeneration({
    ...previewOnlyCase.request, basedOnRevision: previewOnlyCase.request.revision,
    prompt: 'two paired seeds are preview evidence only', maxAttempts: 1,
  });
  assert.equal(calls.filter(call => call[0] === 'generate').length, 1,
    'two paired seeds must not request a balance-feedback model call');
  assert.equal(calls.some(call => call[0] === 'generate' && /程序战斗评估反馈/.test(call[1].user_input)), false);
  assert.match(
    variables.stat_data.run.nodeContent[previewOnlyCase.request.nodeId].content.program_balance.warnings.join('\n'),
    /仅有 2 个配对种子预筛/,
  );

  installMeasuredReviewEvaluator(controller);

  const retriedCase = prepareTowerNode(20261031, false, 0);
  variables = retriedCase.variables;
  calls.length = 0;
  let transportAttempts = 0;
  generatedText = () => {
    transportAttempts += 1;
    return transportAttempts === 1 ? '' : validNodeResponse(retriedCase.request);
  };
  await controller.requestTowerGeneration({
    ...retriedCase.request, basedOnRevision: retriedCase.request.revision,
    prompt: 'transport retry consumes the one extra request', maxAttempts: 2,
  });
  assert.equal(calls.filter(call => call[0] === 'generate').length, 2, 'an initial transport retry consumes the shared extra request');
  assert.equal(calls.some(call => call[0] === 'generate' && /程序战斗评估反馈/.test(call[1].user_input)), false,
    'additionalRequestsUsed from the initial host result blocks balance feedback');

  const structureBudgetCase = prepareTowerNode(20261032, false, 1);
  variables = structureBudgetCase.variables;
  calls.length = 0;
  const malformedEnemy = {
    id: 'missing_effect', name: '空招守卫', emoji: '🗿', hp: 45, max_hp: 45, lust: 0, max_lust: 100,
    actions: [{ id: 'empty', name: '空挥', weight: 1 }], abilities: [], status_effects: [], action_mode: 'random', action_config: {},
    lust_effect: { name: '威吓', effects: { damage: 4 } },
  };
  generatedText = config => config.user_input.includes('结构修复')
    ? validNodeResponse(structureBudgetCase.request)
    : nodeResponseWithEnemy(structureBudgetCase.request, malformedEnemy);
  await controller.requestTowerGeneration({
    ...structureBudgetCase.request, basedOnRevision: structureBudgetCase.request.revision,
    prompt: 'structure repair consumes the one extra request', maxAttempts: 1,
  });
  assert.equal(calls.filter(call => call[0] === 'generate').length, 2, 'one structure repair is the complete additional-request budget');
  assert.equal(calls.some(call => call[0] === 'generate' && /程序战斗评估反馈/.test(call[1].user_input)), false,
    'a completed structure repair blocks balance feedback');

  const batchBudgetCase = prepareTowerNode(20261034, false, 0);
  variables = batchBudgetCase.variables;
  const secondBatchNode = variables.stat_data.run.map.nodes.find(node => (
    node.id !== batchBudgetCase.request.nodeId && ['battle', 'elite', 'boss'].includes(node.kind)
  ));
  assert.ok(secondBatchNode, 'fixture needs a second battle node for the shared batch budget');
  const queuedBatchNode = towerContent.queueTowerNodeContent(
    variables.stat_data.run.nodeContent, secondBatchNode.id, variables.stat_data.run.stateRevision,
  );
  variables.stat_data.run.nodeContent = queuedBatchNode.store;
  const secondBatchRequest = towerState.claimTowerGenerationInStat(
    variables.stat_data, secondBatchNode.id, queuedBatchNode.envelope.requestId,
  ).request;
  const batchJobs = [batchBudgetCase.request, secondBatchRequest];
  const batchResponse = malformed => JSON.stringify({
    spec: 'mwg.tower-node-batch-result/v1', batch_id: 'budget-batch', based_on_revision: batchJobs[0].revision,
    results: batchJobs.map((job, index) => {
      const entry = JSON.parse(nodeResponseWithEnemy(job, {
        id: `batch_enemy_${index}`, name: `批量守卫${index + 1}`, emoji: '👾', hp: 40, max_hp: 40, lust: 0, max_lust: 100,
        actions: [{ id: 'hit', name: '挥击', weight: 1, effects: { damage: 6 } }], abilities: [], status_effects: [],
        action_mode: 'random', action_config: {}, lust_effect: { name: '追击', effects: { damage: 4 } },
      }).slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length));
      if (malformed && index === 0) delete entry.payload.battle.enemies[0].actions[0].effects;
      return entry;
    }),
  });
  calls.length = 0;
  structuredProgress.length = 0;
  generatedText = config => config.user_input.includes('批量节点结构修复') ? batchResponse(false) : batchResponse(true);
  await controller.requestTowerGeneration({
    generationType: 'batch', batchId: 'budget-batch', requestId: 'budget-batch',
    basedOnRevision: batchJobs[0].revision, jobs: batchJobs, prompt: 'batch structure repair consumes the one extra request', maxAttempts: 1,
  });
  assert.equal(calls.filter(call => call[0] === 'generate').length, 2, 'one batch structure repair consumes the shared extra request');
  assert.equal(calls.some(call => call[0] === 'generate' && /程序战斗评估反馈/.test(call[1].user_input)), false,
    'batch structure repair blocks feedback for every batch member');
  assert.deepEqual(
    structuredProgress.filter(entry => /正在本地复测战斗强度（第 \d+\/\d+ 项）/.test(entry.detail))
      .map(entry => [entry.generationId, entry.detail]),
    [
      [`tower-task:budget-batch`, '正在本地复测战斗强度（第 1/2 项）'],
      [`tower-task:budget-batch`, '正在本地复测战斗强度（第 2/2 项）'],
    ],
    'batch members report n/m against the batch parent operation',
  );

  const failingFeedbackBatch = prepareTowerNode(20261035, false, 0);
  variables = failingFeedbackBatch.variables;
  const secondFeedbackNode = variables.stat_data.run.map.nodes.find(node => (
    node.id !== failingFeedbackBatch.request.nodeId && ['battle', 'elite', 'boss'].includes(node.kind)
  ));
  assert.ok(secondFeedbackNode, 'fixture needs two battle members for failed-feedback budget ownership');
  const queuedFeedbackNode = towerContent.queueTowerNodeContent(
    variables.stat_data.run.nodeContent, secondFeedbackNode.id, variables.stat_data.run.stateRevision,
  );
  variables.stat_data.run.nodeContent = queuedFeedbackNode.store;
  const secondFeedbackRequest = towerState.claimTowerGenerationInStat(
    variables.stat_data, secondFeedbackNode.id, queuedFeedbackNode.envelope.requestId,
  ).request;
  const feedbackBatchJobs = [failingFeedbackBatch.request, secondFeedbackRequest];
  const feedbackBatchResponse = JSON.stringify({
    spec: 'mwg.tower-node-batch-result/v1', batch_id: 'failed-feedback-batch', based_on_revision: feedbackBatchJobs[0].revision,
    results: feedbackBatchJobs.map((job, index) => JSON.parse(nodeResponseWithEnemy(job, {
      id: `feedback_batch_enemy_${index}`, name: `反馈守卫${index + 1}`, emoji: '👾', hp: 40, max_hp: 40, lust: 0, max_lust: 100,
      actions: [{ id: 'hit', name: '挥击', weight: 1, effects: { damage: 6 } }], abilities: [], status_effects: [],
      action_mode: 'random', action_config: {}, lust_effect: { name: '追击', effects: { damage: 4 } },
    }).slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length))),
  });
  const sharedBalance = controller.encounterEvaluator.balance;
  let feedbackBalanceCalls = 0;
  controller.encounterEvaluator.balance = async input => {
    const assessed = await sharedBalance(input);
    feedbackBalanceCalls += 1;
    return feedbackBalanceCalls === 2
      ? { ...assessed, needsReview: false, requiresRegeneration: true }
      : assessed;
  };
  calls.length = 0;
  structuredProgress.length = 0;
  generatedText = config => config.user_input.includes('程序战斗评估反馈')
    ? nodeResponseWithEnemy(feedbackBatchJobs[0], {
      id: 'feedback_batch_enemy_0', name: '反馈守卫1', emoji: '👾', hp: 42, max_hp: 42, lust: 0, max_lust: 100,
      actions: [{ id: 'hit', name: '挥击', weight: 1, effects: { damage: 7 } }], abilities: [], status_effects: [],
      action_mode: 'random', action_config: {}, lust_effect: { name: '追击', effects: { damage: 4 } },
    })
    : feedbackBatchResponse;
  await controller.requestTowerGeneration({
    generationType: 'batch', batchId: 'failed-feedback-batch', requestId: 'failed-feedback-batch',
    basedOnRevision: feedbackBatchJobs[0].revision, jobs: feedbackBatchJobs,
    prompt: 'a failed first feedback still consumes the batch request token', maxAttempts: 1,
  });
  const failedFeedbackRequests = calls.filter(call => call[0] === 'generate');
  assert.equal(failedFeedbackRequests.length, 2, 'first-member feedback remains consumed after MWG_ENCOUNTER_BUDGET');
  assert.equal(failedFeedbackRequests.filter(call => /程序战斗评估反馈/.test(call[1].user_input)).length, 1,
    'the second member cannot obtain a replacement feedback request');
  assert.equal(
    structuredProgress.filter(entry => entry.detail === '本地复测需要一次额外 AI 反馈，正在请求复核').length,
    1,
    'a batch consumes and describes at most one additional AI feedback request',
  );
  assert.ok(structuredProgress.some(entry => entry.generationId === 'tower-task:failed-feedback-batch'
    && entry.detail === '正在请求 AI 复核战斗强度'),
  'the feedback child queue remains attached to the batch parent operation');
  assert.equal(variables.stat_data.run.nodeContent[feedbackBatchJobs[0].nodeId].phase, 'failed');
  assert.equal(variables.stat_data.run.nodeContent[feedbackBatchJobs[1].nodeId].phase, 'ready');
  controller.encounterEvaluator.balance = sharedBalance;

  const feedbackFailureCase = prepareTowerNode(20261033, false, 2);
  variables = feedbackFailureCase.variables;
  calls.length = 0;
  generatedText = config => config.user_input.includes('程序战斗评估反馈')
    ? '<not_a_tower_node_result>'
    : validNodeResponse(feedbackFailureCase.request);
  await controller.requestTowerGeneration({
    ...feedbackFailureCase.request, basedOnRevision: feedbackFailureCase.request.revision,
    prompt: 'one feedback may fail without retrying', maxAttempts: 1,
  });
  const feedbackRequests = calls.filter(call => call[0] === 'generate');
  assert.equal(feedbackRequests.length, 2, 'one authoring request plus one failed feedback request is the hard maximum');
  assert.equal(feedbackRequests.filter(call => /程序战斗评估反馈/.test(call[1].user_input)).length, 1);
} finally {
  controller.encounterEvaluator = savedEncounterEvaluator;
}

// A structurally incomplete enemy gets one isolated schema repair before any
// node content is committed. The repaired response keeps the original scope.
const structureCase = prepareTowerNode(20260838, false, 6);
variables = structureCase.variables;
const repairKnownStatus = { id: 'time_debt', name: '偿时之债', emoji: '🧾', type: 'debuff',
  stacks_change: -1, triggers: { turn_start: { damage: 3, damage_type: 'hp_loss', to: 'self' } } };
const repairKnownResource = { id: 'repair_charge', name: '蓄能', emoji: '⚡', current: 2, max: 9, refresh: 'retain' };
variables.stat_data.battle.statuses = [structuredClone(repairKnownStatus)];
variables.stat_data.battle.core.resources = [structuredClone(repairKnownResource)];
const repairOwnedArtifact = { id: 'repair_owned_relic', name: '旧物', rarity: 'Common', trigger: { on: 'battle_start', effects: { block: 1 } } };
const repairOwnedItem = { id: 'repair_owned_item', name: '药剂', count: 1, effects: { heal: 1 } };
variables.stat_data.battle.artifacts = [structuredClone(repairOwnedArtifact)];
variables.stat_data.battle.items = [structuredClone(repairOwnedItem)];
const readRepairFacts = config => JSON.parse(config.user_input.split('\n').find(line => line.startsWith('EXISTING_DEFINITIONS=')).slice('EXISTING_DEFINITIONS='.length));
const latestRepairStatus = { ...structuredClone(repairKnownStatus), stacks_change: -2 };
const latestRepairResource = { ...repairKnownResource, current: 4 };
const missingEffectsEnemy = {
  id: 'hollow_guard', name: '空壳守卫', emoji: '🗿', hp: 45, max_hp: 45, lust: 0, max_lust: 100,
  actions: [{ id: 'empty_swing', name: '空挥', weight: 1, description: '只有说明，没有效果。' }],
  abilities: [], status_effects: [], action_mode: 'random', action_config: {},
  lust_effect: { name: '震慑', effects: { damage: 5 } },
};
generatedText = config => {
  if (config.user_input.includes('[爬塔后台节点结构修复]')) return validNodeResponse(structureCase.request);
  // Same run revision, but the validation snapshot after authoring is newer.
  variables.stat_data.battle.statuses = [structuredClone(latestRepairStatus)];
  variables.stat_data.battle.core.resources = [structuredClone(latestRepairResource)];
  variables.stat_data.battle.cards[0].id = 'latest_owned_strike';
  return nodeResponseWithEnemy(structureCase.request, missingEffectsEnemy);
};
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
const singleFacts = readRepairFacts(structureGenerateCalls[1][1]);
assert.deepEqual(singleFacts.statuses, [latestRepairStatus], 'repair uses latest validation snapshot, not original request snapshot');
assert.deepEqual(singleFacts.resources, [latestRepairResource]);
assert.deepEqual(singleFacts.owned_content_ids, { cards: ['latest_owned_strike', 'guard'], artifacts: ['repair_owned_relic'], items: ['repair_owned_item'] });
assert.equal(variables.stat_data.run.nodeContent[structureCase.request.nodeId].phase, 'ready');
assert.equal(calls.filter(call => call[0] === 'replace').length, 1, 'only the repaired structure is committed');

// A nonempty original followed by an empty one-shot repair must be identified
// as a repair failure. It cannot trigger a new fallback attempt or publish the
// invalid original as playable content.
{
  const emptyRepair = prepareTowerNode(20260841, false, 6);
  variables = emptyRepair.variables;
  generatedText = config => config.user_input.includes('[爬塔后台节点结构修复]')
    ? '' : nodeResponseWithEnemy(emptyRepair.request, missingEffectsEnemy);
  calls.length = 0;
  await assert.rejects(controller.requestTowerGeneration({
    nodeId: emptyRepair.request.nodeId, requestId: emptyRepair.request.requestId,
    basedOnRevision: emptyRepair.request.revision, kind: emptyRepair.request.kind, prompt: 'empty repair diagnostic',
  }), /结构修正，第 1 次请求，文本长度 0/);
  const history = controller.getTowerGenerationDiagnostics().slice(-2);
  assert.deepEqual(history.map(d => [d.stage, d.outcome]), [['structured', 'returned'], ['structure-repair', 'empty_final']]);
  assert.equal(calls.filter(call => call[0] === 'generate').length, 2);
  assert.equal(calls.filter(call => call[0] === 'replace').length, 1);
  assert.equal(calls.some(call => call[0] === 'event'), false);
  const envelope = variables.stat_data.run.nodeContent[emptyRepair.request.nodeId];
  assert.equal(envelope.phase, 'failed');
  assert.match(envelope.error, /结构修正/);
  assert.equal(envelope.content, undefined);
}

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
assert.deepEqual(eventRewardRepairCalls.map(call=>call[1].empty_json_fallback),[false,false], 'ordinary nonempty node repair keeps its original transport');
assert.equal(
  eventRewardRepairCalls.length,
  2,
  `invalid event rewards receive one bounded structure repair: ${JSON.stringify(eventRewardRepairCalls)}`,
);
assert.match(
  eventRewardRepairCalls[1][1].user_input,
  /必须提供浅层 effects|an executable definition must contain effects/,
);
assert.equal(variables.stat_data.run.nodeContent[eventRewardRepairCase.request.nodeId].phase, 'ready');
assert.deepEqual(
  variables.stat_data.run.nodeContent[eventRewardRepairCase.request.nodeId]
    .content.payload.event.choices[0].outcome.reward.cards[0].effects,
  { draw: 1, block: 4 },
);
assert.equal(calls.filter(call => call[0] === 'replace').length, 1);

// A provider may repeat an incomplete reward after the one fast repair. The
// controller must stop there instead of silently issuing a third expensive
// request; the failed node remains retryable as one whole generation job.
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
  return incompleteRepeatedReward;
};
calls.length = 0;
await assert.rejects(
  controller.requestTowerGeneration({
    nodeId: repeatedRewardCase.request.nodeId,
    requestId: repeatedRewardCase.request.requestId,
    basedOnRevision: repeatedRewardCase.request.revision,
    kind: repeatedRewardCase.request.kind,
    prompt: '生成奖励候选数量不足的节点',
  }),
  /requires 3 candidates/,
);
const repeatedRewardGenerateCalls = calls.filter(call => call[0] === 'generate');
assert.equal(repeatedRewardRepairs, 1);
assert.equal(repeatedRewardGenerateCalls.length, 2, 'one authored result plus one bounded structure repair');
assert.match(repeatedRewardGenerateCalls[1][1].user_input, /奖励候选数量不足/);
assert.match(repeatedRewardGenerateCalls[1][1].user_input, /新写不同 id、不同机制的候选补足/);
assert.equal(variables.stat_data.run.nodeContent[repeatedRewardCase.request.nodeId].phase, 'failed');
assert.equal(calls.filter(call => call[0] === 'replace').length, 1, 'only the retryable failure state reaches MVU');

// An observed provider billing failure never starts content repair or writes
// partial game data. Only its exact node envelope becomes safely retryable.
{
  const { GenerationTransportError, classifyGenerationTransportFailure } = require(resolve('src/sillytavern-extension/generationTransportError.ts'));
  const quotaCase = prepareTowerNode(20260906, true, 2);
  variables = quotaCase.variables;
  const before = structuredClone(variables);
  generationError = new GenerationTransportError(classifyGenerationTransportFailure(500, {
    error: { message: 'Insufficient Balance', code: 'invalid_request_error' },
  }));
  calls.length = 0;
  try {
    await assert.rejects(controller.requestTowerGeneration({
      nodeId: quotaCase.request.nodeId, requestId: quotaCase.request.requestId,
      basedOnRevision: quotaCase.request.revision, kind: quotaCase.request.kind,
      prompt: 'original node request', maxAttempts: 3,
    }), /余额或额度不足/);
    assert.equal(calls.filter(call => call[0] === 'generate').length, 1);
    assert.equal(calls.filter(call => call[0] === 'replace').length, 1);
    assert.equal(calls.some(call => call[0] === 'event' || call[0] === 'create'), false);
    const failedEnvelope = variables.stat_data.run.nodeContent[quotaCase.request.nodeId];
    assert.equal(failedEnvelope.phase, 'failed'); assert.match(failedEnvelope.error, /HTTP 500/);
    assert.deepEqual(variables.stat_data.battle, before.stat_data.battle);
    assert.deepEqual(variables.__magic_girl_world, before.__magic_girl_world);
    assert.equal(variables.stat_data.run.stateRevision, before.stat_data.run.stateRevision);
    assert.deepEqual(variables.stat_data.run.map, before.stat_data.run.map);
  } finally { generationError = null; }
}

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
assert.deepEqual(calls.map(call => call[0]), ['generate', 'generate', 'replace']);
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
  battle: { statuses: [structuredClone(repairKnownStatus)], core: { resources: [structuredClone(repairKnownResource)] },
    cards: [{ id: 'opening_owned_card' }], artifacts: [structuredClone(repairOwnedArtifact)], items: [structuredClone(repairOwnedItem)] },
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
assert.deepEqual(calls.filter(call=>call[0]==='generate').map(call=>call[1].empty_json_fallback),[false,false], 'ordinary nonempty opening repair keeps its original transport');
assert.ok(calls.filter(call => call[0] === 'generate')[1][1].user_input.includes(JSON.stringify(repairKnownStatus)), 'opening repair retains the same registry');
assert.deepEqual(readRepairFacts(calls.filter(call => call[0] === 'generate')[1][1]), {
  statuses: [repairKnownStatus], resources: [repairKnownResource],
  owned_content_ids: { cards: ['opening_owned_card'], artifacts: ['repair_owned_relic'], items: ['repair_owned_item'] },
}, 'opening caller includes owned identities, not generated choice candidates');
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
// Both non-batch callers must carry successful transport provenance without
// buying a second repair attempt or changing the narrative preset path.
for (const route of ['node', 'opening']) for (const repair of ['fixed', 'unchanged', 'erased', 'condition-evasion']) {
  const prepared = prepareTowerNode(20261977 + (route === 'node' ? 0 : 1) + ['fixed', 'unchanged', 'erased', 'condition-evasion'].indexOf(repair) * 10, false, 0, 'event');
  variables = prepared.variables;
  let request, response;
  if (route === 'node') {
    request = { ...prepared.request, basedOnRevision: prepared.request.revision, prompt: 'literal node repair', maxAttempts: 1 };
    response = JSON.parse(eventNodeResponse(prepared.request, true).replace(/<\/?TOWER_NODE_RESULT>/g, ''));
  } else {
    variables.stat_data.run = createRunState({ seed: prepared.variables.stat_data.run.seed + 101 });
    const queued = towerOpening.queueTowerOpeningInStat(variables.stat_data).request;
    towerOpening.claimTowerOpeningInStat(variables.stat_data, queued.requestId);
    request = { generationType: 'opening', requestId: queued.requestId, revision: queued.revision, prompt: 'literal opening repair', maxAttempts: 1 };
    response = JSON.parse(validOpeningResponse(queued).replace(/<\/?TOWER_OPENING_RESULT>/g, ''));
  }
  const choices = route === 'node' ? response.payload.event.choices : response.choices;
  const literal = { id: 'literal_delay', name: '延迟测试', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
    description: '造成5点伤害；下一回合开始时，对该敌人再造成5点伤害。', effects: [{ damage: 5 }] };
  choices[0].outcome.reward = { cards: [literal] };
  let attempts = 0;
  generatedText = () => {
    attempts++;
    const next = structuredClone(response);
    const target = (route === 'node' ? next.payload.event.choices : next.choices)[0].outcome.reward.cards[0];
    if (attempts === 2 && repair === 'fixed') target.effects.push({ schedule: 1, phase: 'turn_start', effects: { damage: 5 } });
    if (attempts === 2 && repair === 'erased') delete target.description;
    if (attempts === 2 && repair === 'condition-evasion') target.effects[0].when = 'turn_number > 0';
    return JSON.stringify(next);
  };
  const battleBefore = structuredClone(variables.stat_data.battle);
  calls.length = 0;
  if (repair === 'fixed') await controller.requestTowerGeneration(request);
  else await assert.rejects(controller.requestTowerGeneration(request), /字面|EXPLICIT_LITERAL_EFFECT_MISMATCH/);
  assert.equal(attempts, 2, `${route}/${repair}: exactly one authoring and one repair`);
  const envelope = route === 'node' ? variables.stat_data.run.nodeContent[request.nodeId] : variables.stat_data.run.opening;
  assert.equal(envelope.phase, repair === 'fixed' ? 'ready' : 'failed');
  assert.deepEqual(variables.stat_data.battle, battleBefore);
  if (repair === 'fixed') {
    const accepted = route === 'node' ? envelope.content.payload.event.choices : envelope.content.choices;
    assert.deepEqual(accepted.slice(1), choices.slice(1), 'untouched fixture sibling choices remain exact');
    assert.deepEqual(accepted[0].outcome.reward.cards[0].effects, [{ damage: 5 }, { schedule: 1, phase: 'turn_start', effects: { damage: 5 } }]);
    if (route === 'opening') {
      for (let i = 0; i < 100 && variables.stat_data.run.opening.narrativePhase !== 'ready'; i++) await new Promise(r => setTimeout(r, 0));
      assert.equal(variables.stat_data.run.opening.narrativePhase, 'ready');
    }
  } else assert.equal(Object.hasOwn(envelope, 'content'), false, 'invalid candidate is not published');
}
for (const mode of ['node','opening']) for (const validRecovery of [false,true]) {
  let request, good, bad;
  if(mode==='node') {
    const test=prepareTowerNode(20260970+(validRecovery?10:0),false,0,'event');
    variables=test.variables;
    request={nodeId:test.request.nodeId,requestId:test.request.requestId,basedOnRevision:test.request.revision,
      kind:test.request.kind,prompt:'event recovery test',maxAttempts:2};
    good=eventNodeResponse(test.request,true);bad=eventNodeResponse(test.request,false);
  } else {
    const stat={...structuredClone(openingStat),run:createRunState({seed:20260971+(validRecovery?10:0)})};
    const queued=towerOpening.queueTowerOpeningInStat(stat).request;
    towerOpening.claimTowerOpeningInStat(stat,queued.requestId);variables={stat_data:stat};
    request={generationType:'opening',requestId:queued.requestId,revision:queued.revision,prompt:'opening recovery test',maxAttempts:2};
    good=validOpeningResponse(queued);bad=good.replace('"reward":{}','"reward":{"cards":"broken"}');
  }
  let attempt=0;
  generatedText=config=>{attempt++;assert.ok(attempt<=2,'no third mechanism request');return attempt===1?'':validRecovery?good:bad;};
  request.maxAttempts=8; // An oversized request cannot enlarge the product budget.
  calls.length=0;
  if(validRecovery)await controller.requestTowerGeneration(request);
  else await assert.rejects(controller.requestTowerGeneration(request));
  const transport=calls.filter(call=>call[0]==='generate');
  assert.equal(transport.length,2,`${mode}: empty recovery consumes the one shared extra request`);
  assert.deepEqual(transport.map(call=>call[1].empty_json_fallback),[false,true],mode);
  if(mode==='node')assert.equal(variables.stat_data.run.nodeContent[request.nodeId].phase,validRecovery?'ready':'failed');
  else {
    assert.equal(variables.stat_data.run.opening.phase,validRecovery?'ready':'failed');
    if(!validRecovery){assert.equal(calls.filter(call=>call[0]==='narrative').length,0);continue;}
    for(let index=0;index<100&&variables.stat_data.run.opening.narrativePhase!=='ready';index++)await new Promise(r=>setTimeout(r,0));
    assert.equal(variables.stat_data.run.opening.narrativePhase,'ready');
    const prose=calls.filter(call=>call[0]==='narrative');assert.equal(prose.length,1);
    assert.equal(prose[0][1].preset_name,'in_use');
    assert.equal(Object.hasOwn(prose[0][1],'empty_json_fallback'),false);
  }
}

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

// The visible tower-task id can explicitly stop a Helper promise that never
// settles. Only its exact generating envelope becomes retryable; a later
// request still reaches the queue and a stale late response cannot commit.
{
  const stoppable = prepareTowerNode(20260915, false, 5);
  variables = stoppable.variables;
  generatedText = validNodeResponse(stoppable.request);
  pendingMode = true;
  pendingReject = null;
  pendingResolve = null;
  calls.length = 0;
  const pendingStop = controller.requestTowerGeneration({
    nodeId: stoppable.request.nodeId, requestId: stoppable.request.requestId,
    basedOnRevision: stoppable.request.revision, kind: stoppable.request.kind,
    prompt: 'never settling request to stop',
  });
  const stopped = pendingStop.catch(error => error);
  for (let index = 0; index < 100 && !pendingReject; index += 1) await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
  assert.ok(pendingReject, 'the exact Helper request is active before explicit stop');
  const currentChatId = context.chatId;
  context.chatId = 'unrelated-chat';
  assert.equal(await controller.cancelTowerGenerationById({ generationId: `tower-task:${stoppable.request.requestId}` }), false,
    'a different chat cannot stop this request');
  context.chatId = currentChatId;
  assert.equal(variables.stat_data.run.nodeContent[stoppable.request.nodeId].phase, 'generating');
  assert.equal(await controller.cancelTowerGenerationById({ generationId: `tower-task:${stoppable.request.requestId}` }), true);
  assert.ok(await stopped instanceof TowerGenerationCancelledError);
  assert.equal(variables.stat_data.run.nodeContent[stoppable.request.nodeId].phase, 'failed');
  assert.equal(calls.filter(call => call[0] === 'stop').length, 1);
  pendingMode = false;
  pendingResolve = null;
  pendingReject = null;
  const next = prepareTowerNode(20260916, false, 6);
  variables = next.variables;
  generatedText = validNodeResponse(next.request);
  await controller.requestTowerGeneration({
    nodeId: next.request.nodeId, requestId: next.request.requestId,
    basedOnRevision: next.request.revision, kind: next.request.kind,
    prompt: 'queue remains usable after explicit stop',
  });
  assert.equal(variables.stat_data.run.nodeContent[next.request.nodeId].phase, 'ready');
}

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

// Stale campfire controls must stop before invoking any model or mutating a save.
for (const kind of ['upgrade', 'transform']) {
  const restFixture = prepareTowerNode(20260908, false, 0, 'battle');
  variables = restFixture.variables;
  let run = createRunState({ seed: 20260908 });
  for (let step = 0; step < 50; step++) {
    const choice = run.choices.find(entry => entry.kind === 'rest') || run.choices[0];
    assert.ok(choice, 'fixture must reach a campfire');
    run = enterRunNode(run, choice.id);
    if (choice.kind === 'rest') break;
    run = completeRunNode(run, { outcome: 'cleared' });
  }
  const node = run.currentNode;
  assert.equal(node?.kind, 'rest');
  variables.stat_data.run = run;
  const before = structuredClone(variables);
  const restController = new DesignAssistantController({
    context: () => context, mvu: () => mvu, now: () => 97532, notify() {},
  }, undefined, towerPorts);
  restController.active = true;
  restController.towerChatId = context.chatId;
  calls.length = 0;
  generationError = new Error('campfire transport boundary');
  await assert.rejects(restController.requestRestMutation({
    spec: 'mwg.rest-mutation-request/v1', kind, nodeId: node.id, cardId: 'strike',
  }), /营火只提供休息、锻炼、搜刮和回忆/);
  const requests = calls.filter(call => call[0] === 'generate');
  assert.equal(requests.length, 0);
  assert.deepEqual(variables, before, 'stale controls cannot mutate the save');
  restController.deactivate();
}
generationError = null;

assert.ok(stateChanges.length > 0, 'successful state writes notify mounted views without requiring a generation event');
if (previousMonitor === undefined) delete globalThis.MagicGirlWorldMvuMonitor;
else globalThis.MagicGirlWorldMvuMonitor = previousMonitor;

const indexSource = await readFile(resolve('src/sillytavern-extension/index.ts'), 'utf8');
const controllerSource = await readFile(resolve('src/sillytavern-extension/controller.ts'), 'utf8');
assert.match(indexSource, /createGlobalTowerGenerationPorts/);
assert.match(indexSource, /new DesignAssistantController\([\s\S]*createGlobalTowerGenerationPorts\(\)/);
assert.match(controllerSource, /scheduleTowerGeneration\(reason = 'character-runtime'\)/);
assert.match(controllerSource, /this\.towerCoordinator\?\.schedule\(`runtime:\$\{normalizedReason\}`\)/);

console.log('Tower generation controller scope, MVU commit, deferred persistence, failure, opening, and cancellation tests passed.');
