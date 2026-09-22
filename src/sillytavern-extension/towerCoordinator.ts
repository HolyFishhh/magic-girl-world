import { towerRewardPreferenceContext } from '../game-core/towerCardMemory';
import { buildTowerFoundationGuidance } from '../game-core/towerFoundationGuidance';
import { createContentPackFromMvuBattle } from '../runtime/contentPackAdapter';
import { availableTowerMemoryCards } from '../runtime/towerCardMemory';
import {
  formatTowerNodeBatchGenerationPrompt,
  formatTowerOpeningGenerationPrompt,
  type TowerGenerationContext,
  type TowerGenerationJobDescriptor,
} from '../game-core/towerRequest';
import { validateRunState, type RunState } from '../game-core/runState';
import {
  claimTowerOpeningInStat,
  queueTowerOpeningInStat,
  recoverTowerOpeningInStat,
} from '../runtime/towerOpeningAdapter';
import {
  claimQueuedTowerGenerationsInStat,
  failTowerGenerationInStat,
  queueTowerLookaheadInStat,
  recoverTowerGenerationsInStat,
  retryTowerNodeGenerationInStat,
  type TowerGenerationRequest as TowerStateGenerationRequest,
} from '../runtime/towerStateAdapter';
import type {
  DesignAssistantChatState,
  DesignAssistantSettings,
  MvuDesignSnapshot,
} from './types';
import { compactRunEventHistoryForPrompt } from './runHistoryPrompt';

export interface TowerCoordinatorScope {
  chatId: string;
  messageId: number | 'latest';
  mvuData: Record<string, any>;
  designSnapshot: MvuDesignSnapshot | null;
  designState: DesignAssistantChatState;
  settings: DesignAssistantSettings;
}

export interface TowerCoordinatorGenerationRequest {
  generationType?: 'node' | 'opening' | 'batch';
  nodeId?: string;
  batchId?: string;
  jobs?: TowerStateGenerationRequest[];
  requestId: string;
  basedOnRevision?: number;
  revision?: number;
  kind?: string;
  act?: number;
  floor?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  difficultyMultiplier?: number;
  prompt: string;
  sourceMessageId?: number | 'latest';
}

export interface TowerCoordinatorPorts {
  snapshot(): TowerCoordinatorScope | null;
  prepareDesignSnapshot?(): Promise<unknown>;
  replaceLatest(
    data: Record<string, any>,
    expectedChatId: string,
    expectedMessageId: number | 'latest',
    base: Record<string, any>,
  ): Promise<void>;
  requestGeneration(request: TowerCoordinatorGenerationRequest): Promise<unknown>;
  cancelGeneration?(request: TowerCoordinatorGenerationRequest, reason: string): boolean;
  onError?(message: string, error: unknown): void;
}

export interface TowerCoordinatorStatus {
  spec: 'mwg.tower-coordinator/v1';
  chatId: string | null;
  phase: 'idle' | 'recovering' | 'opening' | 'lookahead' | 'waiting' | 'error';
  message: string;
  updatedAt: number;
}

const TOWER_MODE_LOCK_SPEC = 1;
const RUN_SCHEMA_VERSION = 3;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!isRecord(input)) return input;
    return Object.fromEntries(Object.keys(input)
      .sort()
      .filter(key => input[key] !== undefined)
      .map(key => [key, normalize(input[key])]));
  };
  return JSON.stringify(normalize(value));
}

/**
 * Persistent cards are expanded into quantity=1 runtime instances so an
 * upgrade, attachment or transformation can address one exact copy. Node
 * authoring does not address those private identities. Recombine only copies
 * whose complete public/runtime shape is identical after removing their own
 * runInstanceId; any patch, attachment, origin or other difference therefore
 * remains a separate card entry.
 */
function compactRuntimeCardInstances(value: unknown): unknown {
  if (!Array.isArray(value)) return clone(value);
  const result: unknown[] = [];
  const groupedIndexes = new Map<string, number>();
  for (const rawCard of value) {
    if (!isRecord(rawCard)) {
      result.push(clone(rawCard));
      continue;
    }
    const card = clone(rawCard);
    const runInstanceId = typeof card.runInstanceId === 'string' ? card.runInstanceId.trim() : '';
    const quantity = Number(card.quantity ?? 1);
    if (!runInstanceId || !Number.isInteger(quantity) || quantity < 1) {
      result.push(card);
      continue;
    }
    delete card.runInstanceId;
    delete card.quantity;
    const fingerprint = canonicalJson(card);
    const existingIndex = groupedIndexes.get(fingerprint);
    if (existingIndex === undefined) {
      groupedIndexes.set(fingerprint, result.length);
      result.push({ ...card, quantity });
      continue;
    }
    const existing = result[existingIndex] as Record<string, any>;
    existing.quantity = Number(existing.quantity ?? 0) + quantity;
  }
  return result;
}

