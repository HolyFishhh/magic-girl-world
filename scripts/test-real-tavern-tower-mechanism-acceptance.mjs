import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTavernApi, getSettings } from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const {
  DesignAssistantController,
} = require(resolve(root, 'src/sillytavern-extension/controller.ts'));
const {
  createGlobalTowerGenerationPorts,
} = require(resolve(root, 'src/sillytavern-extension/towerGenerationHost.ts'));
const {
  DESIGN_ASSISTANT_CARD_SCOPE,
  DESIGN_ASSISTANT_EXTENSION_ID,
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
} = require(resolve(root, 'src/sillytavern-extension/types.ts'));
const {
  settleTowerOpeningChoiceInStat,
} = require(resolve(root, 'src/common/runTransactions.ts'));
const {
  activateTowerNodeInStat,
} = require(resolve(root, 'src/runtime/towerContentActivation.ts'));
const {
  completeRunNodeInStat,
  settleBattleRunInStat,
} = require(resolve(root, 'src/runtime/runStateAdapter.ts'));
const {
  settleTowerBattleRewardInStat,
} = require(resolve(root, 'src/runtime/towerBattleRewardSettlement.ts'));
const {
  applyRewardSelectionsToStat,
} = require(resolve(root, 'src/common/rewardTransactions.ts'));
const {
  validateRunState,
  isBattleRunNode,
} = require(resolve(root, 'src/game-core/index.ts'));

const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl || 'http://127.0.0.1:8012/');
const scenarioId = String(process.env.TOWER_ACCEPTANCE_SCENARIO || process.argv[2] || 'summon_systems').trim();
const initialOnly = process.env.TOWER_ACCEPTANCE_INITIAL_ONLY === '1';
const schemaTransport = process.env.TOWER_ACCEPTANCE_SCHEMA_TRANSPORT === 'legacy' ? 'legacy' : 'shared';
const replayPath = process.env.TOWER_ACCEPTANCE_REPLAY_INITIAL;
const replayEvidence = replayPath ? JSON.parse(await readFile(resolve(replayPath), 'utf8')) : null;
if (replayEvidence && (!initialOnly || replayEvidence.scenarioId !== scenarioId)) {
  throw new Error('Recorded initial replay requires INITIAL_ONLY=1 and the same scenario');
}
const replayInitial = replayEvidence?.calls?.find(call => call.kind === 'initial_authoring');
if (replayEvidence && !replayInitial?.response) throw new Error('Replay evidence has no initial model response');
const configuredRequestTimeoutMs = Number(process.env.TOWER_ACCEPTANCE_REQUEST_TIMEOUT_MS || 180_000);
const requestTimeoutMs = Number.isFinite(configuredRequestTimeoutMs) && configuredRequestTimeoutMs >= 1_000
  ? configuredRequestTimeoutMs
  : 180_000;
const runId = `${scenarioId}-${new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}`;
const evidenceDir = resolve(root, 'tmp', 'real-tavern-tower-acceptance');
const evidencePath = resolve(evidenceDir, `${runId}.json`);
await mkdir(evidenceDir, { recursive: true });

