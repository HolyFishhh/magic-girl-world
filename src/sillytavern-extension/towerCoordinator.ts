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

function tail<T>(value: unknown, maximum: number): T[] {
  return Array.isArray(value) ? clone(value.slice(-maximum)) as T[] : [];
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
  }

  // Reward is a runtime transaction pool, not a persistent gameplay fact for
  // authoring the next node. Feeding it back to the model encourages it to
  // copy pool_revision/request bookkeeping into a newly authored node reward.
  delete stat.reward;
  delete stat.run_node_reward;
  delete stat.run_reward_reroll;
  // Tower mode does not run the story-mode relationship simulation. Keep only
  // compact player/location facts that help author the next encounter.
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
    const recentNodeIds = Array.from(new Set([
      ...tail<string>(run.visitedNodeIds, 3),
      ...(isRecord(run.currentNode) && typeof run.currentNode.id === 'string' ? [run.currentNode.id] : []),
    ]));
    const recentNodeContent = isRecord(run.nodeContent)
      ? Object.fromEntries(recentNodeIds
        .filter(nodeId => isRecord(run.nodeContent[nodeId]))
        .map(nodeId => [nodeId, clone(run.nodeContent[nodeId])]))
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
    };
  }

  // Preserve recent resolved facts without repeatedly feeding an unbounded
  // transaction/debug history to every silent request.
  if (Array.isArray(stat.run_transaction_log)) stat.run_transaction_log = tail(stat.run_transaction_log, 16);
  if (Array.isArray(stat.run_transaction_events)) stat.run_transaction_events = tail(stat.run_transaction_events, 16);
  if (Array.isArray(stat.run_trigger_invocations)) stat.run_trigger_invocations = tail(stat.run_trigger_invocations, 16);

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
  const deckBalance = snapshot
    ? stringify({
      deckProfile: snapshot.deckProfile,
      enemyEnvelope: snapshot.enemyEnvelope,
      knowledgeGraph: snapshot.knowledgeGraph,
      designPrompt: snapshot.prompt,
    }, snapshot.prompt || '设计辅助快照不可序列化')
    : stringify({ battle: semanticStat?.battle, run: semanticStat?.run }, '暂无设计辅助快照');
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
  return {
    completeMvuContext: stringify(
      semanticMvu,
      '当前游戏事实不可序列化',
    ),
    deckBalanceContext: deckBalance,
    enemyLineageContext: lineage,
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
    if (this.running || this.scheduled) {
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
      void task.finally(() => {
        if (this.running === task) this.running = null;
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
    await this.ports.replaceLatest(draft, scope.chatId, scope.messageId);
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
    await this.ports.replaceLatest(draft, scope.chatId, scope.messageId);
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
    this.setStatus('idle', '爬塔协调器已停止');
  }

  private async runOnce(epoch: number): Promise<void> {
    try {
      await this.ports.prepareDesignSnapshot?.();
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
          await this.ports.replaceLatest(draft, scope.chatId, scope.messageId);
          if (epoch !== this.epoch) return;
          scope = this.currentScope();
          if (!scope) return;
        }
      }

      const parsed = readTowerScope(scope);
      if (!parsed) return;
      const openingPhase = parsed.run.opening.phase;
      if (openingPhase !== 'consumed' && openingPhase !== 'skipped') {
        if (openingPhase === 'pending') {
          await this.generateOpening(scope, epoch);
        } else {
          this.setStatus('waiting', openingPhase === 'ready'
            ? '等待玩家选择开局馈赠'
            : openingPhase === 'failed'
              ? '开局馈赠生成失败，等待手动重试'
              : '等待开局馈赠生成完成');
        }
        return;
      }

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
    const draft = clone(scope.mvuData);
    const queued = queueTowerOpeningInStat(draft.stat_data);
    const claimed = claimTowerOpeningInStat(draft.stat_data, queued.request.requestId);
    const prompt = formatTowerOpeningGenerationPrompt({
      requestId: claimed.request.requestId,
      basedOnRevision: claimed.request.revision,
      seed: claimed.request.seed,
      context: buildTowerGenerationContext({ ...scope, mvuData: draft }),
    });
    await this.ports.replaceLatest(draft, scope.chatId, scope.messageId);
    if (epoch !== this.epoch) return;
    this.setStatus('opening', '正在生成开局馈赠事件');
    await this.ports.requestGeneration({
      generationType: 'opening',
      requestId: claimed.request.requestId,
      revision: claimed.request.revision,
      prompt,
      maxAttempts: 3,
      sourceMessageId: scope.messageId,
    });
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
      await this.ports.replaceLatest(draft, scope.chatId, scope.messageId);
      if (epoch !== this.epoch) return;
    }
    const requests = claimed.requests;
    if (!requests.length) {
      this.setStatus('waiting', '当前可达节点均已准备或等待手动重试');
      return;
    }
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
    }));
    const prompt = formatTowerNodeBatchGenerationPrompt(
      batchId,
      jobs,
      buildTowerGenerationContext({ ...scope, mvuData: draft }),
    );
    this.setStatus('lookahead', `正在一次准备 ${requests.length} 个可达节点`);
    const generationRequest: TowerCoordinatorGenerationRequest = {
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
    try {
      await this.ports.requestGeneration(generationRequest);
    } catch (error) {
      // One malformed or temporarily failed candidate must not strand the
      // other already-queued reachable choices. Keep the failed envelope
      // retryable, then let the next coordinator pass claim a sibling.
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
    if (!running) return;
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