/**
 * Project the retrieved graph into its authored semantic facts. Archetype
 * nodes already contain every required/optional/payoff predicate and role;
 * their generated mechanic nodes and requires/supports/pays-off edges are a
 * second storage representation of the same facts. Omitting only that mirror
 * keeps all design guidance, transitions, constraints and lineage content
 * while avoiding a large duplicate block in every model request.
 */
export function buildTowerKnowledgeGraphPromptContext(
  value: unknown,
  activeArchetypeIds: readonly string[] = [],
): unknown {
  if (!isRecord(value)
    || !Array.isArray(value.nodes)
    || !Array.isArray(value.edges)
    || !Array.isArray(value.evolutionPaths)
    || value.nodes.some(node => !isRecord(node))
    || value.edges.some(edge => !isRecord(edge))
    || value.evolutionPaths.some(path => !isRecord(path))) {
    return clone(value);
  }
  const allSemanticNodeIds = new Set(value.nodes
    .filter(node => node.kind !== 'mechanic')
    .map(node => String(node.id || '')));
  const activeIds = new Set(activeArchetypeIds
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .map(id => id.startsWith('archetype:') ? id : `archetype:${id}`)
    .filter(id => allSemanticNodeIds.has(id)));
  const selectedEvolutionPaths = activeIds.size
    ? value.evolutionPaths
      .filter(path => activeIds.has(String(path.from || '')))
      .slice(0, 12)
    : value.evolutionPaths;
  const retainedNodeIds = activeIds.size ? new Set(activeIds) : new Set(allSemanticNodeIds);
  if (activeIds.size) {
    selectedEvolutionPaths.forEach(path => {
      if (allSemanticNodeIds.has(String(path.from || ''))) retainedNodeIds.add(String(path.from));
      if (allSemanticNodeIds.has(String(path.to || ''))) retainedNodeIds.add(String(path.to));
    });
    // Anti-synergy constraints are not duplicated inside archetype.data. Keep
    // only those attached to the retrieved roots and their immediate
    // neighbours, plus the small dynamic enemy lineage subgraph.
    value.nodes.forEach(node => {
      if (node.kind === 'enemy-family' || node.kind === 'enemy-action') retainedNodeIds.add(String(node.id || ''));
    });
    value.edges.forEach(edge => {
      if (edge.kind === 'anti-synergy' && retainedNodeIds.has(String(edge.from || ''))) {
        if (allSemanticNodeIds.has(String(edge.to || ''))) retainedNodeIds.add(String(edge.to));
      }
      if (
        ['uses-action', 'related-to'].includes(String(edge.kind || ''))
        && (retainedNodeIds.has(String(edge.from || '')) || retainedNodeIds.has(String(edge.to || '')))
      ) {
        if (allSemanticNodeIds.has(String(edge.from || ''))) retainedNodeIds.add(String(edge.from));
        if (allSemanticNodeIds.has(String(edge.to || ''))) retainedNodeIds.add(String(edge.to));
      }
    });
  }
  const semanticNodes = value.nodes.filter(node => retainedNodeIds.has(String(node.id || '')));
  const semanticEdges = value.edges.filter(edge => (
    retainedNodeIds.has(String(edge.from || '')) && retainedNodeIds.has(String(edge.to || ''))
  ));
  return {
    spec: value.spec,
    encoding: activeIds.size ? 'retrieved-semantic-subgraph/v3' : 'semantic-columnar-json/v2',
    derivedMechanicMirror: 'omitted; archetype.data contains the complete required/optional/payoff/role predicates',
    ...(activeIds.size ? { activeArchetypeIds: [...activeIds] } : {}),
    nodeColumns: ['id', 'kind', 'label', 'data'],
    nodes: semanticNodes.map(node => [node.id, node.kind, node.label, clone(node.data)]),
    edgeColumns: ['from', 'to', 'kind', 'weight', 'data'],
    edges: semanticEdges.map(edge => [
      edge.from,
      edge.to,
      edge.kind,
      edge.weight,
      edge.data === undefined ? null : clone(edge.data),
    ]),
    evolutionPathColumns: ['from', 'to', 'fromLabel', 'toLabel', 'transitionCost', 'bridgeFeatures'],
    evolutionPaths: selectedEvolutionPaths.map(path => [
      path.from,
      path.to,
      path.fromLabel,
      path.toLabel,
      path.transitionCost,
      clone(path.bridgeFeatures),
    ]),
  };
}

