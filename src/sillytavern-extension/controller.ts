import { RUN_NODE_KINDS, isBattleRunNode, validateRunState, type RunNodeKind, type RunState } from '../game-core/runState';
import {
  assessInitialPlayerContent,
  formatPlayerContentReadiness,
  formatPlayerContentRepairPrompt,
} from '../game-core/playerContentReadiness';
import { createContentPackFromMvuBattle } from '../runtime/contentPackAdapter';
import { deriveRunSeed, ensureRunStateInStat } from '../runtime/runStateAdapter';
import { compactCardForUpgrade } from '../game-core/runPrompt';
import { migratePersistentRunDeck } from '../game-core/cardProgression';
import { commitTowerOpening, failTowerOpening } from '../game-core/towerOpeningState';
import { executeUnifiedRunTransactionInStat } from '../common/runTransactions';
import { normalizeMvuList } from '../common/rewardTransactions';
import {
  createTowerNodeJsonSchema,
  createTowerOpeningJsonSchema,
  formatTowerBattleBalanceRepairPrompt,
  formatTowerNodeStructureRepairPrompt,
  formatTowerOpeningStructureRepairPrompt,
  parseTowerNodeResult,
  parseTowerOpeningResult,
  type TowerNodeResult,
} from '../game-core/towerRequest';
import {
  commitTowerGenerationInStat,
  failTowerGenerationInStat,
} from '../runtime/towerStateAdapter';
import {
  normalizeTowerReward,
  validateTowerBattleNodeForActivation,
  validateTowerEventNodeForActivation,
} from '../runtime/towerContentActivation';
import { DesignAssistantEngine, enemyGenerationFingerprintFromVariables, normalizeDesignAssistantChatState, normalizeDesignAssistantSettings } from './designEngine';
import { isMagicGirlWorldCharacter } from './characterScope';
import { hasDesignContext, injectDesignContext } from './promptInjection';
import { applyMvuRequestPolicy } from './mvuRequestPolicy';
import { looksLikeMvuExtraAnalysisRequest, summarizeMvuRequest } from './mvuRequestDetection';
import { PersistentMvuRepairHost } from './persistentMvuRepairHost';
import {
  createOfficialReasoningRecoveryRuntime,
  ReasoningFinalRecoveryHost,
} from './reasoningFinalRecovery';
import type { PersistentMvuRepairRequest } from '../runtime/mvuExtraModelRepair';
import {
  TowerLookaheadCoordinator,
  type TowerCoordinatorGenerationRequest,
  type TowerCoordinatorScope,
} from './towerCoordinator';
import {
  TowerGenerationHost,
  createGlobalTowerGenerationPorts,
  type TowerGenerationCompletedPayload,
  type TowerGenerationPorts,
  type TowerGenerationRequest,
  type TowerGenerationResult,
} from './towerGenerationHost';
import {
  TowerGenerationCancelledError,
  TowerGenerationQueue,
  towerGenerationTaskKey,
  type TowerGenerationQueueStatus,
  type TowerGenerationTaskKey,
} from './towerGenerationQueue';
import { balanceTowerGeneratedBattle } from './towerEnemyBalance';
import {
  readPersistedMessageVariableSnapshot,
  assessPersistedTowerMvuRestore,
  readLatestPersistedMessageVariableSnapshot,
  touchCurrentTowerChatActivity,
} from './towerChatActivity';
import { createEventBridgedTavernHelper } from './tavernHelperBridge';
import { subscribeTavernHelperRequestEvent } from './tavernHelperEventSubscription';
import { DesignWorkerClient } from './workerClient';
import {
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
  DESIGN_ASSISTANT_EXTENSION_ID,
  DESIGN_ASSISTANT_METADATA_KEY,
  TOWER_ARCHIVE_METADATA_KEY,
  type DesignAssistantChatState,
  type DesignAssistantDashboard,
  type DesignAssistantHost,
  type DesignAssistantSettings,
  type DesignAssistantStatus,
  type MvuDesignSnapshot,
  type SillyTavernContext,
} from './types';

const EVENT_GENERATE_AFTER_DATA = 'generate_after_data';
const EVENT_CHAT_COMPLETION_SETTINGS_READY = 'chat_completion_settings_ready';
const EVENT_CHAT_CHANGED = 'chat_id_changed';
const EVENT_CHAT_LOADED = 'chatLoaded';
const EVENT_GENERATION_ENDED = 'generation_ended';
const EVENT_MESSAGE_RECEIVED = 'message_received';
const EVENT_MVU_INITIALIZED = 'global_Mvu_initialized';
const EVENT_CHARACTER_RUNTIME_INITIALIZED = 'global_MagicGirlWorld_initialized';
const EVENT_MVU_UPDATE_STARTED = 'mag_variable_update_started';
const EVENT_MVU_UPDATE_ENDED = 'mag_variable_update_ended';
const MVU_LIFECYCLE_PROMPT_ID = 'mwg-design-context';
const TAVERN_HELPER_REPAIR_WAIT_MS = 10_000;
const TAVERN_HELPER_REPAIR_POLL_MS = 100;
const TAVERN_HELPER_EVENT_WAIT_MS = 10_000;
const TAVERN_HELPER_EVENT_POLL_MS = 100;
const LOGICAL_MVU_INJECTION_WINDOW_MS = 2_500;
// Switching the embedded common/fish view briefly tears down MVU's selected
// message alias.  Restoring the persisted chat snapshot on the first empty
// read can therefore overwrite a node that was entered milliseconds earlier.
// A real chat reload tolerates this short delay; an in-place view switch gets
// time to expose its newer authoritative revision and wins normally.
const TOWER_MVU_EMPTY_RESTORE_GRACE_MS = 1_500;
const TAVERN_HELPER_REPAIR_FUNCTIONS = [
  'getLastMessageId',
  'getChatMessages',
  'setChatMessages',
  'getVariables',
  'replaceVariables',
  'getAllEnabledScriptButtons',
  'getScriptTrees',
] as const;

interface ChatScopeToken {
  chatId: string | null | undefined;
  metadata: Record<string, any> | null;
  messageId: number | 'latest';
}

interface ActiveMvuLifecyclePrompt {
  chatId: string;
  messageId: number | 'latest';
  uninject(): void;
}

export type TowerGenerationBridgeRequest = Omit<TowerGenerationRequest, 'chatId' | 'nodeId'> & {
  /** Ignored at the trust boundary; the active SillyTavern chat always wins. */
  chatId?: string;
  generationType?: 'node' | 'opening';
  nodeId?: string;
  basedOnRevision?: number;
  /** Compatibility alias used by towerStateAdapter request descriptors. */
  revision?: number;
  kind?: RunNodeKind;
  /** Binds extension-owned lookahead work to the message that created it. */
  sourceMessageId?: number | 'latest';
};

interface NormalizedTowerBridgeRequest {
  generationType: 'node' | 'opening';
  request: TowerGenerationRequest;
  basedOnRevision: number;
  kind?: RunNodeKind;
  act?: number;
  floor?: number;
  messageId: number | 'latest';
}

interface TowerGenerationBridgeFailure {
  spec: 'mwg.tower-generation-failure/v1';
  chatId: string;
  nodeId: string;
  requestId: string;
  error: string;
  failedAt: number;
  mvuData?: unknown;
}

interface TowerGenerationMonitorBridge {
  receiveTowerGenerationStatus?(status: TowerGenerationQueueStatus): void;
  receiveTowerGenerationCompleted?(payload: TowerGenerationCompletedPayload): void;
  receiveTowerGenerationFailed?(payload: TowerGenerationBridgeFailure): void;
  beginStructuredOperation?(input: { generationId: string; detail: string }): void;
  applyStructuredOperation?(input: { generationId: string; detail: string; rawOutput?: string }): void;
  completeStructuredOperation?(input: { generationId: string; summary: string; rawOutput?: string }): void;
  fail?(error: unknown, generationId?: string): void;
}

interface RestMutationBridgeRequest {
  spec: 'mwg.rest-mutation-request/v1';
  kind: 'upgrade' | 'transform';
  nodeId: string;
  runInstanceId?: string;
  cardId?: string;
}

export interface DesignAssistantControllerOptions {
  towerCoordinator?: boolean;
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseStructuredRecord(value: string | Record<string, any>): Record<string, any> {
  if (isRecord(value)) return value;
  const source = String(value || '').trim();
  const unfenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() || source;
  const candidates = [unfenced];
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  for (const candidate of Array.from(new Set(candidates))) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  throw new Error('营火后台没有返回合法 JSON');
}

function restMutationJsonSchema(kind: RestMutationBridgeRequest['kind']): Record<string, any> {
  if (kind === 'upgrade') {
    return {
      name: 'mwg_rest_card_upgrade',
      description: '魔法少女世界营火卡牌升级补丁',
      strict: false,
      value: {
        type: 'object',
        properties: {
          patch: {
            type: 'object',
            properties: {
              node_id: { type: 'string' },
              card_id: { type: 'string' },
              id: { type: 'string' },
              name: { type: 'string' },
              cost: {},
              effects: {},
              discard_effects: {},
              trigger: { type: 'string' },
              creates: { type: 'array' },
              retain: { type: 'boolean' },
              exhaust: { type: 'boolean' },
              ethereal: { type: 'boolean' },
              innate: { type: 'boolean' },
            },
            required: ['node_id', 'card_id'],
            additionalProperties: false,
          },
        },
        required: ['patch'],
        additionalProperties: false,
      },
    };
  }
  return {
    name: 'mwg_rest_card_transform',
    description: '魔法少女世界营火卡牌变形结果',
    strict: false,
    value: {
      type: 'object',
      properties: { card: { type: 'object' } },
      required: ['card'],
      additionalProperties: false,
    },
  };
}

/**
 * Tavern Helper stores one variable object per swipe, so raw chat JSON uses an
 * array. `Mvu.getMvuData` should already return the selected object, but older
 * bridges and interrupted reloads can leak either `[data]` or `{ "0": data }`
 * across the boundary. Unwrap only that exact single-entry shape; accepting a
 * general numeric-key object would hide real corruption.
 */
export function normalizeLatestMvuRoot(value: unknown): Record<string, any> | null {
  let current: unknown = value;
  for (let depth = 0; depth < 2; depth += 1) {
    if (isRecord(current) && isRecord(current.stat_data)) return current;
    if (Array.isArray(current) && current.length === 1) {
      current = current[0];
      continue;
    }
    if (isRecord(current) && Object.keys(current).length === 1 && Object.hasOwn(current, '0')) {
      current = current['0'];
      continue;
    }
    break;
  }
  return isRecord(current) && isRecord(current.stat_data) ? current : null;
}

function hasRepairHelperCapabilities(value: Record<string, any> | null): value is Record<string, any> {
  return Boolean(value) && TAVERN_HELPER_REPAIR_FUNCTIONS.every(name => typeof value![name] === 'function');
}

function hasPendingBattleSettlement(value: unknown): boolean {
  const root = normalizeLatestMvuRoot(value);
  const request = root?.stat_data?.reward?.request;
  return isRecord(request) && request.marker === '[MVU_BATTLE_SETTLEMENT]';
}

function cleanTowerNarrative(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<(?:UpdateVariable|VariableUpdate|Update)>[\s\S]*?<\/(?:UpdateVariable|VariableUpdate|Update)>/gi, '')
    .replace(/<\/?(?:StatusPlaceHolderImpl|BATTLE_START|BATTLE_PENDING|CONTENT_PENDING|CHARACTER_INIT_PENDING)\s*\/?\s*>/gi, '')
    .trim();
}

function towerNarrativePrompt(stat: Record<string, any>, activeNode: Record<string, any>): string {
  const kind = String(activeNode.kind || 'event');
  const facts: Record<string, unknown> = {
    node: {
      id: activeNode.node_id,
      kind,
      title: activeNode.title,
      prepared_context: activeNode.narrative,
    },
    status: stat.status,
    npcs: stat.npcs,
    factions: stat.factions,
  };
  if (isBattleRunNode(kind as RunNodeKind)) {
    facts.encounter = {
      enemy: stat.battle?.enemy,
      enemies: stat.battle?.enemies,
    };
  } else {
    facts.node_content = stat[`run_${kind}`];
  }
  const serializedFacts = JSON.stringify(facts).slice(0, 20_000);
  return [
    '[爬塔节点剧情]',
    '玩家已经在单页爬塔界面进入了以下节点。请使用当前角色卡、世界书、聊天记录和当前启用的原预设，自然续写这个节点的剧情正文。',
    '不要规定或解释正文长度、段落数量、节奏、文风；按当前预设正常发挥。',
    '下面的节点类型、人物和已准备内容是已经确定的事实，请保持一致；不要提前替玩家结算尚未进行的战斗、事件选择、购买、领奖或营火操作。',
    '只返回供玩家阅读的剧情正文，不输出 JSON、UpdateVariable、变量命令、系统说明或后台分析。',
    `[当前节点事实]\n${serializedFacts}`,
  ].join('\n');
}

function towerOpeningNarrativePrompt(stat: Record<string, any>, openingContent: Record<string, any>): string {
  const choices = Array.isArray(openingContent.choices)
    ? openingContent.choices.map(choice => isRecord(choice) ? {
      id: choice.id,
      label: choice.label,
      description: choice.description,
    } : choice)
    : [];
  const facts = {
    opening: {
      title: openingContent.title,
      prepared_context: openingContent.narrative,
      choices,
    },
    status: stat.status,
    npcs: stat.npcs,
    factions: stat.factions,
  };
  const serializedFacts = JSON.stringify(facts).slice(0, 20_000);
  return [
    '[爬塔开局馈赠剧情]',
    '玩家正在单页爬塔界面开始新的远征。请使用当前角色卡、世界书、聊天记录和当前启用的原预设，自然生成这次开局馈赠事件的剧情正文。',
    '下列事件框架与可选行动已经确定；正文可以自由发挥表现方式，但不要改变选择的身份或暗示不存在的选项。',
    '只返回玩家可阅读的剧情正文，不要输出 JSON、Markdown 代码块、UpdateVariable、变量命令或运行标记。',
    '正文长度、段落、节奏、文风和推进速度完全交给当前原预设决定。',
    serializedFacts,
  ].join('\n');
}

/**
 * Recover the nearest failed request from the saved route after a page reload.
 * The route graph is used instead of scanning every failed envelope so an
 * abandoned branch can never be retried by the generic settings button.
 */