const SCENARIOS = {
  summon_systems: {
    name: '星械契约师',
    world: '蒸汽与星术共存的移动高塔，机械生物会学习旅者的战斗方式。',
    profession: '星械契约师',
    opening: '被失控的星轨列车送入高塔，只能连续通过三幕试炼返回原本世界。',
    card: [
      '以真正可执行的召唤流为核心，同时使用召唤物生命、独立行动、召唤资源与召唤能力。',
      '允许少量姿态、Orb、自定义资源、卡牌数值修改、选择手牌与牌区操作作为相邻分支。',
      '不要只在名称或描述里提到召唤；每个核心循环都要由 effects、trigger、状态或资源真实驱动。',
    ].join(''),
    towerRequirements: [
      '敌人随剧情形成机械生态，活用能力触发、状态、自定义资源、动态增援和多敌协作。',
      '不要追求把所有机制塞进同一个敌人；每个节点有清晰主题和可读反制窗口。',
      '数值评分只用于配置压力，不得为了评分删除有创意的合法结构。',
    ].join(''),
  },
  trigger_control: {
    name: '镜界编程者',
    world: '现代都市的倒影被改写成一座会循环运行规则的镜界高塔。',
    profession: '镜界编程者',
    opening: '城市在午夜被镜面规则覆盖，角色必须连续击破规则节点才能让清晨到来。',
    card: [
      '以 Power、事件触发、延迟效果、自动出牌、重复打出、免费打出和牌区循环为核心。',
      '可以使用卡牌附着、卡牌成长、跨战斗修改、弃牌与消耗触发、条件判断和自定义资源。',
      '机制必须真实写进 effects 或 trigger，描述只解释实际结构，不得用叙述冒充功能。',
    ].join(''),
    towerRequirements: [
      '敌人根据镜面规则设计特色行动，允许多敌、顺序行动、条件行动、能力触发、debuff 与牌库干扰。',
      '敌方欲望手段必须同时保留可结束战斗的伤害或明确叙事结算路径。',
      '创意与数值建议不作为硬性校验，只有不可执行或语义不唯一的结构才需要修复。',
    ].join(''),
  },
};

const scenario = SCENARIOS[scenarioId];
if (!scenario) throw new Error(`Unknown scenario ${scenarioId}; expected ${Object.keys(SCENARIOS).join(', ')}`);

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function responseText(payload) {
  return String(
    payload?.choices?.[0]?.message?.content
      ?? payload?.choices?.[0]?.text
      ?? payload?.content
      ?? payload?.response
      ?? '',
  ).trim();
}

function responseReasoning(payload) {
  return String(payload?.choices?.[0]?.message?.reasoning_content || '').trim();
}

function orderedMessages(config) {
  const order = Array.isArray(config.ordered_prompts) ? config.ordered_prompts : [];
  const messages = [];
  let userInputInserted = false;
  for (const entry of order) {
    if (entry === 'user_input') {
      messages.push({ role: 'user', content: String(config.user_input || '') });
      userInputInserted = true;
      continue;
    }
    if (isRecord(entry) && ['system', 'assistant', 'user'].includes(entry.role)) {
      messages.push({ role: entry.role, content: String(entry.content || '') });
    }
  }
  if (!userInputInserted) messages.push({ role: 'user', content: String(config.user_input || '') });
  return messages;
}

function promptKind(config) {
  const prompt = String(config.user_input || '');
  const repair = /VALIDATION_ERRORS?=|CANDIDATE_JSON=|REJECTED_(?:CANDIDATE|OUTPUT)=|structure_repair/i.test(prompt)
    || /__variables_[2-9]\d*$/.test(String(config.generation_id || ''));
  const schema = String(config.json_schema?.name || config.tools?.[0]?.function?.name || 'none');
  if (schema.includes('initial_content') || schema.includes('initial_root_repair') || schema.includes('initial_slot_repair')) {
    return repair ? 'initial_repair' : 'initial_authoring';
  }
  if (schema.includes('batch')) return repair ? 'batch_repair' : 'batch_authoring';
  if (schema.includes('opening')) return repair ? 'opening_repair' : 'opening_authoring';
  return repair ? 'node_repair' : 'node_authoring';
}

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

const api = await createTavernApi(tavernUrl);
const settings = await getSettings(api);
const oai = settings.oai_settings || {};
assert.equal(oai.chat_completion_source, 'deepseek', 'acceptance requires the active DeepSeek connector');
assert.ok(oai.deepseek_model, 'the active DeepSeek model is empty');