/** Keep the scoring facts the authoring model can act on. Per-seed probes,
 * fingerprints and cache metadata remain available in the dashboard, but are
 * not repeated beside the already-readable design prompt on every node. */
export function buildTowerDeckProfilePromptContext(value: unknown): unknown {
  if (!isRecord(value)) return clone(value);
  return {
    spec: value.spec,
    totalScore: value.totalScore,
    confidence: value.confidence,
    maxHp: value.maxHp,
    horizons: clone(value.horizons),
    dimensions: clone(value.dimensions),
    deckQuality: clone(value.deckQuality),
    unsupportedFeatures: clone(value.unsupportedFeatures),
    archetypes: Array.isArray(value.archetypes)
      ? clone(value.archetypes.slice(0, 5))
      : [],
    scatterShare: value.scatterShare,
    reasons: clone(value.reasons),
  };
}

function tail<T>(value: unknown, maximum: number): T[] {
  return Array.isArray(value) ? clone(value.slice(-maximum)) as T[] : [];
}

/** Strip evaluator receipts only from known node-diagnostic containers. */
function compactNodeDiagnosticsForPrompt(value: unknown): unknown {
  if (!isRecord(value)) return clone(value);
  const projected = clone(value);
  delete projected.program_balance;
  delete projected.evaluation;
  delete projected.originalEvaluation;
  delete projected.trials;
  delete projected.seeds;
  if (isRecord(projected.content)) projected.content = compactNodeDiagnosticsForPrompt(projected.content);
  return projected;
}

function stringify(value: unknown, fallback: string): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== '{}' ? serialized : fallback;
  } catch {
    return fallback;
  }
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isCancelledGeneration(error: unknown): boolean {
  return isRecord(error)
    && (error.code === 'cancelled' || error.name === 'TowerGenerationCancelledError');
}

function readTowerScope(scope: TowerCoordinatorScope): { stat: Record<string, any>; run: RunState } | null {
  if (!isRecord(scope.mvuData) || !isRecord(scope.mvuData.stat_data)) return null;
  const stat = scope.mvuData.stat_data;
  const lock = isRecord(stat.game_mode_lock) ? stat.game_mode_lock : null;
  if (lock?.schemaVersion !== TOWER_MODE_LOCK_SPEC || lock.mode !== 'tower') return null;
  const parsed = validateRunState(stat.run);
  if (!parsed.ok || parsed.value.schemaVersion !== RUN_SCHEMA_VERSION) return null;
  if (parsed.value.routeMode !== 'map' || !parsed.value.map) return null;
  return { stat, run: parsed.value };
}

/**
 * Build the model-facing MVU view. The complete message variable object also
 * contains a duplicate display tree, a validation schema, every map point and
 * every empty generation envelope. Those fields are authoritative for the
 * program but add no design facts for the next node and used to crowd cards,
 * statuses and custom requirements out of the prompt.
 */