function nearestReachableFailedTowerNode(run: RunState): string {
  if (run.routeMode !== 'map' || !run.map || run.phase === 'won' || run.phase === 'lost') return '';
  const nodeById = new Map(run.map.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of run.map.edges) {
    const children = outgoing.get(edge.from) || [];
    children.push(edge.to);
    outgoing.set(edge.from, children);
  }
  const compareNodeId = (leftId: string, rightId: string): number => {
    const left = nodeById.get(leftId);
    const right = nodeById.get(rightId);
    return (Number(left?.floor) - Number(right?.floor))
      || (Number(left?.column) - Number(right?.column))
      || leftId.localeCompare(rightId);
  };
  for (const children of outgoing.values()) children.sort(compareNodeId);

  const roots = run.phase === 'in_node' && run.currentNode
    ? [run.currentNode.id]
    : run.choices.map(choice => choice.id).sort(compareNodeId);
  const queue = [...roots];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node || node.act !== run.act) continue;
    if (run.nodeContent[nodeId]?.phase === 'failed') return nodeId;
    for (const childId of outgoing.get(nodeId) || []) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }
  return '';
}

function applyCalibratedEnemy(target: unknown, source: unknown): void {
  if (!isRecord(target) || !isRecord(source)) return;
  const targetBattle = target.stat_data?.battle;
  const sourceBattle = source.stat_data?.battle;
  if (!isRecord(targetBattle) || !isRecord(sourceBattle)) return;
  targetBattle.enemy = clone(sourceBattle.enemy);
  targetBattle.enemies = clone(sourceBattle.enemies);
}

function assessInitialTowerContent(variables: unknown) {
  if (!isRecord(variables)) return null;
  const stat = isRecord(variables.stat_data) ? variables.stat_data : variables;
  const battle = stat.battle;
  if (!isRecord(battle)) return null;
  const core = isRecord(battle.core) ? battle.core : {};
  return assessInitialPlayerContent(createContentPackFromMvuBattle(battle), {
    emoji: core.emoji,
    hp: core.hp,
    maxHp: core.max_hp,
    lust: core.lust,
    maxLust: core.max_lust,
    level: battle.level,
    exp: battle.exp,
  });
}

function settingRoot(context: SillyTavernContext): Record<string, any> {
  const existing = context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID];
  const normalized = normalizeDesignAssistantSettings(existing);
  context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID] = normalized;
  return normalized;
}

export class DesignAssistantController {
  private readonly engine: DesignAssistantEngine;
  private active = false;
  private warming: Promise<MvuDesignSnapshot | null> | null = null;
  private warmupScheduled = false;
  private warmupRerunRequested = false;
  private listenerContext: SillyTavernContext | null = null;
  private latestSnapshot: MvuDesignSnapshot | null = null;
  private status: DesignAssistantStatus = { phase: 'idle', message: '等待 MVU 数据', updatedAt: 0 };
  private readonly workerClient: DesignWorkerClient;
  private readonly towerGenerationHost: TowerGenerationHost;
  private readonly structuredGenerate: TowerGenerationPorts['generate'];
  private readonly persistentMvuRepairHost: PersistentMvuRepairHost;
  private readonly automaticSettlementAttempts = new Set<string>();
  private settlementRecoveryWatchGeneration = 0;
  private readonly automaticInitialContentAttempts = new Map<string, number>();
  private initialContentRecoveryWatchGeneration = 0;
  private readonly reasoningFinalRecoveryHost = new ReasoningFinalRecoveryHost();
  private reasoningRecoveryWatchGeneration = 0;
  private readonly towerCoordinator: TowerLookaheadCoordinator | null;
  private towerChatId: string | null = null;
  private readonly publishedTowerTerminals = new Set<string>();
  private readonly towerRequestPromises = new Map<string, Promise<TowerGenerationResult>>();
  private readonly towerNarrativePromises = new Map<string, Promise<void>>();
  private readonly towerPreGenerationSnapshots = new Map<string, Record<string, any>>();
  private towerArchivePromise: Promise<number> | null = null;
  private readonly archivedTowerRuns = new Set<string>();
  private readonly towerActivityTouches = new Map<string, { revision: number; touchedAt: number }>();
  private readonly rerenderedTowerRestoreSnapshots = new Set<string>();
  private towerActivitySavePromise: Promise<void> = Promise.resolve();
  private towerActivityWatchGeneration = 0;
  private readonly handledMvuRequestPayloads = new WeakSet<object>();
  private tavernHelperRequestUnsubscribe: (() => void) | null = null;
  private tavernHelperEventWatchGeneration = 0;
  private activeMvuLifecyclePrompt: ActiveMvuLifecyclePrompt | null = null;
  private readonly restMutationPromises = new Map<string, Promise<unknown>>();

  constructor(
    private readonly host: DesignAssistantHost,
    engine = new DesignAssistantEngine(),
    towerGenerationPorts: TowerGenerationPorts = createGlobalTowerGenerationPorts(),
    options: DesignAssistantControllerOptions = {},
  ) {
    this.engine = engine;
    this.workerClient = new DesignWorkerClient(engine);
    this.structuredGenerate = towerGenerationPorts.generate;
    this.persistentMvuRepairHost = new PersistentMvuRepairHost({
      generate: towerGenerationPorts.generate,
      now: () => this.host.now(),
      onStructuredProgress: event => this.onStructuredRepairProgress(event),
    });
    const queue = new TowerGenerationQueue({ onStatus: this.onTowerGenerationStatus });
    this.towerGenerationHost = new TowerGenerationHost(towerGenerationPorts, {
      queue,
      now: () => this.host.now(),
    });
    this.towerCoordinator = options.towerCoordinator === false
      ? null
      : new TowerLookaheadCoordinator({
        snapshot: () => this.towerCoordinatorScope(),
        prepareDesignSnapshot: async () => { await this.warmup(); },
        replaceLatest: (data, chatId, messageId) => this.replaceLatestMvuData(data, chatId, messageId),
        requestGeneration: request => this.requestTowerGeneration(
          request as TowerCoordinatorGenerationRequest & TowerGenerationBridgeRequest,
        ),
        cancelGeneration: (request, reason) => this.cancelTowerGeneration(request, reason),
        onError: (message, error) => this.debug(message, error),
      });
  }

  activate(): void {
    if (this.active) return;
    const context = this.host.context();
    if (!context) {
      this.setStatus('error', 'SillyTavern 扩展上下文不可用');
      return;
    }
    this.active = true;
    this.listenerContext = context;
    settingRoot(context);
    this.towerChatId = this.currentChatId();
    this.debug('controller activated', {
      chatId: this.towerChatId,
      characterId: context.characterId,
      groupId: context.groupId,
      cardScoped: isMagicGirlWorldCharacter(context),
      tavernHelperReady: Boolean((globalThis as Record<string, any>).TavernHelper),
    });
    if (this.towerChatId) {
      this.towerGenerationHost.activateChat(this.towerChatId);
      this.restoreTowerArchiveMetadata(this.towerChatId);
    }
    this.towerCoordinator?.activateChat(this.towerChatId);
    context.eventSource.on(context.eventTypes.GENERATE_AFTER_DATA || EVENT_GENERATE_AFTER_DATA, this.onOfficialGenerateAfterData);
    context.eventSource.on(
      context.eventTypes.CHAT_COMPLETION_SETTINGS_READY || EVENT_CHAT_COMPLETION_SETTINGS_READY,
      this.onOfficialGenerateAfterData,
    );
    context.eventSource.on(context.eventTypes.CHAT_CHANGED || EVENT_CHAT_CHANGED, this.onChatChanged);
    context.eventSource.on(context.eventTypes.CHAT_LOADED || EVENT_CHAT_LOADED, this.onChatLoaded);
    context.eventSource.on(context.eventTypes.GENERATION_ENDED || EVENT_GENERATION_ENDED, this.onGenerationEnded);
    context.eventSource.on(EVENT_MVU_INITIALIZED, this.onMvuInitialized);
    context.eventSource.on(EVENT_CHARACTER_RUNTIME_INITIALIZED, this.onCharacterRuntimeInitialized);
    context.eventSource.on(EVENT_MVU_UPDATE_STARTED, this.onMvuUpdateStarted);
    context.eventSource.on(EVENT_MVU_UPDATE_ENDED, this.onMvuUpdateEnded);
    this.publishDashboard();
    void this.engine.initializeKnowledgeGraph().catch(error => {
      this.fail('流派知识图谱持久化失败，已继续使用内存图谱', error, false);
    });
    this.scheduleReasoningFinalRecovery('extension-activate', Boolean(this.host.mvu()));
    this.scheduleTowerChatActivityRecovery('extension-activate');
    this.scheduleInitialTowerContentRecovery('extension-activate');
    this.scheduleBattleSettlementRecovery('extension-activate');
    this.scheduleTavernHelperEventSubscription();
    this.scheduleWarmup();
  }

  deactivate(): void {
    if (!this.active) return;
    // The official context object can be replaced while a chat is loading.
    // Always unsubscribe from the exact event source used during activation.
    const context = this.listenerContext || this.host.context();
    const remove = context?.eventSource.removeListener?.bind(context.eventSource);
    if (remove && context) {
      remove(context.eventTypes.GENERATE_AFTER_DATA || EVENT_GENERATE_AFTER_DATA, this.onOfficialGenerateAfterData);
      remove(
        context.eventTypes.CHAT_COMPLETION_SETTINGS_READY || EVENT_CHAT_COMPLETION_SETTINGS_READY,
        this.onOfficialGenerateAfterData,
      );
      remove(context.eventTypes.CHAT_CHANGED || EVENT_CHAT_CHANGED, this.onChatChanged);
      remove(context.eventTypes.CHAT_LOADED || EVENT_CHAT_LOADED, this.onChatLoaded);
      remove(context.eventTypes.GENERATION_ENDED || EVENT_GENERATION_ENDED, this.onGenerationEnded);
      remove(EVENT_MVU_INITIALIZED, this.onMvuInitialized);
      remove(EVENT_CHARACTER_RUNTIME_INITIALIZED, this.onCharacterRuntimeInitialized);
      remove(EVENT_MVU_UPDATE_STARTED, this.onMvuUpdateStarted);
      remove(EVENT_MVU_UPDATE_ENDED, this.onMvuUpdateEnded);
    }
    const monitor = (globalThis as any).MagicGirlWorldMvuMonitor;
    monitor?.setDesignAssistant?.(null);
    this.active = false;
    this.listenerContext = null;
    this.warmupScheduled = false;
    this.warmupRerunRequested = false;
    this.latestSnapshot = null;
    if (this.towerChatId) this.towerGenerationHost.queue.cancelChat(this.towerChatId, '设计辅助器已停止');
    this.towerChatId = null;
    this.publishedTowerTerminals.clear();
    this.towerRequestPromises.clear();
    this.towerNarrativePromises.clear();
    this.towerPreGenerationSnapshots.clear();
    this.persistentMvuRepairHost.clear();
    this.automaticSettlementAttempts.clear();
    this.settlementRecoveryWatchGeneration += 1;
    this.automaticInitialContentAttempts.clear();
    this.initialContentRecoveryWatchGeneration += 1;
    this.reasoningFinalRecoveryHost.clear();
    this.reasoningRecoveryWatchGeneration += 1;
    this.towerActivityWatchGeneration += 1;
    this.tavernHelperEventWatchGeneration += 1;
    this.tavernHelperRequestUnsubscribe?.();
    this.tavernHelperRequestUnsubscribe = null;
    this.clearMvuLifecyclePrompt('controller-deactivated');
    this.towerArchivePromise = null;
    this.archivedTowerRuns.clear();
    this.towerActivityTouches.clear();
    this.rerenderedTowerRestoreSnapshots.clear();
    this.towerActivitySavePromise = Promise.resolve();
    this.towerCoordinator?.deactivate();
    this.workerClient.dispose();
  }

  getSettings(): DesignAssistantSettings {
    const context = this.host.context();
    return context ? normalizeDesignAssistantSettings(settingRoot(context)) : clone(DEFAULT_DESIGN_ASSISTANT_SETTINGS);
  }

  getState(): DesignAssistantChatState {
    const context = this.host.context();
    return normalizeDesignAssistantChatState(context?.chatMetadata?.[DESIGN_ASSISTANT_METADATA_KEY]);
  }

  getStatus(): DesignAssistantStatus {
    return clone(this.status);
  }

  getCapabilities() {
    return {
      spec: 'mwg.design-assistant/v1' as const,
      version: '0.2.0' as const,
      towerGeneration: true as const,
      towerCoordinator: true as const,
      towerArchive: true as const,
      persistentMvuRepair: true as const,
    };
  }

  getDashboard(): DesignAssistantDashboard {
    const available = isMagicGirlWorldCharacter(this.host.context());
    return {
      spec: 'mwg.design-assistant-dashboard/v1',
      available,
      settings: this.getSettings(),
      status: this.getStatus(),
      threaded: this.workerClient.threaded,
      graph: this.getKnowledgeGraphStats(),
      state: this.getState(),
      snapshot: available ? clone(this.latestSnapshot) : null,
    };
  }

  updateSettings(patch: Partial<DesignAssistantSettings>): DesignAssistantSettings {
    const next = normalizeDesignAssistantSettings({ ...this.getSettings(), ...clone(patch) });
    this.saveSettings(next);
    return clone(next);
  }

  /**
   * Persistent owner for MVU's in-place second-stage repair. It is deliberately
   * broader than tower scope so the same character's natural-language card
   * repair remains safe in story mode; unrelated character cards are no-ops.
   */
  requestMvuExtraRepair(input: PersistentMvuRepairRequest): Promise<void> | null {
    const context = this.host.context();
    const chatId = this.currentChatId();
    if (!this.active || !context || !chatId || !isMagicGirlWorldCharacter(context)) return null;
    const isCurrent = () => (
      this.active &&
      this.currentChatId() === chatId &&
      isMagicGirlWorldCharacter(this.host.context())
    );
    return (async () => {
      const deadline = Date.now() + TAVERN_HELPER_REPAIR_WAIT_MS;
      while (isCurrent() && Date.now() <= deadline) {
        const helper = createEventBridgedTavernHelper(
          (globalThis as any).TavernHelper,
          context,
        );
        if (hasRepairHelperCapabilities(helper)) {
          await this.persistentMvuRepairHost.request(helper, chatId, input, isCurrent);
          return;
        }
        await new Promise<void>(resolve => globalThis.setTimeout(resolve, TAVERN_HELPER_REPAIR_POLL_MS));
      }
      if (!isCurrent()) throw new Error('聊天已切换，已取消旧存档的 MVU 修复');
      throw new Error('Tavern Helper 额外模型修复接口尚未就绪');
    })();
  }