let activePhase = 'bootstrap';
const evidence = {
  spec: 'mwg.real-tavern-tower-mechanism-acceptance/v1',
  // Real model transport, but Helper/MVU/settlement below are test doubles.
  // A successful summary cannot prove live gameplay or exact disk reload.
  executionScope: 'real-model-in-memory-host',
  runId,
  scenarioId,
  scenario,
  startedAt: new Date().toISOString(),
  tavernUrl: tavernUrl.toString(),
  connector: oai.chat_completion_source,
  model: oai.deepseek_model,
  preset: oai.preset_settings_openai,
  requestTimeoutMs,
  schemaTransport,
  repairSchemaTransportVersion: 'factored-status-events/v1',
  ...(replayPath ? { replayInitialFrom: resolve(replayPath) } : {}),
  calls: [],
  monitor: { structured: [], statuses: [], completed: [], failed: [] },
  phases: [],
};

async function saveEvidence() {
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
}

const helper = {
  async generateRaw(config) {
    const messages = orderedMessages(config);
    const requestBody = {
      type: 'quiet',
      messages: clone(messages),
      model: oai.deepseek_model,
      temperature: Number(oai.temp_openai ?? 1),
      frequency_penalty: Number(oai.freq_pen_openai ?? 0),
      presence_penalty: Number(oai.pres_pen_openai ?? 0),
      top_p: Number(oai.top_p_openai ?? 1),
      max_tokens: Number(process.env.TOWER_ACCEPTANCE_MAX_TOKENS || 20_000),
      stream: false,
      chat_completion_source: oai.chat_completion_source,
      user_name: '机制验收者',
      char_name: '魔法少女世界爬塔后台',
      ...(Array.isArray(config.tools) ? { tools: clone(config.tools) } : {}),
      ...(config.tool_choice ? { tool_choice: clone(config.tool_choice) } : {}),
      ...(config.json_schema ? { json_schema: clone(config.json_schema) } : {}),
    };
    // Tavern Helper emits this request-boundary event before transport. The
    // product may observe it, but must not rewrite provider thinking or
    // sampling controls; acceptance inherits the active connection settings.
    await events.emit('chat_completion_settings_ready', requestBody);
    const call = {
      index: evidence.calls.length + 1,
      phase: activePhase,
      kind: promptKind(config),
      generationId: config.generation_id,
      startedAt: new Date().toISOString(),
      config: clone(config),
      requestBody: clone(requestBody),
    };
    evidence.calls.push(call);
    if (replayInitial && call.kind === 'initial_authoring' && call.index === 1) {
      call.replayed = true;
      call.response = replayInitial.response;
      call.toolCalls = clone(replayInitial.toolCalls);
      call.elapsedMs = 0;
      call.completedAt = new Date().toISOString();
      await saveEvidence();
      console.log(JSON.stringify({ acceptanceCall: call.index, kind: call.kind, replayed: true }));
      return call.toolCalls?.length ? { content: call.response, tool_calls: call.toolCalls } : call.response;
    }
    await saveEvidence();
    const started = Date.now();
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(new Error(`DeepSeek request exceeded ${requestTimeoutMs}ms`));
    }, requestTimeoutMs);
    try {
      const response = await api.request('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
      const rawTransport = await response.text();
      call.httpStatus = response.status;
      call.rawTransport = rawTransport;
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${rawTransport.slice(0, 1000)}`);
      const payload = JSON.parse(rawTransport);
      const text = responseText(payload);
      const toolCalls = payload?.choices?.[0]?.message?.tool_calls;
      call.response = text;
      call.toolCalls = clone(toolCalls);
      call.reasoning = responseReasoning(payload);
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        return { content: text, tool_calls: clone(toolCalls) };
      }
      if (!text) throw new Error(`DeepSeek returned no final content: ${rawTransport.slice(0, 1000)}`);
      return text;
    } catch (error) {
      call.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw error;
    } finally {
      clearTimeout(timeout);
      call.elapsedMs = Date.now() - started;
      call.completedAt = new Date().toISOString();
      await saveEvidence();
      console.log(JSON.stringify({
        acceptanceCall: call.index,
        phase: call.phase,
        kind: call.kind,
        elapsedSeconds: Math.round(call.elapsedMs / 100) / 10,
        httpStatus: call.httpStatus,
        hasResponse: Boolean(call.response),
        error: call.error,
      }));
    }
  },
  async generate(config) {
    return this.generateRaw(config);
  },
  async createChatMessages() {},
  stopGenerationById() { return true; },
  async replaceVariables(next) { variables = clone(next); },
};

const events = new FakeEvents();
const context = {
  chatId: `real-tower-acceptance-${runId}`,
  chat: [{ is_user: false, is_system: false, mes: '[爬塔模式开场]' }],
  characterId: 0,
  groupId: null,
  characters: [{
    data: {
      extensions: {
        magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE },
      },
    },
  }],
  extensionSettings: {
    [DESIGN_ASSISTANT_EXTENSION_ID]: {
      ...DEFAULT_DESIGN_ASSISTANT_SETTINGS,
      enabled: true,
      difficultyPercent: Number(process.env.TOWER_ACCEPTANCE_DIFFICULTY || 100),
      firstAuthoringSchemaTransport: schemaTransport === 'shared' ? 'compact-context' : 'provider-outline',
    },
  },
  saveSettingsDebounced() {},
  chatMetadata: {},
  saveMetadataDebounced() {},
  eventSource: events,
  eventTypes: {
    GENERATE_AFTER_DATA: 'generate_after_data',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_CHANGED: 'chat_id_changed',
    CHAT_LOADED: 'chat_loaded',
    GENERATION_ENDED: 'generation_ended',
    MESSAGE_UPDATED: 'message_updated',
  },
  updateMessageBlock(messageId, message) { this.chat[messageId] = message; },
  async saveChat() {},
};

let variables = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { schemaVersion: 1, mode: 'tower' },
    tower_requirements: scenario.towerRequirements,
    status: {
      time: '启程之前',
      location: '高塔入口',
      profession: { name: scenario.profession, ability: '尚待初始化' },
    },
    battle: {
      core: { emoji: '✨', hp: 80, max_hp: 80, lust: 0, max_lust: 100, card_removal_count: 0 },
      cards: [], artifacts: [], items: [], statuses: [], player_abilities: [], player_status_effects: [],
      level: 1, exp: 0,
    },
    reward: { card: [], artifact: [], item: [], limits: {}, disabled_categories: [] },
    run: null,
  },
};

const mvu = {
  getMvuData: () => clone(variables),
  replaceMvuData: async next => { variables = clone(next); },
  isDuringExtraAnalysis: () => false,
};

const previousHelper = globalThis.TavernHelper;
const previousMonitor = globalThis.MagicGirlWorldMvuMonitor;
globalThis.TavernHelper = helper;
globalThis.MagicGirlWorldMvuMonitor = {
  beginStructuredOperation: event => evidence.monitor.structured.push({ type: 'begin', ...clone(event) }),
  applyStructuredOperation: event => evidence.monitor.structured.push({ type: 'apply', ...clone(event) }),
  completeStructuredOperation: event => evidence.monitor.structured.push({ type: 'complete', ...clone(event) }),
  receiveTowerGenerationStatus: event => evidence.monitor.statuses.push(clone(event)),
  receiveTowerGenerationCompleted: event => evidence.monitor.completed.push(clone(event)),
  receiveTowerGenerationFailed: event => evidence.monitor.failed.push(clone(event)),
  captureMvuRequest: event => evidence.monitor.structured.push({ type: 'request', ...clone(event) }),
  fail: error => evidence.monitor.structured.push({ type: 'failure', error: String(error) }),
};

const ports = createGlobalTowerGenerationPorts(helper, () => context);
const controller = new DesignAssistantController({
  context: () => context,
  mvu: () => mvu,
  now: () => Date.now(),
  notify() {},
}, undefined, ports, { towerCoordinator: !initialOnly });

function runState() {
  const parsed = validateRunState(variables?.stat_data?.run);
  if (!parsed.ok) throw new Error(`run state is invalid: ${parsed.message}`);
  return parsed.value;
}

function readyNodeIds() {
  const run = runState();
  return Object.values(run.nodeContent)
    .filter(entry => entry?.phase === 'ready')
    .map(entry => entry.nodeId)
    .sort();
}

function phaseRecord(label, beforeCalls, beforeReady) {
  const calls = evidence.calls.slice(beforeCalls);
  const repairs = calls.filter(call => call.kind.includes('repair'));
  const failedCalls = calls.filter(call => call.error);
  const record = {
    label,
    callIndexes: calls.map(call => call.index),
    authoringCalls: calls.filter(call => call.kind.includes('authoring')).length,
    repairCalls: repairs.length,
    failedTransportCalls: failedCalls.length,
    firstPass: repairs.length === 0 && failedCalls.length === 0,
    readyBefore: beforeReady,
    readyAfter: variables?.stat_data?.run ? readyNodeIds() : [],
    coordinatorStatus: controller.towerCoordinator?.getStatus?.() || null,
  };
  evidence.phases.push(record);
  return record;
}

async function waitForCoordinator(label) {
  const coordinator = controller.towerCoordinator;
  if (!coordinator) throw new Error('tower coordinator is unavailable');
  let stablePasses = 0;
  for (;;) {
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
    const running = coordinator.running;
    if (running) await running;
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
    const status = coordinator.getStatus?.();
    if (status?.phase === 'error' || evidence.monitor.failed.length > 0) {
      const reported = evidence.monitor.failed.at(-1);
      const detail = status?.message || reported?.error || reported?.message || JSON.stringify(reported || {});
      throw new Error(`${label}: ${detail}`);
    }
    if (!coordinator.running && !coordinator.scheduled && !coordinator.rerunRequested) {
      stablePasses += 1;
      if (stablePasses >= 3) return;
    } else {
      stablePasses = 0;
    }
  }
}

function chooseReachableReadyNode() {
  const run = runState();
  const preference = ['battle', 'elite', 'event', 'rest', 'treasure', 'shop', 'boss'];
  return [...run.choices]
    .filter(choice => run.nodeContent[choice.id]?.phase === 'ready')
    .sort((left, right) => preference.indexOf(left.kind) - preference.indexOf(right.kind))[0] || null;
}

function claimVisibleRewards() {
  const reward = variables.stat_data.reward;
  if (!isRecord(reward)) return;
  const cards = Array.isArray(reward.card) && reward.card.length ? [0] : [];
  const artifacts = Array.isArray(reward.artifact) && reward.artifact.length ? [0] : [];
  const items = Array.isArray(reward.item) && reward.item.length ? [0] : [];
  if (!cards.length && !artifacts.length && !items.length) return;
  applyRewardSelectionsToStat(variables.stat_data, { cards, artifacts, items });
}

function settleActivatedNode(choice) {
  if (isBattleRunNode(choice.kind)) {
    settleTowerBattleRewardInStat(variables.stat_data, 'victory', choice.id);
    const activeBalance = variables.stat_data.run_node?.program_balance;
    settleBattleRunInStat(
      variables.stat_data,
      'victory',
      choice.id,
      isRecord(activeBalance)
        ? {
          playerDeckScore: Number(activeBalance.playerDeckScore),
          enemyScore: Number(activeBalance.finalEnemyScore),
        }
        : undefined,
    );
    claimVisibleRewards();
    return;
  }
  completeRunNodeInStat(variables.stat_data, 'cleared');
}

try {
  controller.activate();

  activePhase = 'initialization';
  let beforeCalls = evidence.calls.length;
  let beforeReady = [];
  await controller.startTowerSingleFloor({
    spec: 'mwg.tower-single-floor-start/v1',
    sourceMessageId: 0,
    prompt: `[角色创建]\n${JSON.stringify({ mode: 'tower', ...scenario })}\n[开始爬塔]`,
    config: { mode: 'tower', ...scenario },
  });
  phaseRecord('initialization', beforeCalls, beforeReady);
  await saveEvidence();

  if (!initialOnly) {
    activePhase = 'lookahead_1';
    beforeCalls = evidence.calls.length;
    beforeReady = readyNodeIds();
    // The product start path schedules the first reachable batch itself. Waiting
    // for that pass verifies the real chain and avoids turning a test-only
    // second schedule into a coordinator rerun.
    await waitForCoordinator('lookahead_1');
    phaseRecord('lookahead_1', beforeCalls, beforeReady);
    await saveEvidence();

    const opening = runState().opening;
    assert.equal(opening.phase, 'ready', 'opening gift is not ready after initialization');
    const firstOpeningChoice = opening.content?.choices?.[0]?.id;
    assert.ok(firstOpeningChoice, 'opening gift has no selectable choice');
    settleTowerOpeningChoiceInStat(variables.stat_data, firstOpeningChoice);

    for (let step = 1; step <= 2; step += 1) {
      const choice = chooseReachableReadyNode();
      assert.ok(choice, `no reachable ready node is available before step ${step}`);
      activateTowerNodeInStat(variables.stat_data, choice.id);

      activePhase = `lookahead_${step + 1}`;
      beforeCalls = evidence.calls.length;
      beforeReady = readyNodeIds();
      controller.towerCoordinator.schedule(`acceptance-lookahead-${step + 1}`);
      await waitForCoordinator(`lookahead_${step + 1}`);
      phaseRecord(`lookahead_${step + 1}`, beforeCalls, beforeReady);
      settleActivatedNode(choice);
      await saveEvidence();
    }
  }

  const scoredPhases = evidence.phases.filter(phase =>
    phase.label === 'initialization' || phase.label.startsWith('lookahead_'));
  assert.equal(
    evidence.monitor.failed.length,
    0,
    `后台生成存在失败事件：${JSON.stringify(evidence.monitor.failed.at(-1) || {})}`,
  );
  const directPasses = scoredPhases.filter(phase => phase.firstPass).length;
  evidence.summary = {
    successful: true,
    scoredPhases: scoredPhases.length,
    directPasses,
    firstPassRate: scoredPhases.length ? directPasses / scoredPhases.length : 0,
    repairs: evidence.calls.filter(call => call.kind.includes('repair')).length,
    totalModelCalls: evidence.calls.filter(call => !call.replayed).length,
    replayedModelResponses: evidence.calls.filter(call => call.replayed).length,
    finalRun: {
      act: runState().act,
      floor: runState().floor,
      stateRevision: runState().stateRevision,
      cards: variables.stat_data.battle.cards?.length || 0,
      deckQuantity: (variables.stat_data.battle.cards || [])
        .reduce((sum, card) => sum + Number(card.quantity || 0), 0),
      readyNodeIds: readyNodeIds(),
    },
    initialOnly,
  };
  console.log(JSON.stringify({ evidencePath, summary: evidence.summary }, null, 2));
} catch (error) {
  evidence.summary = {
    successful: false,
    error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ''}` : String(error),
    totalModelCalls: evidence.calls.filter(call => !call.replayed).length,
    replayedModelResponses: evidence.calls.filter(call => call.replayed).length,
    repairs: evidence.calls.filter(call => call.kind.includes('repair')).length,
  };
  console.error(JSON.stringify({ evidencePath, summary: evidence.summary }, null, 2));
  process.exitCode = 1;
} finally {
  evidence.completedAt = new Date().toISOString();
  await saveEvidence();
  controller.deactivate();
  if (previousHelper === undefined) delete globalThis.TavernHelper;
  else globalThis.TavernHelper = previousHelper;
  if (previousMonitor === undefined) delete globalThis.MagicGirlWorldMvuMonitor;
  else globalThis.MagicGirlWorldMvuMonitor = previousMonitor;
}