export function buildTowerSemanticMvuContext(mvuData: Record<string, any>): Record<string, any> {
  const sourceStat = isRecord(mvuData.stat_data) ? mvuData.stat_data : {};
  const stat = clone(sourceStat);

  if (isRecord(stat.battle)) {
    // The design snapshot below carries the scored/normalized form of these
    // reports. Keeping both can add tens of thousands of repeated characters.
    delete stat.battle.design_context;
    delete stat.battle.lineage_memory;
    // Commit receipts are host bookkeeping, never model-authored mechanics.
    if (isRecord(stat.battle.core)) delete stat.battle.core.persistent_growth_receipts;
    stat.battle.cards = compactRuntimeCardInstances(stat.battle.cards);
    if (isRecord(stat.battle.enemy) && Array.isArray(stat.battle.enemies)) {
      const enemyFingerprint = canonicalJson(stat.battle.enemy);
      if (stat.battle.enemies.some((enemy: unknown) => canonicalJson(enemy) === enemyFingerprint)) {
        delete stat.battle.enemy;
      }
    }
  }

  // Reward is a runtime transaction pool, not a persistent gameplay fact for
  // authoring the next node. Feeding it back to the model encourages it to
  // copy pool_revision/request bookkeeping into a newly authored node reward.
  delete stat.reward;
  delete stat.run_node_reward;
  delete stat.run_reward_reroll;
  delete stat.run_event_reveal;
  delete stat.run_event_state;
  delete stat.initial_artifact_acquisition;
  // Program balance reports are committed/audited separately. They must never
  // become instructions for a later node's authoring request.
  delete stat.program_balance;
  if (isRecord(stat.run_node)) stat.run_node = compactNodeDiagnosticsForPrompt(stat.run_node);
  // Tower mode does not run the story-mode relationship simulation. Keep only
  // compact player/location facts that help author the next encounter.
  // Only finished prose is contextual history; generation logs/errors are not facts.
  stat.tower_battle_stories = Array.isArray(stat.tower_battle_stories)
    ? stat.tower_battle_stories.filter((entry: any) => entry.phase === 'ready').slice(-3)
      .map((entry: any) => ({ nodeId: entry.nodeId, narrative: entry.narrative })) : [];
  delete stat.npcs;
  delete stat.factions;
  if (isRecord(stat.status)) {
    stat.status = {
      time: stat.status.time,
      location: stat.status.location,
      profession: clone(stat.status.profession),
    };
  }

  if (isRecord(stat.run)) {
    const run = stat.run;
    // A calibration anchor is program measurement state, not a narrative or
    // mechanic fact for the next authoring request.
    delete run.encounterBaseline;
    const recentNodeIds = Array.from(new Set([
      ...tail<string>(run.visitedNodeIds, 3),
      ...(isRecord(run.currentNode) && typeof run.currentNode.id === 'string' ? [run.currentNode.id] : []),
    ]));
    const recentNodeContent = isRecord(run.nodeContent)
      ? Object.fromEntries(recentNodeIds
        .filter(nodeId => isRecord(run.nodeContent[nodeId]))
        .map(nodeId => [nodeId, compactNodeDiagnosticsForPrompt(run.nodeContent[nodeId])]))
      : {};
    stat.run = {
      schemaVersion: run.schemaVersion,
      phase: run.phase,
      act: run.act,
      actCount: run.actCount,
      floor: run.floor,
      floorsPerAct: run.floorsPerAct,
      currentNode: clone(run.currentNode),
      choices: clone(run.choices),
      gold: run.gold,
      nodeCounts: clone(run.nodeCounts),
      lastNodeKind: run.lastNodeKind,
      visitedNodeIds: clone(run.visitedNodeIds),
      opening: clone(run.opening),
      score: clone(run.score),
      stateRevision: run.stateRevision,
      recentNodeContent,
      rewardPreferences: towerRewardPreferenceContext(run as RunState),
      dungeonPlan: clone(run.dungeonPlan),
    };
  }

  // Preserve recent resolved facts without repeatedly feeding an unbounded
  // transaction/debug history to every silent request.
  if (Array.isArray(stat.run_transaction_log)) stat.run_transaction_log = tail(stat.run_transaction_log, 16);
  if (Array.isArray(stat.run_transaction_events)) stat.run_transaction_events = tail(stat.run_transaction_events, 16);
  if (Array.isArray(stat.run_trigger_invocations)) stat.run_trigger_invocations = tail(stat.run_trigger_invocations, 16);
  if ('run_event_history' in stat) {
    stat.run_event_history = compactRunEventHistoryForPrompt(stat.run_event_history);
  }

  return {
    spec: 'mwg.tower-semantic-mvu/v1',
    stat_data: stat,
  };
}