  private readonly onStructuredRepairProgress = (event: {
    phase: 'begin' | 'applying' | 'complete' | 'error';
    generationId: string;
    detail: string;
    rawOutput?: string;
    summary?: string;
    error?: unknown;
  }): void => {
    const monitor = this.towerMonitor();
    if (event.phase === 'begin') {
      monitor?.beginStructuredOperation?.({
        generationId: event.generationId,
        detail: event.detail,
      });
      return;
    }
    if (event.phase === 'applying') {
      monitor?.applyStructuredOperation?.({
        generationId: event.generationId,
        detail: event.detail,
        rawOutput: event.rawOutput,
      });
      return;
    }
    if (event.phase === 'complete') {
      monitor?.completeStructuredOperation?.({
        generationId: event.generationId,
        summary: event.summary || event.detail,
        rawOutput: event.rawOutput,
      });
      return;
    }
    monitor?.fail?.(event.error || new Error(event.detail));
  };

  /**
   * The first narrative response may already contain an incomplete
   * UpdateVariable block.  In that case the message iframe is not a reliable
   * owner for the repair: MVU can rebuild it while the second request is still
   * settling.  The persistent extension therefore owns the one-time tower
   * gate, repairs an empty/invalid player kit, and creates the map only after
   * the repaired snapshot is durable.
   */
  private scheduleInitialTowerContentRecovery(reason: string): void {
    if (!this.active) return;
    const watchGeneration = ++this.initialContentRecoveryWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        const deadline = Date.now() + 45_000;
        while (
          this.active
          && watchGeneration === this.initialContentRecoveryWatchGeneration
          && Date.now() <= deadline
        ) {
          const context = this.host.context();
          const chatId = this.currentChatId();
          const messageId = this.latestMessageId();
          if (!context || !chatId || messageId === 'latest' || !isMagicGirlWorldCharacter(context)) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          const message = context.chat?.[messageId];
          if (
            !message
            || message.is_user !== false
            || message.is_system === true
            || typeof message.mes !== 'string'
            || !message.mes.trim()
          ) return;
          const persisted = readPersistedMessageVariableSnapshot(context, messageId);
          if (!persisted) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          const root = normalizeLatestMvuRoot(persisted.variables);
          if (!root) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          const stat = root.stat_data;
          const lock = isRecord(stat?.game_mode_lock) ? stat.game_mode_lock : null;
          if (lock?.schemaVersion !== 1 || lock.mode !== 'tower' || stat?.run != null) return;

          const readiness = assessInitialTowerContent(root);
          if (readiness?.ok) {
            const draft = clone(root);
            ensureRunStateInStat(draft.stat_data, deriveRunSeed(draft.stat_data));
            await this.replaceLatestMvuData(draft, chatId, messageId);
            this.scheduleTowerChatActivityTouch(draft);
            this.scheduleTowerGeneration(`initial-content-ready:${reason}`);
            this.debug(`initialized tower run after durable player-content gate (${reason})`, {
              chatId,
              messageId,
            });
            return;
          }

          // Do not spend an attempt while the first MVU pass has not exposed a
          // battle object yet. It may still arrive on the immediately following
          // update-ended event.
          if (!readiness) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 250));
            continue;
          }
          const attemptKey = `${chatId}:${messageId}`;
          const attempts = this.automaticInitialContentAttempts.get(attemptKey) || 0;
          if (attempts >= 2) return;
          this.automaticInitialContentAttempts.set(attemptKey, attempts + 1);
          const repair = this.requestMvuExtraRepair({
            spec: 'mwg.mvu-repair-request/v1',
            scope: 'initial-content',
            prompt: formatPlayerContentRepairPrompt(readiness),
          });
          if (!repair) return;
          try {
            await repair;
          } catch (error) {
            this.debug(`automatic initial tower content repair failed (${reason})`, {
              attempt: attempts + 1,
              readiness: formatPlayerContentReadiness(readiness, 8),
              error,
            });
            if (attempts + 1 >= 2) return;
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 250));
            continue;
          }
          // setChatMessages can rebuild the visible iframe. The extension stays
          // alive, so re-read the durable exact-message snapshot here and let
          // this same loop initialize the map without waiting for a page event.
          await new Promise<void>(resolve => globalThis.setTimeout(resolve, 100));
        }
        this.debug(`initial tower content recovery timed out (${reason})`);
      })().catch(error => this.debug(`initial tower content recovery failed (${reason})`, error));
    });
  }

  /**
   * Battle result variables can survive a reload even when the ordinary MVU
   * iframe that should finish rewards or penalties no longer exists. Re-read
   * the selected assistant floor and let the persistent extension finish only
   * the settlement transaction. One automatic attempt per floor prevents a
   * malformed provider response from becoming an infinite request loop.
   */
  private scheduleBattleSettlementRecovery(reason: string): void {
    if (!this.active) return;
    const watchGeneration = ++this.settlementRecoveryWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        const deadline = Date.now() + 20_000;
        let lastObservedChatId: string | null = null;
        let lastObservedMessageId: number | 'latest' = 'latest';
        while (
          this.active
          && watchGeneration === this.settlementRecoveryWatchGeneration
          && Date.now() <= deadline
        ) {
          const expectedChatId = this.currentChatId();
          const expectedMessageId = this.latestMessageId();
          lastObservedChatId = expectedChatId;
          lastObservedMessageId = expectedMessageId;
          if (!expectedChatId) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          if (expectedMessageId === 'latest') {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          const attemptKey = `${expectedChatId}:${expectedMessageId}`;
          if (this.automaticSettlementAttempts.has(attemptKey)) return;
          const context = this.host.context();
          const latestMessage = context?.chat?.[expectedMessageId];
          // A battle summary is first appended as a user floor. Message-level
          // variables are inherited there, so the unfinished settlement marker
          // can already be visible before the narrative model creates its
          // assistant floor. Starting the repair on that transient user floor
          // makes getLastMessageId() change while the structured model is still
          // running and is then (correctly, but misleadingly) rejected as a
          // chat switch. Only a persisted, non-empty assistant floor owns the
          // settlement transaction.
          if (
            !latestMessage
            || latestMessage.is_user !== false
            || latestMessage.is_system === true
            || typeof latestMessage.mes !== 'string'
            || !latestMessage.mes.trim()
          ) return;
          // Do not use Tavern Helper's inherited value as the readiness signal.
          // A streaming assistant floor can resolve the battle request that was
          // attached to the preceding user summary even though this assistant
          // has not finished its own MVU update. Starting a structured repair
          // at that point produces “current assistant floor has no MVU
          // variables” and consumes the only automatic attempt. The exact
          // message snapshot is the authoritative ownership boundary.
          const attachedSnapshot = readPersistedMessageVariableSnapshot(context, expectedMessageId);
          if (!attachedSnapshot) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          if (!hasPendingBattleSettlement(attachedSnapshot.variables)) return;
          const helper = createEventBridgedTavernHelper(
            (globalThis as Record<string, any>).TavernHelper,
            context,
          );
          if (context && isMagicGirlWorldCharacter(context) && hasRepairHelperCapabilities(helper)) {
            // The top-window extension can see message variables before the
            // card iframe has registered its monitor. Waiting here keeps the
            // automatic structured request visible instead of silently losing
            // its begin event during a cold chat restore.
            if (!this.towerMonitor()) {
              await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
              continue;
            }
            this.automaticSettlementAttempts.add(attemptKey);
            const request = normalizeLatestMvuRoot(attachedSnapshot.variables)?.stat_data?.reward?.request;
            this.debug(`detected unfinished battle settlement (${reason})`, {
              chatId: expectedChatId,
              messageId: expectedMessageId,
              result: request?.result,
            });
            const repair = this.requestMvuExtraRepair({
              spec: 'mwg.mvu-repair-request/v1',
              scope: 'battle-settlement',
              prompt: [
                '[MVU_BATTLE_SETTLEMENT]',
                '自动完成当前战斗结算。只生成程序请求规定的奖励候选与剧情已经支持的持久后果；不要改写战斗结果或其他变量。',
              ].join('\n'),
            });
            if (repair) await repair;
            return;
          }
          await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
        }
        this.debug(`battle settlement recovery prerequisites unavailable (${reason})`, {
          chatId: lastObservedChatId,
          messageId: lastObservedMessageId,
        });
      })().catch(error => {
        // Keep reward.request untouched. The player can still use the manual
        // natural-language repair button after inspecting the provider error.
        this.debug(`automatic battle settlement repair failed (${reason})`, error);
      });
    });
  }

  /**
   * Generate and commit a campfire card mutation without creating a Tavern
   * user/assistant floor. The extension owns the model request and the final
   * MVU transaction, so a story preset can neither turn the request into prose
   * nor leave a half-written `run_upgrade` marker behind.
   */
  requestRestMutation(input: RestMutationBridgeRequest): Promise<unknown> | null {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    if (
      !isRecord(input)
      || input.spec !== 'mwg.rest-mutation-request/v1'
      || !['upgrade', 'transform'].includes(String(input.kind))
    ) throw new Error('营火后台请求无效');
    const nodeId = String(input.nodeId || '').trim();
    const identity = String(input.runInstanceId || input.cardId || '').trim();
    if (!nodeId || !identity) throw new Error('营火后台请求缺少节点或卡牌身份');
    const key = `${chatId}:${messageId}:${nodeId}:${input.kind}:${identity}`;
    const duplicate = this.restMutationPromises.get(key);
    if (duplicate) return duplicate;

    const generationId = `mwg-rest-${input.kind}-${messageId}-${this.host.now()}`;
    const promise = (async () => {
      const monitor = this.towerMonitor();
      monitor?.beginStructuredOperation?.({
        generationId,
        detail: input.kind === 'upgrade' ? '正在为选中的卡牌生成升级方案' : '正在为选中的卡牌生成变形结果',
      });
      try {
        const before = this.readLatestMvuData(messageId);
        const stat = before.stat_data;
        const runResult = validateRunState(stat?.run);
        if (!runResult.ok) throw new Error(`爬塔状态无效：${runResult.message}`);
        const run = runResult.value;
        if (run.phase !== 'in_node' || run.currentNode?.kind !== 'rest' || run.currentNode.id !== nodeId) {
          throw new Error('营火节点已经变化，请重新选择卡牌');
        }
        const cards = migratePersistentRunDeck(
          normalizeMvuList<Record<string, any>>(stat?.battle?.cards),
        );
        const selected = cards.find(card => card.runInstanceId === input.runInstanceId)
          || cards.find(card => card.id === input.cardId);
        if (!selected) throw new Error('选中的营火卡牌已经不存在');
        const compactDeck = cards.slice(0, 80).map(card => ({
          id: card.id,
          name: card.name,
          type: card.type,
          rarity: card.rarity,
          cost: card.cost,
          effects: card.effects,
          trigger: card.trigger,
          upgrade_level: card.upgrade_level,
        }));
        const prompt = input.kind === 'upgrade'
          ? [
              '你是魔法少女世界爬塔模式的营火卡牌升级器。只生成数据，不续写剧情。',
              `节点固定为 ${nodeId}。只升级这张牌：${JSON.stringify(compactCardForUpgrade(selected))}`,
              `当前牌组用于判断构筑方向：${JSON.stringify(compactDeck)}`,
              '返回 {"patch":升级补丁}。patch 必须包含原 node_id、card_id，并且只做一次有意义的规则强化。',
              '不要修改卡牌身份、来源、数量或运行实例；不要输出 description、剧情、Markdown、UpdateVariable 或解释。',
            ].join('\n')
          : [
              '你是魔法少女世界爬塔模式的营火卡牌变形器。只生成数据，不续写剧情。',
              `节点固定为 ${nodeId}。待变形卡牌：${JSON.stringify(compactCardForUpgrade(selected))}`,
              `当前牌组用于判断构筑方向：${JSON.stringify(compactDeck)}`,
              '返回 {"card":一张完整、合法、quantity=1 的替换卡牌}。新牌应保持相近稀有度与强度，但玩法明显不同并尽量服务当前构筑。',
              '不要写 runInstanceId、templateId、origin、parentRunInstanceId、$meta；不要输出剧情、Markdown、UpdateVariable 或解释。',
            ].join('\n');
        const generated = await this.structuredGenerate({
          generation_id: generationId,
          user_input: prompt,
          should_stream: false,
          should_silence: true,
          max_chat_history: 0,
          json_schema: restMutationJsonSchema(input.kind),
        });
        const parsed = parseStructuredRecord(generated);
        const rawOutput = typeof generated === 'string' ? generated : JSON.stringify(generated, null, 2);
        monitor?.applyStructuredOperation?.({
          generationId,
          detail: '方案已返回，正在校验卡牌并写入当前楼层',
          rawOutput,
        });

        const draft = this.readLatestMvuData(messageId);
        const currentRun = validateRunState(draft.stat_data?.run);
        if (!currentRun.ok) throw new Error(`爬塔状态无效：${currentRun.message}`);
        if (
          currentRun.value.stateRevision !== run.stateRevision
          || currentRun.value.phase !== 'in_node'
          || currentRun.value.currentNode?.id !== nodeId
        ) throw new Error('营火状态在生成期间已经变化，本次结果未写入');
        const transaction = input.kind === 'upgrade'
          ? executeUnifiedRunTransactionInStat(draft.stat_data, {
              kind: 'rest_upgrade_card',
              runInstanceId: selected.runInstanceId,
              patch: parsed.patch,
              expectedRevision: run.stateRevision,
              source: { kind: 'player', id: 'tower-rest-ui' },
            })
          : executeUnifiedRunTransactionInStat(draft.stat_data, {
              kind: 'rest_transform_card',
              runInstanceId: selected.runInstanceId,
              replacement: parsed.card,
              expectedRevision: run.stateRevision,
              source: { kind: 'player', id: 'tower-rest-ui' },
            });
        await this.replaceLatestMvuData(draft, chatId, messageId);
        this.scheduleTowerChatActivityTouch(draft);
        this.towerCoordinator?.requestRecovery();
        this.scheduleWarmup();
        monitor?.completeStructuredOperation?.({
          generationId,
          summary: transaction.log.summary,
          rawOutput,
        });
        return clone(transaction.value);
      } catch (error) {
        this.towerMonitor()?.fail?.(error, generationId);
        throw error;
      }
    })().finally(() => {
      if (this.restMutationPromises.get(key) === promise) this.restMutationPromises.delete(key);
    });
    this.restMutationPromises.set(key, promise);
    return promise;
  }

  queryKnowledgeGraph(ids: string[] = [], depth = 1) {
    return this.engine.queryKnowledgeGraph(ids, this.getState().lineage, depth);
  }

  /**
   * Trusted parent-window endpoint used by the character iframe. Story mode,
   * other character cards, unlocked saves and inactive controllers are strict
   * no-ops and never touch Tavern Helper's message or generation APIs.
   */
  async requestTowerGeneration(
    input: TowerGenerationBridgeRequest,
  ): Promise<TowerGenerationResult | null> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    if (!input || typeof input !== 'object') return null;
    if (input.sourceMessageId !== undefined && input.sourceMessageId !== messageId) {
      throw new TowerGenerationCancelledError('The tower request belongs to an older message floor.');
    }
    const normalized = this.normalizeTowerRequest(chatId, input, messageId);
    const key = towerGenerationTaskKey(normalized.request);
    const duplicate = this.towerRequestPromises.get(key);
    if (duplicate) return duplicate;

    const beforeGeneration = this.readLatestMvuData(messageId);
    const promise = this.executeTowerGeneration(normalized, beforeGeneration);
    this.towerPreGenerationSnapshots.set(key, clone(beforeGeneration));
    this.towerRequestPromises.set(key, promise);
    return promise;
  }

  /**
   * Low-level archive primitive. A coordinator may call it only when the run
   * is won/lost or explicitly exited; ordinary node completion is not an
   * archive boundary. Active battle sessions always return false.
   */
  async persistTowerGeneration(
    keyInput: Pick<TowerGenerationBridgeRequest, 'nodeId' | 'requestId'>,
  ): Promise<boolean | null> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    const key = {
      chatId,
      nodeId: String(keyInput?.nodeId || '__tower_opening__'),
      requestId: String(keyInput?.requestId || ''),
    };
    const latestMvuData = this.readLatestMvuData(messageId);
    if (this.hasActiveBattleSession(latestMvuData)) return false;
    // The committed run state is the authoritative save. Appending hidden
    // request/response floors breaks single-floor play and duplicates the
    // full prompt and response during a long run.
    this.releaseTowerGenerationRecord(key);
    this.saveTowerArchiveMetadata(chatId);
    return true;
  }

  async retryTowerGeneration(input: { generationType?: 'node' | 'opening'; nodeId?: string }): Promise<boolean | null> {
    const chatId = this.currentChatId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId) || !this.towerCoordinator) return null;
    if (input?.generationType === 'opening' || input?.nodeId === '__tower_opening__' || input?.nodeId === 'tower-opening') {
      return this.towerCoordinator.retryOpening();
    }
    let nodeId = String(input?.nodeId || '').trim();
    if (!nodeId) {
      const latest = this.readLatestMvuData(this.latestMessageId());
      const parsed = validateRunState(latest.stat_data?.run);
      if (!parsed.ok) throw new Error(`爬塔存档不可用：${parsed.message}`);
      if (parsed.value.opening.phase === 'failed') return this.towerCoordinator.retryOpening();
      nodeId = nearestReachableFailedTowerNode(parsed.value);
    }
    if (!nodeId) throw new Error('当前存档中没有可重试的爬塔节点');
    return this.towerCoordinator.retryNode(nodeId);
  }

  /** Wake the idempotent coordinator after a character-page program write. */
  scheduleTowerGeneration(reason = 'character-runtime'): boolean {
    const chatId = this.currentChatId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId)) return false;
    const normalizedReason = String(reason || 'character-runtime').trim().slice(0, 80) || 'character-runtime';
    void this.scheduleTowerNarrativeForOpening(normalizedReason);
    void this.scheduleTowerNarrativeForActiveNode(normalizedReason);
    this.towerCoordinator?.schedule(`runtime:${normalizedReason}`);
    return true;
  }

  /** Replace the structured opening's fallback summary with prose from the player's current preset. */
  private async scheduleTowerNarrativeForOpening(reason: string): Promise<void> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return;
    const before = this.readLatestMvuData(messageId);
    const run = validateRunState(before.stat_data?.run);
    if (!run.ok || run.value.opening.phase !== 'ready' || !isRecord(run.value.opening.content)) return;
    const opening = run.value.opening;
    const openingContent = opening.content as Record<string, any>;
    if (opening.narrativePhase === 'ready' || opening.narrativePhase === 'failed') return;
    const openingRequestId = String(opening.requestId || '').trim();
    const requestId = String(opening.narrativeRequestId || `${openingRequestId}__narrative`).trim();
    if (!openingRequestId || !requestId) return;
    const request: TowerGenerationRequest = {
      chatId,
      nodeId: '__tower_opening__',
      requestId,
      prompt: towerOpeningNarrativePrompt(before.stat_data, openingContent),
      maxAttempts: 2,
      userExtra: { mwg_tower_opening_narrative: true, reason },
      assistantExtra: { mwg_tower_opening_narrative: true },
    };
    const key = towerGenerationTaskKey(request);
    if (this.towerNarrativePromises.has(key)) return this.towerNarrativePromises.get(key)!;

    const promise = (async () => {
      const claimed = clone(before);
      const claimedRun = validateRunState(claimed.stat_data?.run);
      if (
        !claimedRun.ok ||
        claimedRun.value.opening.phase !== 'ready' ||
        claimedRun.value.opening.requestId !== openingRequestId ||
        !isRecord(claimedRun.value.opening.content)
      ) return;
      const claimedOpening = {
        ...claimedRun.value.opening,
        narrativePhase: 'generating' as const,
        narrativeRequestId: requestId,
        narrativeError: undefined,
      };
      const claimedCandidate = validateRunState({ ...claimedRun.value, opening: claimedOpening });
      if (!claimedCandidate.ok) throw new Error(`开局剧情生成状态无效：${claimedCandidate.message}`);
      claimed.stat_data.run = claimedCandidate.value;
      await this.replaceLatestMvuData(claimed, chatId, messageId);
      this.towerPreGenerationSnapshots.set(key, clone(before));

      try {
        const result = await this.towerGenerationHost.generateNarrative(request);
        const narrative = cleanTowerNarrative(result.response);
        if (!narrative) throw new Error('剧情模型返回内容在移除变量标记后为空');
        const draft = this.readLatestMvuData(messageId);
        const currentRun = validateRunState(draft.stat_data?.run);
        if (
          !currentRun.ok ||
          currentRun.value.opening.phase !== 'ready' ||
          currentRun.value.opening.requestId !== openingRequestId ||
          currentRun.value.opening.narrativeRequestId !== requestId ||
          !isRecord(currentRun.value.opening.content)
        ) {
          throw new TowerGenerationCancelledError('开局剧情返回时玩家已经离开馈赠事件');
        }
        const content = clone(currentRun.value.opening.content);
        content.narrative = narrative;
        content.narrative_source = 'preset';
        const readyOpening = {
          ...currentRun.value.opening,
          content,
          narrativePhase: 'ready' as const,
          narrativeError: undefined,
        };
        const readyCandidate = validateRunState({ ...currentRun.value, opening: readyOpening });
        if (!readyCandidate.ok) throw new Error(`开局剧情提交状态无效：${readyCandidate.message}`);
        draft.stat_data.run = readyCandidate.value;
        await this.replaceLatestMvuData(draft, chatId, messageId);
        this.saveTowerArchiveMetadata(chatId);
        const payload: TowerGenerationCompletedPayload = {
          spec: 'mwg.tower-generation/v1',
          chatId,
          nodeId: '__tower_opening__',
          requestId,
          prompt: request.prompt,
          response: result.response,
          generationId: result.generationId,
          completedAt: this.host.now(),
          parsedResult: { type: 'opening_narrative', narrative },
          mvuData: clone(draft),
        };
        await this.towerGenerationHost.dispatchCompletion(request, payload);
        this.publishTowerCompletion(payload);
        this.releaseTowerGenerationRecord(request);
      } catch (error) {
        if (error instanceof TowerGenerationCancelledError) throw error;
        try {
          const failedDraft = this.readLatestMvuData(messageId);
          const failedRun = validateRunState(failedDraft.stat_data?.run);
          if (
            failedRun.ok &&
            failedRun.value.opening.phase === 'ready' &&
            failedRun.value.opening.requestId === openingRequestId &&
            failedRun.value.opening.narrativeRequestId === requestId
          ) {
            const failedOpening = {
              ...failedRun.value.opening,
              narrativePhase: 'failed' as const,
              narrativeError: error instanceof Error ? error.message : String(error),
            };
            const failedCandidate = validateRunState({ ...failedRun.value, opening: failedOpening });
            if (!failedCandidate.ok) throw new Error(`开局剧情失败状态无效：${failedCandidate.message}`);
            failedDraft.stat_data.run = failedCandidate.value;
            await this.replaceLatestMvuData(failedDraft, chatId, messageId);
            this.publishTowerFailure({
              spec: 'mwg.tower-generation-failure/v1',
              chatId,
              nodeId: '__tower_opening__',
              requestId,
              error: failedOpening.narrativeError,
              failedAt: this.host.now(),
              mvuData: clone(failedDraft),
            });
          }
        } catch (writeError) {
          this.debug('tower opening narrative failure state could not be persisted', writeError);
        }
        throw error;
      }
    })().catch(error => {
      if (!(error instanceof TowerGenerationCancelledError)) {
        this.debug(`tower opening narrative failed (${reason})`, error);
      }
    }).finally(() => {
      this.towerNarrativePromises.delete(key);
    });
    this.towerNarrativePromises.set(key, promise);
    return promise;
  }

  /** Generate active-node prose with the player's current preset without creating a Tavern floor. */
  private async scheduleTowerNarrativeForActiveNode(reason: string): Promise<void> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return;
    const before = this.readLatestMvuData(messageId);
    const stat = before.stat_data;
    const run = validateRunState(stat?.run);
    const activeNode = isRecord(stat?.run_node) ? stat.run_node : null;
    if (!run.ok || run.value.phase !== 'in_node' || !activeNode) return;
    if (activeNode.node_id !== run.value.currentNode?.id) return;
    if (activeNode.narrative_phase === 'ready' || activeNode.narrative_phase === 'failed') return;
    const nodeId = String(activeNode.node_id || '').trim();
    const requestId = String(activeNode.narrative_request_id || `${nodeId}__narrative`).trim();
    if (!nodeId || !requestId) return;
    const request: TowerGenerationRequest = {
      chatId,
      nodeId,
      requestId,
      prompt: towerNarrativePrompt(stat, activeNode),
      maxAttempts: 2,
      userExtra: { mwg_tower_narrative: true, reason },
      assistantExtra: { mwg_tower_narrative: true },
    };
    const key = towerGenerationTaskKey(request);
    if (this.towerNarrativePromises.has(key)) return this.towerNarrativePromises.get(key)!;

    const promise = (async () => {
      const claimed = clone(before);
      const claimedNode = claimed.stat_data?.run_node;
      if (!isRecord(claimedNode) || claimedNode.node_id !== nodeId) return;
      claimedNode.narrative_phase = 'generating';
      claimedNode.narrative_request_id = requestId;
      delete claimedNode.narrative_error;
      await this.replaceLatestMvuData(claimed, chatId, messageId);
      this.towerPreGenerationSnapshots.set(key, clone(before));

      try {
        const result = await this.towerGenerationHost.generateNarrative(request);
        const narrative = cleanTowerNarrative(result.response);
        if (!narrative) throw new Error('剧情模型返回内容在移除变量标记后为空');
        const draft = this.readLatestMvuData(messageId);
        const currentRun = validateRunState(draft.stat_data?.run);
        const currentNode = draft.stat_data?.run_node;
        if (
          !currentRun.ok ||
          currentRun.value.phase !== 'in_node' ||
          currentRun.value.currentNode?.id !== nodeId ||
          !isRecord(currentNode) ||
          currentNode.node_id !== nodeId ||
          currentNode.narrative_request_id !== requestId
        ) {
          throw new TowerGenerationCancelledError('剧情返回时玩家已经离开该节点');
        }
        currentNode.narrative = narrative;
        currentNode.narrative_source = 'preset';
        currentNode.narrative_phase = 'ready';
        delete currentNode.narrative_error;
        await this.replaceLatestMvuData(draft, chatId, messageId);
        this.saveTowerArchiveMetadata(chatId);
        const payload: TowerGenerationCompletedPayload = {
          spec: 'mwg.tower-generation/v1',
          chatId,
          nodeId,
          requestId,
          prompt: request.prompt,
          response: result.response,
          generationId: result.generationId,
          completedAt: this.host.now(),
          parsedResult: { type: 'narrative', narrative },
          mvuData: clone(draft),
        };
        await this.towerGenerationHost.dispatchCompletion(request, payload);
        this.publishTowerCompletion(payload);
        this.releaseTowerGenerationRecord(request);
      } catch (error) {
        if (error instanceof TowerGenerationCancelledError) throw error;
        try {
          const failedDraft = this.readLatestMvuData(messageId);
          const failedNode = failedDraft.stat_data?.run_node;
          if (
            isRecord(failedNode) &&
            failedNode.node_id === nodeId &&
            failedNode.narrative_request_id === requestId
          ) {
            failedNode.narrative_phase = 'failed';
            failedNode.narrative_error = error instanceof Error ? error.message : String(error);
            await this.replaceLatestMvuData(failedDraft, chatId, messageId);
            this.publishTowerFailure({
              spec: 'mwg.tower-generation-failure/v1',
              chatId,
              nodeId,
              requestId,
              error: failedNode.narrative_error,
              failedAt: this.host.now(),
              mvuData: clone(failedDraft),
            });
          }
        } catch (writeError) {
          this.debug('tower narrative failure state could not be persisted', writeError);
        }
        throw error;
      }
    })().catch(error => {
      if (!(error instanceof TowerGenerationCancelledError)) {
        this.debug(`tower narrative failed (${reason})`, error);
      }
    }).finally(() => {
      this.towerNarrativePromises.delete(key);
    });
    this.towerNarrativePromises.set(key, promise);
    return promise;
  }

  getTowerCoordinatorStatus() {
    return this.towerCoordinator?.getStatus() || null;
  }

  private cancelTowerGeneration(request: TowerCoordinatorGenerationRequest, reason: string): boolean {
    const chatId = this.currentChatId();
    const nodeId = String(request.nodeId || '').trim();
    const requestId = String(request.requestId || '').trim();
    if (!chatId || !nodeId || !requestId) return false;
    const key = { chatId, nodeId, requestId };
    const cancelled = this.towerGenerationHost.queue.cancelRequest(key, reason);
    if (cancelled) {
      const fingerprint = towerGenerationTaskKey(key);
      this.towerRequestPromises.delete(fingerprint);
      this.towerPreGenerationSnapshots.delete(fingerprint);
    }
    return cancelled;
  }

  /** Archive all silent node generations only after this run has ended. */
  async archiveTowerRun(): Promise<number | null> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    if (this.towerArchivePromise) return this.towerArchivePromise;
    const latest = this.readLatestMvuData(messageId);
    const parsed = validateRunState(latest.stat_data?.run);
    if (!parsed.ok || !['won', 'lost'].includes(parsed.value.phase)) return null;
    if (this.hasActiveBattleSession(latest)) return 0;
    const signature = `${chatId}:${parsed.value.seed}:${parsed.value.phase}:${parsed.value.visitedNodeIds.join(',')}`;
    if (this.archivedTowerRuns.has(signature)) return 0;

    const archive = (async () => {
      const keys = this.towerGenerationHost.listPendingArchiveKeys(chatId);
      const archived = keys.length;
      keys.forEach(key => this.releaseTowerGenerationRecord(key));
      this.towerGenerationHost.discardCompletedRecords(chatId);
      this.saveTowerArchiveMetadata(chatId);
      this.archivedTowerRuns.add(signature);
      return archived;
    })();
    this.towerArchivePromise = archive;
    try {
      return await archive;
    } finally {
      if (this.towerArchivePromise === archive) this.towerArchivePromise = null;
    }
  }

  getKnowledgeGraphStats() {
    return this.engine.knowledgeGraphStats(this.getState().lineage);
  }

  async warmup(): Promise<MvuDesignSnapshot | null> {
    if (!this.active) return null;
    if (this.warming) return this.warming;
    this.warming = this.runWarmup().finally(() => {
      this.warming = null;
      if (this.active && this.warmupRerunRequested) {
        this.warmupRerunRequested = false;
        this.scheduleWarmup();
      }
    });
    return this.warming;
  }

  private captureChatScope(): ChatScopeToken {
    const context = this.host.context();
    return {
      chatId: context?.chatId,
      metadata: context?.chatMetadata || null,
      messageId: this.latestMessageId(),
    };
  }

  private isCurrentChatScope(scope: ChatScopeToken): boolean {
    const context = this.host.context();
    return Boolean(context)
      && context!.chatId === scope.chatId
      && context!.chatMetadata === scope.metadata
      && this.latestMessageId() === scope.messageId;
  }

  private readonly onOfficialGenerateAfterData = async (payload: unknown): Promise<void> => {
    await this.onGenerateAfterData(payload, 'official');
  };

  private readonly onTavernHelperGenerateAfterData = async (payload: unknown): Promise<void> => {
    await this.onGenerateAfterData(payload, 'tavern-helper');
  };

  private async onGenerateAfterData(payload: unknown, source: 'official' | 'tavern-helper'): Promise<void> {
    if (!isMagicGirlWorldCharacter(this.host.context())) return;
    const mvu = this.host.mvu();
    const lifecycleFlag = mvu?.isDuringExtraAnalysis?.() === true;
    const requestFingerprint = looksLikeMvuExtraAnalysisRequest(payload);
    if (!lifecycleFlag && !requestFingerprint) return;
    if (!payload || typeof payload !== 'object') return;
    if (this.handledMvuRequestPayloads.has(payload)) {
      this.debug('skipped duplicate MVU request event', {
        source,
        lifecycleFlag,
        ...summarizeMvuRequest(payload),
      });
      return;
    }
    this.handledMvuRequestPayloads.add(payload);
    this.debug('captured MVU request', {
      source,
      lifecycleFlag,
      ...summarizeMvuRequest(payload),
    });
    // Apply synchronously before any snapshot work. The same request can be
    // exposed through two SillyTavern events; this mutation is idempotent.
    applyMvuRequestPolicy(payload);
    const settings = this.getSettings();
    // The request policy is part of the card's MVU reliability contract and
    // stays active for this card's second stage even when optional design
    // scoring/context injection is disabled.
    if (!settings.enabled) return;
    if (!mvu) {
      this.debug('captured MVU request before the MVU global became available; request policy applied without design context');
      return;
    }
    // SillyTavern and Tavern Helper can expose both the modern request event and
    // the chat-completion compatibility event for the same payload. Treat an
    // existing marker as an idempotent success instead of reporting a false
    // injection error or repeating the deck simulation.
    if (hasDesignContext(payload)) {
      this.debug('design context already present; skipped duplicate request event');
      return;
    }
    this.setStatus('injecting', '正在读取最新变量并生成设计上下文…');
    try {
      const chatScope = this.captureChatScope();
      const variables = mvu.getMvuData({ type: 'message', message_id: chatScope.messageId });
      const state = this.getState();
      const snapshot = await this.workerClient.createSnapshot(variables, state, settings);
      if (!this.active || !this.isCurrentChatScope(chatScope)) {
        this.debug('chat changed while preparing design context; discarded stale snapshot');
        return;
      }
      if (!snapshot) {
        const initializationPrompt = this.engine.createInitializationPrompt(variables);
        if (initializationPrompt && injectDesignContext(payload, initializationPrompt)) {
          this.latestSnapshot = null;
          this.recordInjection(state, source, chatScope.messageId);
          this.persistState(state);
          this.setStatus('ready', '已注入首轮卡组初始化约束');
          this.debug('injected initialization context', initializationPrompt);
          return;
        }
        this.setStatus('idle', '当前没有可评分的玩家卡组');
        return;
      }
      if (!injectDesignContext(payload, snapshot.prompt)) {
        // Another awaited listener may have inserted the same marker between
        // the preflight check and this mutation attempt.
        if (hasDesignContext(payload)) {
          this.setStatus(
            'ready',
            `已注入：卡组 ${snapshot.deckProfile.totalScore} 分，目标 ${snapshot.enemyEnvelope.targetScore} 分`,
            snapshot,
          );
          return;
        }
        this.setStatus('error', 'Tavern Helper 请求结构无法注入，已保持原请求');
        return;
      }
      this.latestSnapshot = snapshot;
      state.lineage = snapshot.lineage;
      state.lastDeckFingerprint = snapshot.deckFingerprint;
      state.lastEnemyFingerprint = snapshot.enemyFingerprint || undefined;
      this.recordInjection(state, source, chatScope.messageId);
      this.persistState(state);
      this.setStatus(
        'ready',
        `已注入：卡组 ${snapshot.deckProfile.totalScore} 分，目标 ${snapshot.enemyEnvelope.targetScore} 分`,
        snapshot,
      );
      this.debug('injected design context', snapshot.prompt);
    } catch (error) {
      this.fail('第二轮设计上下文生成失败', error);
    }
  }

  private scheduleTavernHelperEventSubscription(): void {
    if (!this.active || this.tavernHelperRequestUnsubscribe || typeof window === 'undefined') return;
    const watchGeneration = ++this.tavernHelperEventWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        const deadline = Date.now() + TAVERN_HELPER_EVENT_WAIT_MS;
        while (
          this.active
          && watchGeneration === this.tavernHelperEventWatchGeneration
          && !this.tavernHelperRequestUnsubscribe
          && Date.now() <= deadline
        ) {
          const unsubscribe = subscribeTavernHelperRequestEvent(
            (globalThis as Record<string, any>).TavernHelper,
            EVENT_GENERATE_AFTER_DATA,
            this.onTavernHelperGenerateAfterData,
          );
          if (unsubscribe) {
            this.tavernHelperRequestUnsubscribe = unsubscribe;
            this.debug('subscribed to Tavern Helper request events');
            return;
          }
          await new Promise<void>(resolve => globalThis.setTimeout(resolve, TAVERN_HELPER_EVENT_POLL_MS));
        }
        this.debug('Tavern Helper request event binding unavailable; official compatibility listener remains active');
      })().catch(error => this.debug('Tavern Helper request event subscription failed', error));
    });
  }

  /**
   * Tavern Helper can replace its internal binding facade while switching from
   * the welcome screen to a character chat. A successful early subscription
   * is therefore not proof that the listener still belongs to the active chat
   * bus. Rebind at each chat/runtime readiness boundary.
   */
  private restartTavernHelperEventSubscription(): void {
    this.tavernHelperEventWatchGeneration += 1;
    this.tavernHelperRequestUnsubscribe?.();
    this.tavernHelperRequestUnsubscribe = null;
    this.scheduleTavernHelperEventSubscription();
  }

  /**
   * Tavern Helper's `generateRaw()` path does not publish the normal
   * request-payload events. MVU does, however, announce that a variable update
   * is starting immediately before it builds that request. Install one
   * depth-zero system prompt synchronously so the exact current variables are
   * scored in time for the automatic second stage.
   */
  private readonly onMvuUpdateStarted = (variables: unknown): void => {
    this.clearMvuLifecyclePrompt('next-mvu-update');
    const context = this.host.context();
    const chatId = this.currentChatId();
    if (!this.active || !context || !chatId || !isMagicGirlWorldCharacter(context)) return;
    const messageId = this.latestMessageId();
    const latestMessage = messageId === 'latest' ? null : context.chat?.[messageId];
    // MVU also announces a parse pass when a user message enters the chat.
    // That pass does not own the automatic post-story model call and must not
    // install a prompt that the normal story request could observe. Only the
    // newly completed assistant floor is a valid second-stage boundary.
    if (!latestMessage || latestMessage.is_user !== false || latestMessage.is_system === true) {
      this.debug('skipped MVU lifecycle injection outside an assistant floor', { chatId, messageId });
      return;
    }
    const settings = this.getSettings();
    if (!settings.enabled) return;

    const helper = (globalThis as Record<string, any>).TavernHelper;
    if (!helper || typeof helper.injectPrompts !== 'function') {
      this.debug('MVU lifecycle prompt injection unavailable: Tavern Helper injectPrompts is missing');
      return;
    }

    try {
      const state = this.getState();
      const snapshot = this.engine.createSnapshot(variables, state, settings);
      const prompt = snapshot?.prompt || this.engine.createInitializationPrompt(variables);
      if (!prompt) return;
      const result = helper.injectPrompts([{
        id: MVU_LIFECYCLE_PROMPT_ID,
        position: 'in_chat',
        depth: 0,
        role: 'system',
        content: prompt,
      }], { once: true });
      if (!result || typeof result.uninject !== 'function') {
        helper.uninjectPrompts?.([MVU_LIFECYCLE_PROMPT_ID]);
        this.debug('MVU lifecycle prompt injection returned no cleanup handle');
        return;
      }

      this.activeMvuLifecyclePrompt = {
        chatId,
        messageId,
        uninject: result.uninject.bind(result),
      };
      if (snapshot) {
        this.latestSnapshot = snapshot;
        state.lineage = snapshot.lineage;
        state.lastDeckFingerprint = snapshot.deckFingerprint;
        state.lastEnemyFingerprint = snapshot.enemyFingerprint || undefined;
      } else {
        this.latestSnapshot = null;
      }
      this.recordInjection(state, 'mvu-lifecycle', messageId);
      this.persistState(state);
      this.setStatus(
        'ready',
        snapshot
          ? `已注入自动二阶段：卡组 ${snapshot.deckProfile.totalScore} 分，目标 ${snapshot.enemyEnvelope.targetScore} 分`
          : '已注入自动二阶段的首轮卡组初始化约束',
        snapshot || undefined,
      );
      this.debug('injected design context through MVU lifecycle', {
        chatId,
        messageId,
        deckScore: snapshot?.deckProfile.totalScore,
        targetScore: snapshot?.enemyEnvelope.targetScore,
      });
    } catch (error) {
      this.clearMvuLifecyclePrompt('injection-failed');
      this.fail('自动二阶段设计上下文生成失败', error, false);
    }
  };

  private clearMvuLifecyclePrompt(reason: string): void {
    const active = this.activeMvuLifecyclePrompt;
    this.activeMvuLifecyclePrompt = null;
    if (!active) return;
    try {
      active.uninject();
      this.debug('cleared MVU lifecycle prompt', {
        reason,
        chatId: active.chatId,
        messageId: active.messageId,
      });
    } catch (error) {
      this.debug(`failed to clear MVU lifecycle prompt (${reason})`, error);
    }
  }

  private readonly onMvuUpdateEnded = async (variables: unknown, before: unknown): Promise<void> => {
    this.clearMvuLifecyclePrompt('mvu-update-ended');
    if (!isMagicGirlWorldCharacter(this.host.context())) return;
    // The event payload is not always the selected swipe's final snapshot.
    // The recovery job deliberately re-reads authoritative message variables.
    this.scheduleInitialTowerContentRecovery('mvu-update-ended');
    this.scheduleBattleSettlementRecovery('mvu-update-ended');
    this.scheduleTowerChatActivityTouch(variables);
    this.towerCoordinator?.schedule('mvu-update-ended');
    void this.archiveTowerRun().catch(error => this.debug('爬塔终局归档失败，可在终局页面重试', error));
    const settings = this.getSettings();
    if (!settings.enabled) return;
    const afterFingerprint = enemyGenerationFingerprintFromVariables(variables);
    const beforeFingerprint = enemyGenerationFingerprintFromVariables(before);
    if (!afterFingerprint || afterFingerprint === beforeFingerprint) {
      this.scheduleWarmup();
      return;
    }
    this.setStatus('calibrating', settings.autoCalibration ? '正在校准新敌人…' : '正在记录新敌人谱系…');
    try {
      const chatScope = this.captureChatScope();
      const result = await this.workerClient.calibrate(variables, this.getState(), settings);
      if (!this.active || !this.isCurrentChatScope(chatScope)) {
        this.debug('chat changed while calibrating enemy; discarded stale result');
        return;
      }
      if (result.changed) applyCalibratedEnemy(variables, result.variables);
      this.latestSnapshot = result.snapshot;
      this.persistState(result.state);
      const calibration = result.state.lastCalibration;
      const message = calibration?.mode === 'advisory'
        ? `复杂构筑仅提供预算：${calibration.warnings[0] || '当前模拟置信度不足'}`
        : result.changed && calibration
        ? `敌人数值已校准 ×${calibration.appliedScale}，有效难度 ${calibration.effectiveRatio}%`
        : result.snapshot?.enemyPower
          ? `敌人已评分：${result.snapshot.enemyPower.currentEncounterScore} 分`
          : '敌人谱系已记录';
      this.setStatus('ready', message, result.snapshot || undefined);
      if (result.changed && settings.showNotifications) {
        this.host.notify('success', message, '设计辅助器');
      }
    } catch (error) {
      this.fail('敌人评分或校准失败，已保留模型原始内容', error);
    }
  };

  private scheduleTowerChatActivityTouch(variables: unknown): void {
    if (!isRecord(variables) || variables.stat_data?.game_mode !== 'tower') return;
    const parsed = validateRunState(variables.stat_data?.run);
    if (!parsed.ok) return;
    const chatId = this.currentChatId();
    if (!chatId) return;
    const now = this.host.now();
    const previous = this.towerActivityTouches.get(chatId);
    if (previous?.revision === parsed.value.stateRevision && now - previous.touchedAt < 60_000) return;
    this.towerActivityTouches.set(chatId, { revision: parsed.value.stateRevision, touchedAt: now });
    this.towerActivitySavePromise = this.towerActivitySavePromise
      .catch(() => undefined)
      .then(async () => {
        if (!this.active || this.currentChatId() !== chatId) return;
        const result = await touchCurrentTowerChatActivity(() => this.host.context(), chatId, now);
        if (result.touched) this.debug('refreshed single-floor tower chat activity', result);
      })
      .catch(error => this.debug('刷新爬塔聊天活动时间失败，进度变量仍已保存', error));
  }

  private scheduleCurrentTowerChatActivityTouch(): void {
    if (!this.active || !isMagicGirlWorldCharacter(this.host.context()) || !this.host.mvu()) return;
    try {
      this.scheduleTowerChatActivityTouch(this.readLatestMvuData());
    } catch (error) {
      this.debug('当前爬塔聊天尚未完成加载，稍后由 MVU 就绪事件重试', error);
    }
  }

  /**
   * Existing chats restore their MVU snapshot several ticks after SillyTavern
   * announces the chat switch. Retry only until the current chat exposes an
   * explicit game mode, then stop immediately for story mode. This keeps the
   * activity refresh isolated to tower saves without relying on an iframe-only
   * ready event.
   */
  private scheduleTowerChatActivityRecovery(reason: string): void {
    if (!this.active) return;
    const expectedChatId = this.currentChatId();
    if (!expectedChatId) return;
    const expectedMessageId = this.latestMessageId();
    const watchGeneration = ++this.towerActivityWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        const deadline = Date.now() + 20_000;
        let restoreCandidateSince = 0;
        let restoreCandidateRevision = -1;
        while (
          this.active &&
          watchGeneration === this.towerActivityWatchGeneration &&
          this.currentChatId() === expectedChatId &&
          this.latestMessageId() === expectedMessageId &&
          Date.now() <= deadline
        ) {
          const context = this.host.context();
          if (context && isMagicGirlWorldCharacter(context) && this.host.mvu()) {
            try {
              let current: Record<string, any> | null = null;
              try {
                current = this.readLatestMvuData(expectedMessageId);
              } catch {
                // MVU may expose only initvar, or no selected-message root, for
                // several ticks after an existing chat has visibly rendered.
              }
              const persistedSnapshot = readLatestPersistedMessageVariableSnapshot(
                context,
                expectedMessageId === 'latest' ? undefined : expectedMessageId,
              );
              if (!persistedSnapshot) throw new Error('The restored chat has not exposed message variables yet.');
              const assessment = assessPersistedTowerMvuRestore(persistedSnapshot.variables, current);
              if (assessment.action === 'ignore' || assessment.action === 'keep-current') {
                if (assessment.reason === 'current-tower-current' && current) {
                  this.scheduleTowerChatActivityTouch(current);
                  this.rerenderMessageAfterTowerMvuRestore(
                    expectedChatId,
                    expectedMessageId,
                    assessment.currentRevision ?? assessment.persistedRevision,
                  );
                }
                this.debug(`tower MVU recovery skipped (${reason})`, {
                  chatId: expectedChatId,
                  messageId: expectedMessageId,
                  persistedMessageId: persistedSnapshot.messageId,
                  ...assessment,
                });
                return;
              }

              // `persisted-tower-newer` has a concrete older MVU revision to
              // compare against and is safe to restore immediately.  The
              // generic `persisted-tower-ready` result means MVU is missing or
              // still showing initvar; require it to remain stable across the
              // whole grace window before replacing anything.
              if (assessment.reason === 'persisted-tower-ready') {
                const candidateRevision = assessment.persistedRevision ?? -1;
                if (restoreCandidateRevision !== candidateRevision) {
                  restoreCandidateRevision = candidateRevision;
                  restoreCandidateSince = Date.now();
                }
                if (Date.now() - restoreCandidateSince < TOWER_MVU_EMPTY_RESTORE_GRACE_MS) {
                  await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
                  continue;
                }
              }

              await this.restorePersistedTowerMvu(
                persistedSnapshot.variables,
                expectedChatId,
                expectedMessageId,
                watchGeneration,
              );
              const restored = this.readLatestMvuData(expectedMessageId);
              this.scheduleTowerChatActivityTouch(restored);
              this.debug(`restored tower MVU from persisted message (${reason})`, {
                chatId: expectedChatId,
                messageId: expectedMessageId,
                persistedMessageId: persistedSnapshot.messageId,
                revision: assessment.persistedRevision,
              });
              this.towerCoordinator?.requestRecovery();
              void this.scheduleTowerNarrativeForOpening('persisted-mvu-recovery');
              void this.scheduleTowerNarrativeForActiveNode('persisted-mvu-recovery');
              this.scheduleWarmup();
              return;
            } catch {
              // The current message's MVU snapshot is still being restored.
            }
          }
          await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
        }
        this.debug(`tower chat activity recovery timed out (${reason})`, { chatId: expectedChatId });
      })().catch(error => this.debug(`tower chat activity recovery failed (${reason})`, error));
    });
  }

  private readonly onChatChanged = (): void => {
    this.clearMvuLifecyclePrompt('chat-changed');
    this.automaticSettlementAttempts.clear();
    this.settlementRecoveryWatchGeneration += 1;
    this.automaticInitialContentAttempts.clear();
    this.initialContentRecoveryWatchGeneration += 1;
    const nextChatId = this.currentChatId();
    if (nextChatId) {
      this.towerGenerationHost.activateChat(nextChatId);
      this.restoreTowerArchiveMetadata(nextChatId);
    }
    else if (this.towerChatId) {
      this.towerGenerationHost.queue.cancelChat(this.towerChatId, '聊天已关闭，后台生成已取消');
    }
    this.towerChatId = nextChatId;
    this.publishedTowerTerminals.clear();
    this.towerRequestPromises.clear();
    this.towerPreGenerationSnapshots.clear();
    this.towerArchivePromise = null;
    this.archivedTowerRuns.clear();
    this.rerenderedTowerRestoreSnapshots.clear();
    this.towerCoordinator?.activateChat(nextChatId);
    this.latestSnapshot = null;
    this.setStatus('idle', '聊天已切换，等待重新评估');
    this.scheduleReasoningFinalRecovery('chat-changed');
    this.scheduleTowerChatActivityRecovery('chat-changed');
    this.scheduleInitialTowerContentRecovery('chat-changed');
    // The extension often starts on SillyTavern's welcome screen, before a
    // character script has exposed TavernHelper._bind. Give each newly opened
    // chat a fresh subscription window instead of permanently relying on the
    // bounded activation-time probe.
    this.restartTavernHelperEventSubscription();
    this.scheduleBattleSettlementRecovery('chat-changed');
    this.scheduleWarmup();
  };

  private readonly onChatLoaded = (): void => {
    this.scheduleTowerChatActivityRecovery('chat-loaded');
    this.scheduleInitialTowerContentRecovery('chat-loaded');
    this.restartTavernHelperEventSubscription();
    this.scheduleBattleSettlementRecovery('chat-loaded');
  };

  private readonly onGenerationEnded = (): void => {
    // Tavern Helper may replace its request-event facade after the visible
    // story request settles but before MVU starts the extra-analysis request.
    // Rebind in the intervening microtask so the first automatic second round
    // after a reload receives the same design context as a manual retry.
    this.restartTavernHelperEventSubscription();
    this.scheduleReasoningFinalRecovery('generation-ended');
    this.scheduleInitialTowerContentRecovery('generation-ended');
    // A visible assistant floor can inherit the preceding user floor's MVU
    // data while it is still streaming. `generation_ended` is the first
    // reliable lifecycle signal that the narrative floor has finished, so it
    // is the safe place to look for a pending battle settlement that requires
    // a third, structured repair request.
    this.scheduleBattleSettlementRecovery('generation-ended');
  };

  /**
   * Some reasoning-capable providers occasionally persist a blank final answer
   * while placing the deliberately tagged opening in `extra.reasoning`. Only
   * the card-scoped persistent extension may recover that strict protocol.
   */
  private scheduleReasoningFinalRecovery(reason: string, replayAfterRuntimeReady = false): void {
    if (!this.active) return;
    const watchGeneration = ++this.reasoningRecoveryWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        // CHAT_CHANGED, the official character context, Tavern Helper and the
        // card iframe become ready on separate ticks. Follow the active scope
        // for a short bounded window instead of snapshotting an incomplete
        // chat/character pair and permanently abandoning its blank floor.
        const deadline = Date.now() + 10_000;
        while (
          this.active &&
          watchGeneration === this.reasoningRecoveryWatchGeneration &&
          Date.now() <= deadline
        ) {
          const context = this.host.context();
          const chatId = this.currentChatId();
          const candidate = (globalThis as Record<string, any>).TavernHelper;
          const bridgedHelper = createEventBridgedTavernHelper(candidate, context);
          const officialRuntime = createOfficialReasoningRecoveryRuntime(context);
          const helperReady = bridgedHelper && [
            'getLastMessageId',
            'getChatMessages',
            'setChatMessages',
            'eventEmit',
          ].every(name => typeof bridgedHelper[name] === 'function');
          const recoveryRuntime = helperReady
            ? bridgedHelper
            : officialRuntime;
          if (
            context &&
            chatId &&
            isMagicGirlWorldCharacter(context) &&
            recoveryRuntime
          ) {
            const messageReceivedEvent = context.eventTypes.MESSAGE_RECEIVED || EVENT_MESSAGE_RECEIVED;
            const result = await this.reasoningFinalRecoveryHost.auditLatest(recoveryRuntime, {
              chatId,
              messageReceivedEvent,
              isCurrent: () => (
                this.active &&
                watchGeneration === this.reasoningRecoveryWatchGeneration &&
                this.currentChatId() === chatId &&
                isMagicGirlWorldCharacter(this.host.context())
              ),
            });
            this.debug(`empty final answer recovery audit (${reason})`, result);
            if (replayAfterRuntimeReady && result.status === 'skipped' && result.reason === 'already-recovered') {
              const replay = await this.reasoningFinalRecoveryHost.replayLatestAfterRuntimeReady(recoveryRuntime, {
                chatId,
                messageReceivedEvent,
                isCurrent: () => (
                  this.active &&
                  watchGeneration === this.reasoningRecoveryWatchGeneration &&
                  this.currentChatId() === chatId &&
                  isMagicGirlWorldCharacter(this.host.context())
                ),
              });
              this.debug(`empty final answer recovery replay (${reason})`, replay);
              return;
            }
            if (result.status === 'recovered') {
              this.debug(`recovered empty final answer from bounded reasoning (${reason})`, {
                chatId,
                messageId: result.messageId,
              });
              return;
            }
            if (result.status !== 'skipped') return;
            if (![
              'missing-latest-message',
              'not-latest-assistant',
              'missing-display-protocol',
            ].includes(result.reason)) return;
          }
          await new Promise<void>(resolve => globalThis.setTimeout(resolve, 100));
        }
        this.debug(`empty final answer recovery prerequisites unavailable (${reason})`);
      })().catch(error => this.debug(`empty final answer recovery failed (${reason})`, error));
    });
  }

  private readonly onTowerGenerationStatus = (status: TowerGenerationQueueStatus): void => {
    if (!this.isTowerLockedScope(status.chatId)) return;
    this.towerMonitor()?.receiveTowerGenerationStatus?.(clone(status));
  };

  private readonly onMvuInitialized = (): void => {
    this.restartTavernHelperEventSubscription();
    this.scheduleReasoningFinalRecovery('mvu-initialized', true);
    this.scheduleTowerChatActivityRecovery('mvu-initialized');
    this.scheduleInitialTowerContentRecovery('mvu-initialized');
    this.scheduleCurrentTowerChatActivityTouch();
    this.towerCoordinator?.requestRecovery();
    void this.scheduleTowerNarrativeForOpening('mvu-recovery');
    void this.scheduleTowerNarrativeForActiveNode('mvu-recovery');
    this.scheduleWarmup();
  };

  /**
   * CHAT_CHANGED can fire before SillyTavern has finished installing the new
   * character record into its context. The card runtime's ready event is the
   * first reliable point where card scope and Tavern Helper can both exist.
   */
  private readonly onCharacterRuntimeInitialized = (): void => {
    this.restartTavernHelperEventSubscription();
    this.scheduleReasoningFinalRecovery('character-runtime-initialized', Boolean(this.host.mvu()));
    this.scheduleTowerChatActivityRecovery('character-runtime-initialized');
    this.scheduleInitialTowerContentRecovery('character-runtime-initialized');
    this.scheduleCurrentTowerChatActivityTouch();
    this.towerCoordinator?.requestRecovery();
    void this.scheduleTowerNarrativeForOpening('runtime-recovery');
    void this.scheduleTowerNarrativeForActiveNode('runtime-recovery');
    this.scheduleWarmup();
  };

  private async runWarmup(): Promise<MvuDesignSnapshot | null> {
    if (!isMagicGirlWorldCharacter(this.host.context())) {
      this.setStatus('idle', '仅在魔法少女世界角色卡中启用');
      return null;
    }
    const settings = this.getSettings();
    if (!settings.enabled) return null;
    const mvu = this.host.mvu();
    if (!mvu) {
      this.setStatus('idle', '等待 MVU 初始化');
      return null;
    }
    this.setStatus('warming', '正在预先模拟卡组…');
    try {
      const chatScope = this.captureChatScope();
      const variables = mvu.getMvuData({ type: 'message', message_id: chatScope.messageId });
      const state = this.getState();
      const snapshot = await this.workerClient.createSnapshot(variables, state, settings);
      if (!this.active || !this.isCurrentChatScope(chatScope)) {
        this.debug('chat changed during warmup; discarded stale snapshot');
        return null;
      }
      if (!snapshot) {
        this.setStatus('idle', '当前没有可评分的玩家卡组');
        return null;
      }
      this.latestSnapshot = snapshot;
      state.lineage = snapshot.lineage;
      state.lastDeckFingerprint = snapshot.deckFingerprint;
      state.lastEnemyFingerprint = snapshot.enemyFingerprint || undefined;
      this.persistState(state);
      this.setStatus(
        'ready',
        `卡组 ${snapshot.deckProfile.totalScore} 分 · ${snapshot.deckProfile.archetypes[0]?.label || '未定流派'}`,
        snapshot,
      );
      return snapshot;
    } catch (error) {
      this.fail('卡组预评估失败', error, false);
      return null;
    }
  }

  private scheduleWarmup(): void {
    if (!this.active) return;
    if (this.warming) {
      this.warmupRerunRequested = true;
      return;
    }
    if (this.warmupScheduled) return;
    this.warmupScheduled = true;
    const run = () => {
      this.warmupScheduled = false;
      if (this.active) void this.warmup();
    };
    const requestIdleCallback = (globalThis as any).requestIdleCallback as undefined | ((callback: () => void, options?: { timeout: number }) => void);
    if (requestIdleCallback) requestIdleCallback(run, { timeout: 1200 });
    else globalThis.setTimeout(run, 0);
  }

  private currentChatId(): string | null {
    const value = this.host.context()?.chatId;
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
  }

  /**
   * Prefer SillyTavern's concrete message index over MVU's transient `latest`
   * alias. During iframe reconstruction that alias can briefly point at an old
   * assistant floor, while `context.chat` remains the authoritative ordering.
   */
  private latestMessageId(): number | 'latest' {
    const chat = this.host.context()?.chat;
    return Array.isArray(chat) && chat.length > 0 ? chat.length - 1 : 'latest';
  }

  private towerCoordinatorScope(): TowerCoordinatorScope | null {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    try {
      return {
        chatId,
        messageId,
        mvuData: this.readLatestMvuData(messageId),
        designSnapshot: clone(this.latestSnapshot),
        designState: this.getState(),
        settings: this.getSettings(),
      };
    } catch (error) {
      this.debug('tower coordinator snapshot unavailable', error);
      return null;
    }
  }

  private normalizeTowerRequest(
    chatId: string,
    input: TowerGenerationBridgeRequest,
    messageId: number | 'latest',
  ): NormalizedTowerBridgeRequest {
    const generationType = input.generationType === 'opening' ? 'opening' : 'node';
    const requestId = String(input.requestId || '').trim();
    const prompt = String(input.prompt || '').trim();
    const basedOnRevision = input.basedOnRevision ?? input.revision;
    if (!requestId) throw new Error('爬塔生成 requestId 不能为空');
    if (!prompt) throw new Error('爬塔生成 prompt 不能为空');
    if (!Number.isInteger(basedOnRevision) || Number(basedOnRevision) < 0) {
      throw new Error('爬塔生成 revision 必须是非负整数');
    }

    const nodeId = generationType === 'opening'
      ? '__tower_opening__'
      : String(input.nodeId || '').trim();
    if (!nodeId) throw new Error('爬塔节点 nodeId 不能为空');
    if (generationType === 'node' && !RUN_NODE_KINDS.includes(input.kind as RunNodeKind)) {
      throw new Error('爬塔节点 kind 无效');
    }

    let nodeAct: number | undefined;
    let nodeFloor: number | undefined;
    if (generationType === 'node') {
      const current = this.readLatestMvuData(messageId);
      const run = validateRunState(current.stat_data?.run);
      if (!run.ok) throw new Error(`爬塔状态无效：${run.message}`);
      const node = run.value.map?.nodes.find(entry => entry.id === nodeId)
        || run.value.choices.find(entry => entry.id === nodeId)
        || (run.value.currentNode?.id === nodeId ? run.value.currentNode : null);
      if (!node) throw new Error('爬塔节点不属于当前地图');
      if (node.kind !== input.kind) throw new Error('爬塔节点 kind 与地图不一致');
      nodeAct = node.act;
      nodeFloor = node.floor;
    }

    const request: TowerGenerationRequest = {
      ...input,
      chatId,
      nodeId,
      requestId,
      prompt,
      ...(nodeAct === undefined ? {} : { act: nodeAct }),
      ...(nodeFloor === undefined ? {} : { floor: nodeFloor }),
      generation: {
        ...(input.generation || {}),
        max_chat_history: 0,
        json_schema: generationType === 'opening'
          ? createTowerOpeningJsonSchema()
          : createTowerNodeJsonSchema(input.kind as RunNodeKind, {
            nodeId,
            act: nodeAct,
            floor: nodeFloor,
          }),
      },
    };
    return {
      generationType,
      request,
      basedOnRevision: Number(basedOnRevision),
      messageId,
      ...(generationType === 'node' ? {
        kind: input.kind as RunNodeKind,
        act: nodeAct,
        floor: nodeFloor,
      } : {}),
    };
  }

  private readLatestMvuData(messageId: number | 'latest' = this.latestMessageId()): Record<string, any> {
    if (messageId !== 'latest' && this.latestMessageId() !== messageId) {
      throw new TowerGenerationCancelledError('The active SillyTavern message changed before MVU could be read.');
    }
    const mvu = this.host.mvu();
    if (!mvu || typeof mvu.replaceMvuData !== 'function') {
      throw new Error('MVU replaceMvuData 接口不可用，已停止后台生成以保护存档');
    }
    const data = normalizeLatestMvuRoot(mvu.getMvuData({ type: 'message', message_id: messageId }));
    if (!data) {
      throw new Error('最新楼层 MVU 数据不可用');
    }
    return clone(data);
  }

  private async replaceLatestMvuData(
    data: Record<string, any>,
    expectedChatId: string,
    expectedMessageId: number | 'latest' = this.latestMessageId(),
  ): Promise<void> {
    if (!this.isTowerLockedScope(expectedChatId, expectedMessageId)) {
      throw new Error('聊天或游戏模式已变化，拒绝写入旧爬塔结果');
    }
    const mvu = this.host.mvu();
    if (!mvu || typeof mvu.replaceMvuData !== 'function') throw new Error('MVU replaceMvuData 接口不可用');
    const normalized = normalizeLatestMvuRoot(data);
    const current = normalizeLatestMvuRoot(
      mvu.getMvuData({ type: 'message', message_id: expectedMessageId }),
    );
    if (!current) throw new Error('MVU state became unavailable before the tower update was written.');
    const incomingRevision = Number(normalized?.stat_data?.run?.stateRevision);
    const currentRevision = Number(current.stat_data?.run?.stateRevision);
    if (
      Number.isFinite(incomingRevision)
      && Number.isFinite(currentRevision)
      && incomingRevision < currentRevision
    ) {
      throw new TowerGenerationCancelledError(
        `Refused stale tower state revision ${incomingRevision}; current revision is ${currentRevision}.`,
      );
    }
    if (!normalized) throw new Error('拒绝写入根结构异常的 MVU 数据');
    // Call through the owning object. Some host bridges expose a method rather
    // than a context-free function, so extracting it first is not safe.
    await mvu.replaceMvuData(clone(normalized), { type: 'message', message_id: expectedMessageId });
    const written = normalizeLatestMvuRoot(
      mvu.getMvuData({ type: 'message', message_id: expectedMessageId }),
    );
    if (!written) throw new Error('MVU 写入后根结构异常，已停止后续后台生成');
    if (!this.isTowerLockedScope(expectedChatId, expectedMessageId)) {
      throw new Error('写入完成前聊天已切换，爬塔结果不再派发');
    }
  }

  private async restorePersistedTowerMvu(
    persisted: Record<string, any>,
    expectedChatId: string,
    expectedMessageId: number | 'latest',
    expectedWatchGeneration: number,
  ): Promise<void> {
    const isCurrent = (): boolean => (
      this.active
      && this.towerActivityWatchGeneration === expectedWatchGeneration
      && this.currentChatId() === expectedChatId
      && this.latestMessageId() === expectedMessageId
      && isMagicGirlWorldCharacter(this.host.context())
    );
    if (!isCurrent()) throw new TowerGenerationCancelledError('The chat changed before tower MVU restoration.');
    const mvu = this.host.mvu();
    if (!mvu || typeof mvu.replaceMvuData !== 'function') {
      throw new Error('MVU replaceMvuData is unavailable during persisted tower restoration.');
    }
    let current: Record<string, any> | null = null;
    try {
      current = normalizeLatestMvuRoot(
        mvu.getMvuData({ type: 'message', message_id: expectedMessageId }),
      );
    } catch {
      // A missing current root is the exact state this recovery path repairs.
    }
    const assessment = assessPersistedTowerMvuRestore(persisted, current);
    if (assessment.action !== 'restore') return;
    if (!isCurrent()) throw new TowerGenerationCancelledError('The chat changed before tower MVU restoration.');
    await mvu.replaceMvuData(clone(persisted), { type: 'message', message_id: expectedMessageId });
    if (!isCurrent()) throw new TowerGenerationCancelledError('The chat changed while tower MVU was being restored.');
    const written = normalizeLatestMvuRoot(
      mvu.getMvuData({ type: 'message', message_id: expectedMessageId }),
    );
    const writtenRun = validateRunState(written?.stat_data?.run);
    if (
      !written
      || written.stat_data?.game_mode !== 'tower'
      || !writtenRun.ok
      || writtenRun.value.stateRevision !== assessment.persistedRevision
    ) {
      throw new Error('Persisted tower MVU restoration did not retain the expected run revision.');
    }
    this.rerenderMessageAfterTowerMvuRestore(
      expectedChatId,
      expectedMessageId,
      assessment.persistedRevision,
    );
  }

  /**
   * Rebuild only the already-visible latest floor after MVU memory has been
   * repaired from that floor's persisted variables. This keeps the iframe in
   * sync without creating a message, saving a new floor, or touching another
   * chat that became active while the asynchronous restore was running.
   */
  private rerenderMessageAfterTowerMvuRestore(
    expectedChatId: string,
    expectedMessageId: number | 'latest',
    expectedRevision?: number,
  ): boolean {
    if (!this.active || expectedMessageId === 'latest') return false;
    if (this.currentChatId() !== expectedChatId || this.latestMessageId() !== expectedMessageId) return false;
    const context = this.host.context();
    if (!context || !isMagicGirlWorldCharacter(context)) return false;
    const message = context.chat?.[expectedMessageId];
    if (!message || typeof message !== 'object' || typeof context.updateMessageBlock !== 'function') return false;
    const revision = Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : -1;
    const snapshotKey = `${expectedChatId}:${expectedMessageId}:${revision}`;
    if (this.rerenderedTowerRestoreSnapshots.has(snapshotKey)) return false;
    try {
      context.updateMessageBlock(expectedMessageId, message, { rerenderMessage: true });
      const rendered = context.eventSource.emit?.(
        context.eventTypes.MESSAGE_UPDATED || 'message_updated',
        expectedMessageId,
      );
      if (rendered && typeof (rendered as Promise<unknown>).catch === 'function') {
        void (rendered as Promise<unknown>).catch(error => {
          this.debug('tower MVU restored, but the Tavern Helper render event failed', error);
        });
      }
      this.rerenderedTowerRestoreSnapshots.add(snapshotKey);
      return true;
    } catch (error) {
      // The state repair is already durable. A host-side render failure must
      // not repeat the restore transaction or overwrite a newer revision.
      this.debug('tower MVU restored, but the visible message could not be rerendered', error);
      return false;
    }
  }

  private async executeTowerGeneration(
    normalized: NormalizedTowerBridgeRequest,
    _beforeGeneration: Record<string, any>,
  ): Promise<TowerGenerationResult> {
    const { request, generationType, basedOnRevision, kind, act, floor, messageId } = normalized;
    let result: TowerGenerationResult;
    try {
      result = await this.towerGenerationHost.generateNode(request);
    } catch (error) {
      if (error instanceof TowerGenerationCancelledError) throw error;
      await this.recordTowerGenerationFailure(normalized, error, true);
      throw error;
    }

    let parsedResult: unknown;
    let draft: Record<string, any>;
    try {
      draft = this.readLatestMvuData(messageId);
      if (!this.isTowerLockedScope(request.chatId, messageId)) {
        throw new TowerGenerationCancelledError('The active message changed before tower generation could commit.');
      }
      if (generationType === 'opening') {
        const expectedOpening = {
          requestId: request.requestId,
          basedOnRevision,
        };
        let parsed: ReturnType<typeof parseTowerOpeningResult> | null = null;
        let structureError: unknown = null;
        const maximumStructureRepairs = 2;
        for (let repairIndex = 0; repairIndex <= maximumStructureRepairs; repairIndex += 1) {
          try {
            parsed = parseTowerOpeningResult(result.response, expectedOpening);
            break;
          } catch (error) {
            structureError = error;
            if (repairIndex >= maximumStructureRepairs) throw error;
            const repairRequest: TowerGenerationRequest = {
              ...request,
              requestId: `${request.requestId}__structure_repair_${repairIndex + 1}`,
              prompt: formatTowerOpeningStructureRepairPrompt(expectedOpening, result.response, error),
              maxAttempts: 1,
              userExtra: {
                ...(request.userExtra || {}),
                mwg_tower_opening_structure_repair: true,
                mwg_tower_opening_structure_repair_attempt: repairIndex + 1,
              },
            };
            this.towerPreGenerationSnapshots.set(towerGenerationTaskKey(repairRequest), clone(draft));
            result = await this.towerGenerationHost.generateNode(repairRequest);
          }
        }
        if (!parsed) throw structureError || new Error('爬塔开局馈赠结构修复未返回可执行结果');
        const run = validateRunState(draft.stat_data.run);
        if (!run.ok) throw new Error(`爬塔状态无效：${run.message}`);
        const mutation = commitTowerOpening(run.value.opening, {
          requestId: parsed.request_id,
          basedOnRevision: parsed.based_on_revision,
          content: parsed,
        });
        const candidate = validateRunState({ ...run.value, opening: mutation.opening });
        if (!candidate.ok) throw new Error(`开局事件提交后状态无效：${candidate.message}`);
        draft.stat_data.run = candidate.value;
        parsedResult = parsed;
      } else {
        const expectedNode = {
          nodeId: request.nodeId,
          requestId: request.requestId,
          basedOnRevision,
          kind: kind!,
          act,
          floor,
        };
        const route = {
          id: request.nodeId,
          kind: kind!,
          act: act!,
          floor: floor!,
        };
        const parseAndValidateNode = (response: string): TowerNodeResult => {
          const candidate = parseTowerNodeResult(response, expectedNode);
          if (isBattleRunNode(kind!)) {
            validateTowerBattleNodeForActivation(
              draft.stat_data.battle,
              candidate.payload?.battle,
              candidate.reward,
              route,
            );
          } else if (kind === 'event') {
            validateTowerEventNodeForActivation(
              draft.stat_data.battle,
              candidate.payload?.event,
            );
          } else if (kind === 'shop' || kind === 'treasure') {
            normalizeTowerReward(candidate.reward, draft.stat_data.battle);
          }
          return candidate;
        };
        let parsed: TowerNodeResult | null = null;
        let structureError: unknown = null;
        const maximumStructureRepairs = 2;
        for (let repairIndex = 0; repairIndex <= maximumStructureRepairs; repairIndex += 1) {
          try {
            parsed = parseAndValidateNode(result.response);
            break;
          } catch (error) {
            structureError = error;
            if (repairIndex >= maximumStructureRepairs) throw error;
            const repairRequest: TowerGenerationRequest = {
              ...request,
              requestId: `${request.requestId}__structure_repair_${repairIndex + 1}`,
              prompt: formatTowerNodeStructureRepairPrompt(expectedNode, result.response, error),
              maxAttempts: 1,
              userExtra: {
                ...(request.userExtra || {}),
                mwg_tower_structure_repair: true,
                mwg_tower_structure_repair_attempt: repairIndex + 1,
              },
            };
            this.towerPreGenerationSnapshots.set(towerGenerationTaskKey(repairRequest), clone(draft));
            result = await this.towerGenerationHost.generateNode(repairRequest);
          }
        }
        if (!parsed) throw structureError || new Error('爬塔节点结构修复未返回可执行结果');
        if (isBattleRunNode(kind!)) {
          parsed = await this.balanceTowerNodeResult(parsed, draft, normalized);
          validateTowerBattleNodeForActivation(
            draft.stat_data.battle,
            parsed.payload?.battle,
            parsed.reward,
            route,
          );
        }
        commitTowerGenerationInStat(draft.stat_data, {
          nodeId: request.nodeId,
          requestId: request.requestId,
          revision: basedOnRevision,
          content: parsed,
          ...(parsed.reward === undefined ? {} : { reward: parsed.reward }),
        });
        parsedResult = parsed;
      }
      await this.replaceLatestMvuData(draft, request.chatId, messageId);
      this.saveTowerArchiveMetadata(request.chatId);
      if (generationType === 'opening') {
        globalThis.setTimeout(() => {
          void this.scheduleTowerNarrativeForOpening('opening-structured-ready');
        }, 0);
      }
    } catch (error) {
      // The raw model call completed, but an unusable contract must not leave
      // the request permanently stuck in `generating`. The failure adapter is
      // scoped by requestId + revision, so stale responses still cannot mutate
      // another node generation.
      await this.recordTowerGenerationFailure(normalized, error, true);
      throw error;
    }

    const payload: TowerGenerationCompletedPayload = {
      spec: 'mwg.tower-generation/v1',
      chatId: request.chatId,
      nodeId: request.nodeId,
      requestId: request.requestId,
      prompt: request.prompt,
      response: result.response,
      generationId: result.generationId,
      completedAt: this.host.now(),
      parsedResult: clone(parsedResult),
      mvuData: clone(draft),
    };
    try {
      await this.towerGenerationHost.dispatchCompletion(request, payload, request.eventName);
      this.publishTowerCompletion(payload);
      this.releaseTowerGenerationRecord(request);
    } catch (error) {
      await this.recordTowerGenerationFailure(normalized, error, false);
      throw error;
    }
    return result;
  }

  private async balanceTowerNodeResult(
    parsed: TowerNodeResult,
    draft: Record<string, any>,
    normalized: NormalizedTowerBridgeRequest,
  ): Promise<TowerNodeResult> {
    const settings = this.getSettings();
    const actMultiplier = Number(normalized.request.difficultyMultiplier);
    const towerSettings = {
      ...settings,
      difficultyPercent: Math.min(110, Math.max(10,
        settings.difficultyPercent * (Number.isFinite(actMultiplier) && actMultiplier > 0 ? actMultiplier : 1),
      )),
    };
    let balance = balanceTowerGeneratedBattle({
      variables: draft,
      generatedBattle: parsed.payload?.battle,
      settings: towerSettings,
      cachedProfile: this.latestSnapshot?.deckProfile,
    });

    if (balance.requiresModelRepair) {
      const repairRequest: TowerGenerationRequest = {
        ...normalized.request,
        requestId: `${normalized.request.requestId}__balance_repair`,
        prompt: formatTowerBattleBalanceRepairPrompt(parsed, balance.audit),
        maxAttempts: 1,
        userExtra: {
          ...(normalized.request.userExtra || {}),
          mwg_tower_balance_repair: true,
        },
      };
      this.towerPreGenerationSnapshots.set(towerGenerationTaskKey(repairRequest), clone(draft));
      const repaired = await this.towerGenerationHost.generateNode(repairRequest);
      const repairedParsed = parseTowerNodeResult(repaired.response, {
        nodeId: normalized.request.nodeId,
        requestId: normalized.request.requestId,
        basedOnRevision: normalized.basedOnRevision,
        kind: normalized.kind!,
        act: normalized.act,
        floor: normalized.floor,
      });
      // The repair model may only supply a replacement battle definition. All
      // narrative, reward and other node fields remain program-owned from the
      // first authored result even if the model attempts to rewrite them.
      const scopedRepair = clone(parsed);
      scopedRepair.payload.battle = clone(repairedParsed.payload?.battle);
      balance = balanceTowerGeneratedBattle({
        variables: draft,
        generatedBattle: scopedRepair.payload.battle,
        settings: towerSettings,
        cachedProfile: this.latestSnapshot?.deckProfile,
        modelRepairUsed: true,
      });
      if (balance.requiresModelRepair) {
        throw new Error('敌人经过一次受约束修复后仍不可通关，已拒绝写入并等待节点重试');
      }
      parsed = scopedRepair;
    }

    parsed.payload.battle = balance.generatedBattle;
    parsed.program_balance = clone(balance.audit);
    return parsed;
  }

  private async recordTowerGenerationFailure(
    normalized: NormalizedTowerBridgeRequest,
    error: unknown,
    applyFailureState: boolean,
  ): Promise<void> {
    const { request, generationType, basedOnRevision, messageId } = normalized;
    if (!this.isTowerLockedScope(request.chatId, messageId)) return;
    const detail = error instanceof Error ? error.message : String(error);
    let failedMvuData: Record<string, any> | undefined;

    if (applyFailureState) {
      try {
        const draft = this.readLatestMvuData(messageId);
        if (generationType === 'opening') {
          const run = validateRunState(draft.stat_data.run);
          if (!run.ok) throw new Error(`爬塔状态无效：${run.message}`);
          const mutation = failTowerOpening(run.value.opening, {
            requestId: request.requestId,
            basedOnRevision,
            error: detail,
          });
          const candidate = validateRunState({ ...run.value, opening: mutation.opening });
          if (!candidate.ok) throw new Error(`开局失败状态无效：${candidate.message}`);
          draft.stat_data.run = candidate.value;
        } else {
          failTowerGenerationInStat(draft.stat_data, {
            nodeId: request.nodeId,
            requestId: request.requestId,
            revision: basedOnRevision,
            error: detail,
          });
        }
        await this.replaceLatestMvuData(draft, request.chatId, messageId);
        failedMvuData = draft;
      } catch (adapterError) {
        this.debug('tower failure adapter rejected update; original MVU retained', adapterError);
      }
    }

    this.publishTowerFailure({
      spec: 'mwg.tower-generation-failure/v1',
      chatId: request.chatId,
      nodeId: request.nodeId,
      requestId: request.requestId,
      error: detail,
      failedAt: this.host.now(),
      ...(failedMvuData ? { mvuData: clone(failedMvuData) } : {}),
    });
  }

  private hasActiveBattleSession(data: Record<string, any>): boolean {
    return isRecord(data.__magic_girl_world)
      && isRecord(data.__magic_girl_world.battle_session);
  }

  private isTowerLockedScope(
    expectedChatId: string,
    expectedMessageId: number | 'latest' = this.latestMessageId(),
  ): boolean {
    if (!this.active || this.currentChatId() !== expectedChatId) return false;
    if (expectedMessageId !== 'latest' && this.latestMessageId() !== expectedMessageId) return false;
    if (!isMagicGirlWorldCharacter(this.host.context())) return false;
    try {
      const variables = this.host.mvu()?.getMvuData({ type: 'message', message_id: expectedMessageId });
      if (!isRecord(variables)) return false;
      const stat = isRecord(variables.stat_data) ? variables.stat_data : variables;
      const lock = isRecord(stat.game_mode_lock) ? stat.game_mode_lock : null;
      return lock?.schemaVersion === 1 && lock.mode === 'tower';
    } catch {
      return false;
    }
  }

  private towerMonitor(): TowerGenerationMonitorBridge | null {
    const monitor = (globalThis as any).MagicGirlWorldMvuMonitor;
    return monitor && typeof monitor === 'object' ? monitor as TowerGenerationMonitorBridge : null;
  }

  private publishTowerCompletion(payload: TowerGenerationCompletedPayload): void {
    const terminal = towerGenerationTaskKey(payload);
    if (this.publishedTowerTerminals.has(terminal)) return;
    this.publishedTowerTerminals.add(terminal);
    try {
      this.towerMonitor()?.receiveTowerGenerationCompleted?.(clone(payload));
    } catch (error) {
      this.debug('tower completion bridge failed', error);
    }
  }

  private publishTowerFailure(payload: TowerGenerationBridgeFailure): void {
    const terminal = towerGenerationTaskKey(payload);
    if (this.publishedTowerTerminals.has(terminal)) return;
    this.publishedTowerTerminals.add(terminal);
    try {
      this.towerMonitor()?.receiveTowerGenerationFailed?.(clone(payload));
    } catch (error) {
      this.debug('tower failure bridge failed', error);
    }
  }

  private persistState(state: DesignAssistantChatState): void {
    const context = this.host.context();
    if (!context?.chatMetadata) return;
    context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY] = clone(state);
    context.saveMetadataDebounced();
  }

  private recordInjection(
    state: DesignAssistantChatState,
    source: 'official' | 'tavern-helper' | 'mvu-lifecycle',
    messageId: number | 'latest',
  ): void {
    const injectedAt = this.host.now();
    const previousAt = Number(state.lastInjectionAt);
    const sameLogicalRequest = state.lastInjectionMessageId === messageId
      && Number.isFinite(previousAt)
      && injectedAt - previousAt >= 0
      && injectedAt - previousAt <= LOGICAL_MVU_INJECTION_WINDOW_MS;
    state.lastInjectionAt = injectedAt;
    // When both compatibility paths observe one request, keep the more
    // specific Tavern Helper source even if the official clone arrives last.
    if (
      !sameLogicalRequest
      || source === 'mvu-lifecycle'
      || source === 'tavern-helper' && state.lastInjectionSource === 'official'
      || !state.lastInjectionSource
    ) {
      state.lastInjectionSource = source;
    }
    state.lastInjectionMessageId = messageId;
    if (!sameLogicalRequest) {
      state.lastInjectionCount = Math.max(0, Number(state.lastInjectionCount) || 0) + 1;
    }
  }

  /**
   * Restore only this chat's compact terminal archive queue. MVU snapshots,
   * promises and cancellation handles intentionally never enter metadata.
   */
  private restoreTowerArchiveMetadata(chatId: string): void {
    const context = this.host.context();
    if (!context?.chatMetadata || this.currentChatId() !== chatId) return;
    // Older builds duplicated every complete background prompt/response in
    // chat metadata. The committed run state already contains the resumable
    // node content, so remove the obsolete archive during migration.
    if (context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY] !== undefined) {
      delete context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY];
      context.saveMetadataDebounced();
    }
  }

  /** Persist completed silent calls after their MVU transaction commits. */
  private saveTowerArchiveMetadata(chatId: string): void {
    const context = this.host.context();
    if (!context?.chatMetadata || this.currentChatId() !== chatId) return;
    if (context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY] !== undefined) {
      delete context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY];
      context.saveMetadataDebounced();
    }
  }

  private releaseTowerGenerationRecord(key: TowerGenerationTaskKey): void {
    const fingerprint = towerGenerationTaskKey(key);
    this.towerGenerationHost.releaseCompletedRecord(key);
    this.towerPreGenerationSnapshots.delete(fingerprint);
  }

  private saveSettings(settings: DesignAssistantSettings): void {
    const context = this.host.context();
    if (!context) return;
    context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID] = normalizeDesignAssistantSettings(settings);
    context.saveSettingsDebounced();
    this.publishDashboard();
    this.scheduleWarmup();
  }

  private setStatus(
    phase: DesignAssistantStatus['phase'],
    message: string,
    snapshot?: MvuDesignSnapshot,
  ): void {
    this.status = {
      phase,
      message,
      updatedAt: this.host.now(),
      ...(snapshot ? {
        deckScore: snapshot.deckProfile.totalScore,
        targetScore: snapshot.enemyEnvelope.targetScore,
        ...(snapshot.enemyPower ? { enemyScore: snapshot.enemyPower.currentEncounterScore } : {}),
      } : {}),
    };
    this.publishDashboard();
  }

  private publishDashboard(): void {
    const monitor = (globalThis as any).MagicGirlWorldMvuMonitor;
    if (!monitor) return;
    monitor.setDesignAssistant?.(this);
    monitor.receiveDesignAssistantDashboard?.(this.getDashboard());
  }

  private fail(title: string, error: unknown, notify = true): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.setStatus('error', `${title}：${detail}`);
    if (notify && this.getSettings().showNotifications) this.host.notify('warning', detail, title);
    this.debug(title, error);
  }

  private debug(...values: unknown[]): void {
    if (this.getSettings().debug) console.debug('[MagicGirlDesignAssistant]', ...values);
  }
}