/** Build prompt sections from all gameplay facts and the program design snapshot. */
export function buildTowerGenerationContext(scope: TowerCoordinatorScope): TowerGenerationContext {
  const stat = scope.mvuData.stat_data;
  const semanticMvu = buildTowerSemanticMvuContext(scope.mvuData);
  const semanticStat = semanticMvu.stat_data;
  const snapshot = scope.designSnapshot;
  const existingDeckBalance = snapshot
    ? {
      // A per-job encounter plan supplies the only live enemy budget. This
      // shared section deliberately retains qualitative deck guidance only.
      deckProfile: {
        unsupportedFeatures: clone(snapshot.deckProfile.unsupportedFeatures),
        archetypes: clone(snapshot.deckProfile.archetypes.slice(0, 5)),
      },
      knowledgeGraph: buildTowerKnowledgeGraphPromptContext(
        snapshot.knowledgeGraph,
        snapshot.deckProfile.archetypes.slice(0, 5).map(entry => entry.id),
      ),
    }
    : '暂无独立设计辅助快照；卡组与路线信息见完整游戏事实，敌人预算以本节点程序要求为准。';
  const foundationGuidance = buildTowerFoundationGuidance(
    createContentPackFromMvuBattle(isRecord(semanticStat?.battle) ? semanticStat.battle : {}),
    typeof stat?.selected_mechanics === 'string' ? stat.selected_mechanics : '',
  );
  const deckBalance = stringify({ priorDesign: existingDeckBalance, foundationGuidance }, '构筑机制分析不可序列化');
  const lineage = stringify({
    current: snapshot?.lineage,
    persistent: scope.designState?.lineage,
  }, '暂无敌人谱系记录');
  const internal = isRecord(scope.mvuData.__magic_girl_world) ? scope.mvuData.__magic_girl_world : {};
  const customRequirements = firstText(
    stat?.tower_requirements,
    stat?.towerRequirements,
    stat?.run?.customRequirements,
    scope.mvuData.tower_requirements,
    internal.tower_requirements,
    internal.towerRequirements,
  );
  const semanticBattle = isRecord(semanticStat?.battle) ? semanticStat.battle : {};
  const semanticCore = isRecord(semanticBattle.core) ? semanticBattle.core : {};
  const contentReferenceContext = stringify({
    statuses: Array.isArray(semanticBattle.statuses)
      ? semanticBattle.statuses.filter(isRecord).map((status: Record<string, any>) => ({
          id: status.id,
          name: status.name,
          type: status.type,
        }))
      : [],
    resources: Array.isArray(semanticCore.resources)
      ? semanticCore.resources.filter(isRecord).map((resource: Record<string, any>) => ({
          id: resource.id,
          name: resource.name,
        }))
      : isRecord(semanticCore.resources)
        ? Object.entries(semanticCore.resources).map(([id, resource]) => ({
            id,
            ...(isRecord(resource) && typeof resource.name === 'string' ? { name: resource.name } : {}),
          }))
        : [],
    owned_content_ids: {
      cards: Array.isArray(semanticBattle.cards)
        ? semanticBattle.cards.filter(isRecord).map((card: Record<string, any>) => card.id).filter(Boolean)
        : [],
      artifacts: Array.isArray(semanticBattle.artifacts)
        ? semanticBattle.artifacts.filter(isRecord).map((artifact: Record<string, any>) => artifact.id).filter(Boolean)
        : [],
      items: Array.isArray(semanticBattle.items)
        ? semanticBattle.items.filter(isRecord).map((item: Record<string, any>) => item.id).filter(Boolean)
        : [],
    },
  }, '当前没有可复用的内容 ID');
  return {
    completeMvuContext: stringify(
      { ...semanticMvu, narrativeContinuity: '已完成的战后剧情仅供后续敌人、事件和场景参考；可以延续，也可以独立，不强制关联，不为等待剧情而推迟节点生成。' },
      '当前游戏事实不可序列化',
    ),
    deckBalanceContext: deckBalance,
    enemyLineageContext: lineage,
    contentReferenceContext,
    ...(customRequirements ? { customRequirements } : {}),
    difficultyPercent: scope.settings.difficultyPercent,
  };
}

/**
 * Serial extension-side scheduler for opening and at most three nearest
 * reachable nodes within the next three floors.
 * It never archives chat floors during active play; completed request pairs
 * stay in the compact per-chat queue until the controller batches them at a
 * terminal or explicit-exit boundary.
 */
export class TowerLookaheadCoordinator {
  private chatId: string | null = null;
  private epoch = 0;
  private scheduled = false;
  private running: Promise<void> | null = null;
  private runningEpoch: number | null = null;
  private rerunRequested = false;
  private recoveryRequested = false;
  private disposed = false;
  private activeGeneration: TowerCoordinatorGenerationRequest | null = null;
  private status: TowerCoordinatorStatus = {
    spec: 'mwg.tower-coordinator/v1',
    chatId: null,
    phase: 'idle',
    message: '等待爬塔存档',
    updatedAt: 0,
  };

  public constructor(private readonly ports: TowerCoordinatorPorts) {}

  public activateChat(chatId: string | null): void {
    this.epoch += 1;
    this.chatId = chatId;
    this.recoveryRequested = Boolean(chatId);
    this.rerunRequested = false;
    this.setStatus('idle', chatId ? '等待检查爬塔生成窗口' : '等待爬塔存档');
    this.schedule('chat-activated');
  }

  public requestRecovery(): void {
    if (!this.chatId || this.disposed) return;
    this.recoveryRequested = true;
    this.schedule('mvu-initialized');
  }

  public schedule(_reason = 'state-changed'): void {
    if (this.disposed || !this.chatId) return;
    this.cancelObsoleteGeneration();
    // A prior chat's unresolved transport must never block this chat's retry
    // button forever. Its late result is fenced by the epoch checks below.
    if ((this.running && this.runningEpoch === this.epoch) || this.scheduled) {
      this.rerunRequested = true;
      return;
    }
    this.scheduled = true;
    const epoch = this.epoch;
    globalThis.queueMicrotask(() => {
      this.scheduled = false;
      if (this.disposed) return;
      if (epoch !== this.epoch) {
        if (this.chatId) this.schedule('epoch-changed-before-run');
        return;
      }
      const task = this.runOnce(epoch);
      this.running = task;
      this.runningEpoch = epoch;
      void task.finally(() => {
        if (this.running === task) {
          this.running = null;
          this.runningEpoch = null;
        }
        if (this.disposed) return;
        if (epoch !== this.epoch) {
          if (this.chatId) this.schedule('epoch-changed-after-run');
          return;
        }
        if (this.rerunRequested) {
          this.rerunRequested = false;
          this.schedule('rerun');
        }
      });
    });
  }

  public getStatus(): TowerCoordinatorStatus {
    return clone(this.status);
  }

  public async retryNode(nodeId: string): Promise<boolean | null> {
    const epoch = this.epoch;
    await this.waitForCurrentPass();
    if (epoch !== this.epoch) return null;
    const scope = this.currentScope();
    if (!scope) return null;
    const draft = clone(scope.mvuData);
    retryTowerNodeGenerationInStat(draft.stat_data, String(nodeId || '').trim());
    await this.ports.replaceLatest(draft, scope.chatId, scope.messageId, scope.mvuData);
    this.schedule('manual-node-retry');
    return true;
  }

  public async retryOpening(): Promise<boolean | null> {
    const epoch = this.epoch;
    await this.waitForCurrentPass();
    if (epoch !== this.epoch) return null;
    const scope = this.currentScope();
    if (!scope) return null;
    const draft = clone(scope.mvuData);
    queueTowerOpeningInStat(draft.stat_data);
    await this.ports.replaceLatest(draft, scope.chatId, scope.messageId, scope.mvuData);
    this.schedule('manual-opening-retry');
    return true;
  }

  public deactivate(): void {
    this.disposed = true;
    this.epoch += 1;
    this.chatId = null;
    this.scheduled = false;
    this.rerunRequested = false;
    this.recoveryRequested = false;
    this.activeGeneration = null;
    this.runningEpoch = null;
    this.setStatus('idle', '爬塔协调器已停止');
  }

  private async runOnce(epoch: number): Promise<void> {
    try {
      if (epoch !== this.epoch || this.disposed) return;
      let scope = this.currentScope();
      if (!scope) {
        this.setStatus('idle', '当前不是可调度的 v3 爬塔地图');
        return;
      }

      if (this.recoveryRequested) {
        this.recoveryRequested = false;
        this.setStatus('recovering', '正在恢复上次中断的生成任务');
        const draft = clone(scope.mvuData);
        const openingRecovery = recoverTowerOpeningInStat(draft.stat_data);
        const nodeRecovery = recoverTowerGenerationsInStat(draft.stat_data);
        if (openingRecovery.changed || nodeRecovery.changed) {
          await this.ports.replaceLatest(draft, scope.chatId, scope.messageId, scope.mvuData);
          if (epoch !== this.epoch) return;
          scope = this.currentScope();
          if (!scope) return;
        }
      }

      const parsed = readTowerScope(scope);
      if (!parsed) return;
      const openingPhase = parsed.run.opening.phase;
      if (openingPhase === 'pending') {
        await this.generateOpening(scope, epoch);
        return;
      }
      if (openingPhase === 'generating' || openingPhase === 'failed') {
        this.setStatus('waiting', openingPhase === 'failed'
          ? '开局馈赠生成失败，等待手动重试'
          : '等待开局馈赠生成完成');
        return;
      }

      // Once the gift is visible, the player can read and choose it while the
      // reachable map nodes are prepared in one batch. Route activation still
      // remains gated by the opening settlement in the UI/transaction layer.
      // This overlaps model latency with actual play without exposing or
      // generating unreachable branches.

      if (parsed.run.phase === 'won' || parsed.run.phase === 'lost') {
        this.setStatus('waiting', '本局已结束，等待终局归档');
        return;
      }
      await this.generateNextLookahead(scope, epoch);
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      if (isCancelledGeneration(error)) {
        this.setStatus('waiting', '已取消过期路线的后台生成');
        return;
      }
      this.setStatus('error', error instanceof Error ? error.message : String(error));
      this.ports.onError?.('爬塔自动预生成失败', error);
    }
  }

  private async generateOpening(scope: TowerCoordinatorScope, epoch: number): Promise<void> {
    await this.ports.prepareDesignSnapshot?.();
    if (epoch !== this.epoch || this.disposed) return;
    scope = this.currentScope() || scope;
    const draft = clone(scope.mvuData);
    const queued = queueTowerOpeningInStat(draft.stat_data);
    const claimed = claimTowerOpeningInStat(draft.stat_data, queued.request.requestId);
    const prompt = formatTowerOpeningGenerationPrompt({
      requestId: claimed.request.requestId,
      basedOnRevision: claimed.request.revision,
      seed: claimed.request.seed,
      act: claimed.request.act,
      context: buildTowerGenerationContext({ ...scope, mvuData: draft }),
    });
    await this.ports.replaceLatest(draft, scope.chatId, scope.messageId, scope.mvuData);
    if (epoch !== this.epoch) return;
    this.setStatus('opening', '正在生成开局馈赠事件');
    const generationRequest: TowerCoordinatorGenerationRequest = {
      generationType: 'opening',
      requestId: claimed.request.requestId,
      revision: claimed.request.revision,
      prompt,
      maxAttempts: 3,
      sourceMessageId: scope.messageId,
    };
    this.activeGeneration = generationRequest;
    try {
      await this.ports.requestGeneration(generationRequest);
    } finally {
      if (this.activeGeneration === generationRequest) this.activeGeneration = null;
    }
    if (epoch === this.epoch) {
      this.rerunRequested = true;
      this.setStatus('waiting', '开局馈赠已准备，等待玩家选择');
    }
  }

  private async generateNextLookahead(scope: TowerCoordinatorScope, epoch: number): Promise<void> {
    const draft = clone(scope.mvuData);
    const queued = queueTowerLookaheadInStat(draft.stat_data, 3, { retryFailed: false });
    const claimed = claimQueuedTowerGenerationsInStat(draft.stat_data, 3);
    if (queued.changed || claimed.changed) {
      await this.ports.replaceLatest(draft, scope.chatId, scope.messageId, scope.mvuData);
      if (epoch !== this.epoch) return;
    }
    const requests = claimed.requests;
    for (const request of requests) if (request.kind === 'shop')
      request.shopMemoryCards = availableTowerMemoryCards(draft.stat_data, request.nodeId, 'shop').slice(0, 2);
    if (!requests.length) {
      this.setStatus('waiting', '当前可达节点均已准备或等待手动重试');
      return;
    }
    let generationRequest: TowerCoordinatorGenerationRequest | null = null;
    try {
      await this.ports.prepareDesignSnapshot?.();
      if (epoch !== this.epoch || this.disposed) {
        await this.failClaimedRequests(scope, requests, '生成准备在提交前失效，可安全重试');
        return;
      }
      const refreshedScope = this.currentScope();
      if (refreshedScope) scope = { ...scope, designSnapshot: refreshedScope.designSnapshot };
      const batchId = this.batchIdFor(requests);
      const jobs: TowerGenerationJobDescriptor[] = requests.map(request => ({
        nodeId: request.nodeId,
        requestId: request.requestId,
        basedOnRevision: request.revision,
        kind: request.kind,
        act: request.act,
        floor: request.floor,
        contentSeed: request.contentSeed,
        rewardSeed: request.rewardSeed,
        difficultyMultiplier: request.difficultyMultiplier,
        shopMemoryCards: request.shopMemoryCards,
      }));
      const prompt = formatTowerNodeBatchGenerationPrompt(
        batchId,
        jobs,
        buildTowerGenerationContext({ ...scope, mvuData: draft }),
      );
      this.setStatus('lookahead', `正在一次准备 ${requests.length} 个可达节点`);
      generationRequest = {
        generationType: 'batch',
        nodeId: `__tower_batch__${batchId}`,
        batchId,
        jobs: clone(requests),
        requestId: batchId,
        basedOnRevision: requests[0].revision,
        maxAttempts: 3,
        prompt,
        sourceMessageId: scope.messageId,
      };
      this.activeGeneration = generationRequest;
      await this.ports.requestGeneration(generationRequest);
    } catch (error) {
      // Preparation happens after the durable claim. Both a warmup failure and
      // a transport failure must settle that exact claim; otherwise a reload
      // is required to recover an ownerless `generating` envelope.
      await this.failClaimedRequests(scope, requests, error);
      if (epoch === this.epoch) this.rerunRequested = true;
      throw error;
    } finally {
      if (this.activeGeneration === generationRequest) this.activeGeneration = null;
    }
    if (epoch === this.epoch) {
      this.rerunRequested = true;
      this.setStatus('waiting', '节点内容已提交，继续检查可达窗口');
    }
  }

  /**
   * Fail only the envelopes claimed by this pass. A newer retry, a completed
   * response, or a route change must win over this cleanup without being
   * overwritten by a delayed warmup/transport rejection.
   */
  private async failClaimedRequests(
    scope: TowerCoordinatorScope,
    requests: readonly TowerStateGenerationRequest[],
    error: unknown,
  ): Promise<void> {
    const latest = this.ports.snapshot();
    if (!latest || latest.chatId !== scope.chatId || latest.messageId !== scope.messageId) return;
    const draft = clone(latest.mvuData);
    let changed = false;
    const message = error instanceof Error ? error.message : String(error);
    for (const request of requests) {
      try {
        const failed = failTowerGenerationInStat(draft.stat_data, {
          nodeId: request.nodeId,
          requestId: request.requestId,
          revision: request.revision,
          error: `节点预生成未提交：${message}`,
        });
        changed ||= failed.changed;
      } catch {
        // The exact claim is already ready, failed, retried, or abandoned.
        // Do not turn a newer authoritative state back into a failure.
      }
    }
    if (changed) await this.ports.replaceLatest(draft, scope.chatId, scope.messageId, latest.mvuData);
  }

  private currentScope(): TowerCoordinatorScope | null {
    const scope = this.ports.snapshot();
    if (!scope || scope.chatId !== this.chatId || !readTowerScope(scope)) return null;
    return scope;
  }

  private cancelObsoleteGeneration(): void {
    const request = this.activeGeneration;
    if (!request) return;
    const scope = this.currentScope();
    const parsed = scope ? readTowerScope(scope) : null;
    if (!parsed) return;
    const nodeIds = request.generationType === 'batch'
      ? (request.jobs || []).map(job => job.nodeId)
      : request.nodeId ? [request.nodeId] : [];
    if (!nodeIds.length || !nodeIds.every(nodeId => parsed.run.nodeContent[nodeId]?.phase === 'abandoned')) return;
    try {
      this.ports.cancelGeneration?.(request, '路线已改变，过期分支的后台生成已取消');
    } catch (error) {
      this.ports.onError?.('取消过期爬塔分支失败，迟到结果仍会被状态校验拒绝', error);
    }
  }

  private batchIdFor(requests: readonly TowerStateGenerationRequest[]): string {
    const source = requests.map(request => `${request.nodeId}:${request.requestId}`).join('|');
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `tower_batch_${requests[0]?.revision ?? 0}_${(hash >>> 0).toString(36)}`;
  }

  private async waitForCurrentPass(): Promise<void> {
    const running = this.running;
    if (!running || this.runningEpoch !== this.epoch) return;
    try {
      await running;
    } catch {
      // A failed generation is already represented in MVU; retry operates on
      // the next authoritative snapshot.
    }
  }

  private setStatus(phase: TowerCoordinatorStatus['phase'], message: string): void {
    this.status = {
      spec: 'mwg.tower-coordinator/v1',
      chatId: this.chatId,
      phase,
      message,
      updatedAt: Date.now(),
    };
  }
}
