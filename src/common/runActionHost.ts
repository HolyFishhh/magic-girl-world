import { hasPendingInitialArtifactAcquisition } from './initialArtifactAcquisition';
import {
  formatRestUpgradePrompt,
  migratePersistentRunDeck,
  normalizeTowerItemInventory,
  type RunNodeChoice,
  type RunState,
} from '../game-core';
import {
  consumePendingRunResultInStat,
  deriveRunSeed,
  ensureRunStateInStat,
  enterRunNodeInStat,
  migrateRunProgramStateInStat,
  readRunState,
  restartRunInStat,
} from '../runtime/runStateAdapter';
import {
  enterTowerRunNodeInStat,
  requeueInvalidReadyTowerNodeGenerationInStat,
  retryTowerNodeGenerationInStat,
  type TowerGenerationRequest,
} from '../runtime/towerStateAdapter';
import { activateTowerNodeInStat, type TowerNodeActivationResult } from '../runtime/towerContentActivation';
import { queueTowerOpeningInStat, type TowerOpeningRequest } from '../runtime/towerOpeningAdapter';
import { isCurrentMessageLatest } from '../runtime/messageVariables';
import {
  hasSelectableRewards,
  normalizeMvuList,
  removeOneCardFromBattleDeck,
  type CardRemovalResult,
  type RewardSelections,
  type RewardSelectionSummary,
} from './rewardTransactions';
import {
  executeUnifiedRunTransactionInStat,
  settleTowerEventChoiceInStat,
  settleTowerOpeningChoiceInStat,
  type RestHealResult,
  type RestUpgradeResult,
  type RunTransactionEvent,
  type TowerEventChoiceSettlementResult,
  type TowerOpeningSettlementResult,
} from './runTransactions';
import { TavernCommonActionHost, type CommonContinuationPlan, type CommonVariablesUpdater } from './commonActionHost';

export interface CommonRunActionPorts {
  isLatest(): boolean;
  initialPublicationReady?(): boolean;
  updateVariablesWith(updater: CommonVariablesUpdater): Promise<Record<string, any>>;
  /** Safe only for fingerprint-guarded historical reward settlement. */
  updateLatestVariablesWith?(updater: CommonVariablesUpdater): Promise<Record<string, any>>;
  continueWithPrompt<TPrepared = void>(plan: CommonContinuationPlan<TPrepared>): Promise<void>;
  scheduleTowerGeneration?(reason: string): Promise<unknown> | unknown;
  requestRestMutation?(request: {
    spec: 'mwg.rest-mutation-request/v1';
    kind: 'upgrade' | 'transform';
    nodeId: string;
    runInstanceId?: string;
    cardId?: string;
  }): Promise<unknown> | unknown | null;
}

export interface CommonRunSyncResult {
  consumedRunResult: boolean;
  restUpgrade: RestUpgradeResult | null;
  restTransform: { runInstanceId: string; cardName: string } | null;
}

export interface CommonRewardSettlement {
  kind: 'reward' | 'shop' | 'event';
  summary: RewardSelectionSummary;
  spentGold: number | null;
  event: RunTransactionEvent;
}

/**
 * Identifies exactly the reward pool shown by a rendered panel.  A battle
 * message can become historical while the story continuation is appended; in
 * that case we may settle into the latest message only if this identity still
 * matches.  IDs/names preserve order so a regenerated pool cannot be claimed
 * through an old overlay.
 */
export interface RewardPoolFingerprint {
  nodeId: string | null;
  poolRevision: string;
  /** Gold is independently claimable, so an old menu must not claim a changed offer. */
  gold: string;
  candidates: Record<RewardCategory, string[]>;
  content?: string;
}

export interface RewardSettlementOptions {
  acquisitionAnswers?: Record<string, import('./nonCombatSettlementTransactions').NonCombatAnswers>;
  expectedReward?: RewardPoolFingerprint;
  partial?: boolean;
  claimGold?: boolean;
  discardGold?: boolean;
  cardGroupId?: string;
}

interface OptionalValueSnapshot {
  present: boolean;
  value: unknown;
}

interface RetrySnapshot {
  runResult: OptionalValueSnapshot;
  runUpgrade: OptionalValueSnapshot;
  runUpgradeTarget: OptionalValueSnapshot;
  runTransform: OptionalValueSnapshot;
  runTransformTarget: OptionalValueSnapshot;
}

interface RestUpgradePreparationSnapshot {
  runUpgrade: OptionalValueSnapshot;
  runUpgradeTarget: OptionalValueSnapshot;
  cards: unknown;
}

interface RestTransformPreparationSnapshot {
  runTransform: OptionalValueSnapshot;
  runTransformTarget: OptionalValueSnapshot;
  cards: unknown;
}

type RewardCategory = 'cards' | 'artifacts' | 'items';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function statRoot(variables: unknown): Record<string, any> {
  if (!isRecord(variables) || !isRecord(variables.stat_data)) throw new Error('stat_data 不存在');
  return variables.stat_data;
}

function optionalValue(root: Record<string, any>, key: string): OptionalValueSnapshot {
  return {
    present: Object.prototype.hasOwnProperty.call(root, key),
    value: root[key],
  };
}

function restoreOptionalValue(root: Record<string, any>, key: string, snapshot: OptionalValueSnapshot): void {
  if (snapshot.present) root[key] = snapshot.value;
  else delete root[key];
}

function replaceRecord(target: Record<string, any>, source: Record<string, any>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function persistentCards(stat: Record<string, any>): Record<string, any>[] {
  if (!isRecord(stat.battle)) throw new Error('battle 数据不存在');
  return migratePersistentRunDeck(normalizeMvuList<Record<string, any>>(stat.battle.cards));
}

function rewardCandidateIdentity(value: unknown, index: number): string {
  if (!isRecord(value)) return `invalid:${index}`;
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : '';
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '';
  return id ? `id:${id}` : name ? `name:${name}` : `invalid:${index}`;
}

/** Capture the displayed reward pool before an asynchronous UI action starts. */
export function createRewardPoolFingerprint(stat: Record<string, any>): RewardPoolFingerprint {
  if (!isRecord(stat.reward)) throw new Error('奖励数据不存在，无法确认领取目标');
  const run = readRunState(stat);
  return {
    nodeId: typeof run?.currentNode?.id === 'string' ? run.currentNode.id : null,
    poolRevision: String(stat.reward.pool_revision ?? ''),
    gold: `${Number(stat.reward.gold) || 0}:${stat.reward.gold_claimed === true}`,
    content: JSON.stringify(stat.reward),
    candidates: {
      cards: normalizeMvuList(stat.reward.card).map(rewardCandidateIdentity),
      artifacts: normalizeMvuList(stat.reward.artifact).map(rewardCandidateIdentity),
      items: normalizeMvuList(stat.reward.item).map(rewardCandidateIdentity),
    },
  };
}

export function createShopPurchaseQuote(stat: Record<string, any>) {
  const run=readRunState(stat);
  return {pool:createRewardPoolFingerprint(stat),stock:JSON.stringify(stat.reward),
    runIdentity:JSON.stringify([run?.seed,run?.act,run?.floor,run?.currentNode?.id])};
}

export function rewardPoolFingerprintMatches(
  stat: Record<string, any>,
  expected: RewardPoolFingerprint,
): boolean {
  const actual = createRewardPoolFingerprint(stat);
  return (
    actual.nodeId === expected.nodeId &&
    actual.poolRevision === expected.poolRevision &&
    actual.gold === expected.gold &&
    (expected.content === undefined || actual.content === expected.content) &&
    (['cards', 'artifacts', 'items'] as const).every(
      category =>
        actual.candidates[category].length === expected.candidates[category].length &&
        actual.candidates[category].every((value, index) => value === expected.candidates[category][index]),
    )
  );
}

function resolvePendingUpgradeTarget(stat: Record<string, any>, node: RunNodeChoice): string {
  const cards = persistentCards(stat);
  const target = isRecord(stat.run_upgrade_target) ? stat.run_upgrade_target : null;
  if (target) {
    if (target.node_id !== node.id || typeof target.run_instance_id !== 'string') {
      throw new Error('营火升级目标已过期');
    }
    if (!cards.some(card => card.runInstanceId === target.run_instance_id)) {
      throw new Error('营火升级目标卡牌不存在');
    }
    return target.run_instance_id;
  }
  const cardId = isRecord(stat.run_upgrade) ? stat.run_upgrade.card_id : null;
  const matches = cards.filter(card => card.id === cardId);
  if (matches.length !== 1) {
    throw new Error(matches.length === 0 ? '营火升级目标卡牌不存在' : '旧营火升级目标不明确，请重新选择具体卡牌');
  }
  return matches[0].runInstanceId;
}

function resolvePendingTransformTarget(stat: Record<string, any>, node: RunNodeChoice): string {
  const cards = persistentCards(stat);
  const target = isRecord(stat.run_transform_target) ? stat.run_transform_target : null;
  if (!target || target.node_id !== node.id || typeof target.run_instance_id !== 'string') {
    throw new Error('营火变形目标不存在或已经过期');
  }
  if (!cards.some(card => card.runInstanceId === target.run_instance_id)) {
    throw new Error('营火变形目标卡牌不存在');
  }
  return target.run_instance_id;
}

/** Owns common-view route/reward MUV transactions without importing any DOM code. */
export class TavernRunActionHost {
  private static instance: TavernRunActionHost;

  public constructor(
    private readonly ports: CommonRunActionPorts = (() => {
      const actionHost = TavernCommonActionHost.getInstance();
      return {
        isLatest: () => isCurrentMessageLatest(),
        initialPublicationReady: () => (globalThis as any).MagicGirlWorld?.getTowerInitialPublicationStatus?.()?.ready !== false,
        updateVariablesWith: updater => actionHost.updateVariablesWith(updater),
        updateLatestVariablesWith: updater => actionHost.updateLatestVariablesWith(updater),
        continueWithPrompt: plan => actionHost.continueWithPrompt(plan),
        scheduleTowerGeneration: reason => {
          const runtime = (globalThis as any).MagicGirlWorld;
          return typeof runtime?.scheduleTowerGeneration === 'function'
            ? runtime.scheduleTowerGeneration(reason)
            : false;
        },
        requestRestMutation: request => {
          const runtime = (globalThis as any).MagicGirlWorld;
          return typeof runtime?.requestRestMutation === 'function'
            ? runtime.requestRestMutation(request)
            : null;
        },
      };
    })(),
  ) {}

  /**
   * Program-owned MVU writes do not consistently emit Tavern Helper's
   * mvu_update_ended event. Explicitly wake the extension after a tower state
   * transition, but never make a completed player transaction fail merely
   * because the optional background generator is temporarily unavailable.
   */
  private async scheduleTowerGeneration(reason: string): Promise<void> {
    try {
      await this.ports.scheduleTowerGeneration?.(reason);
    } catch (error) {
      console.warn(`[MagicGirlWorld] 爬塔后台唤醒失败（${reason}）：`, error);
    }
  }

  public static getInstance(): TavernRunActionHost {
    if (!TavernRunActionHost.instance) TavernRunActionHost.instance = new TavernRunActionHost();
    return TavernRunActionHost.instance;
  }

  public async syncPendingRunState(): Promise<CommonRunSyncResult> {
    const result: CommonRunSyncResult = {
      consumedRunResult: false,
      restUpgrade: null,
      restTransform: null,
    };
    if (!this.ports.isLatest()) return result;

    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      const stat = statRoot(variables);
      migrateRunProgramStateInStat(stat);
      const pendingRun = readRunState(stat);
      if (!pendingRun) return variables;
      const pendingEventRewards =
        pendingRun?.phase === 'in_node' &&
        pendingRun.currentNode?.kind === 'event' &&
        stat.run_result != null &&
        hasSelectableRewards(stat);
      if (stat.run_result != null && !pendingEventRewards) {
        result.consumedRunResult = !!consumePendingRunResultInStat(stat);
      }

      const currentRun = readRunState(stat);
      if (currentRun?.routeMode !== 'map' && currentRun?.phase === 'in_node' && currentRun.currentNode?.kind === 'rest') {
        if (stat.run_upgrade && stat.run_transform) throw new Error('营火不能同时结算升级与变形');
        if (stat.run_transform) {
          const runInstanceId = resolvePendingTransformTarget(stat, currentRun.currentNode);
          const transaction = executeUnifiedRunTransactionInStat(stat, {
            kind: 'rest_transform_card',
            runInstanceId,
            replacement: stat.run_transform,
            source: { kind: 'system', id: 'ai-run-rest-transform' },
          });
          result.restTransform = transaction.value as { runInstanceId: string; cardName: string };
          delete stat.run_transform;
          delete stat.run_transform_target;
        } else if (stat.run_upgrade) {
          const runInstanceId = resolvePendingUpgradeTarget(stat, currentRun.currentNode);
          const transaction = executeUnifiedRunTransactionInStat(stat, {
            kind: 'rest_upgrade_card',
            runInstanceId,
            patch: stat.run_upgrade,
            source: { kind: 'system', id: 'ai-run-rest' },
          });
          result.restUpgrade = transaction.value as RestUpgradeResult;
          delete stat.run_upgrade_target;
        }
      }
      return variables;
    });
    return result;
  }

  public async startRun(): Promise<RunState> {
    if (!this.ports.isLatest()) throw new Error('历史楼层不能开始远征');
    let run: RunState | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      const stat = statRoot(variables);
      if (isRecord(stat.battle)) stat.battle.items = normalizeTowerItemInventory(stat.battle.items);
      run = ensureRunStateInStat(stat, deriveRunSeed(stat)).run;
      return variables;
    });
    if (!run) throw new Error('远征初始化失败：MUV 更新未返回状态');
    await this.scheduleTowerGeneration('run-created');
    return run;
  }

  public async settleRewardSelections(
    selections: RewardSelections,
    options: RewardSettlementOptions = {},
  ): Promise<CommonRewardSettlement> {
    let settlement: CommonRewardSettlement | null = null;
    let hasPendingRewards = true;
    const historical = !this.ports.isLatest();
    if (historical && !options.expectedReward) {
      throw new Error('历史奖励缺少校验信息，请在最新消息中重新打开奖励');
    }
    const update = historical ? this.ports.updateLatestVariablesWith : this.ports.updateVariablesWith;
      if (!update) throw new Error('当前酒馆版本无法安全结算历史奖励，请在最新消息中领取');
      await update((variables: Record<string, any>) => {
        if (!historical && !this.ports.isLatest()) throw new Error('奖励消息已经更新，请在最新消息中重新领取');
        const stat = statRoot(variables);
      if (options.expectedReward && !rewardPoolFingerprintMatches(stat, options.expectedReward)) {
        throw new Error('奖励已经更新，请在最新消息中重新打开奖励后领取');
      }
      const run = readRunState(stat);
      if (run?.phase === 'in_node' && run.currentNode?.kind === 'shop') {
        const transaction = executeUnifiedRunTransactionInStat(stat, {
          kind: 'shop_purchase',
          acquisitionAnswers: options.acquisitionAnswers,
          selections,
          source: { kind: 'player', id: 'reward-ui' },
        });
        const value = transaction.value as RewardSelectionSummary & { spentGold: number };
        settlement = { kind: 'shop', summary: value, spentGold: value.spentGold, event: transaction.event };
      } else if (run?.phase === 'in_node' && run.currentNode?.kind === 'treasure') {
        const transaction = executeUnifiedRunTransactionInStat(stat, {
          kind: 'treasure_reward_claim',
          acquisitionAnswers: options.acquisitionAnswers,
          selections,
          source: { kind: 'player', id: 'reward-ui' },
        });
        settlement = {
          kind: 'reward',
          summary: transaction.value as RewardSelectionSummary,
          spentGold: null,
          event: transaction.event,
        };
      } else if (run?.phase === 'in_node' && run.currentNode?.kind === 'event' && stat.run_result != null) {
        const transaction = executeUnifiedRunTransactionInStat(stat, {
          kind: 'event_reward_claim',
          acquisitionAnswers: options.acquisitionAnswers,
          selections,
          source: { kind: 'player', id: 'reward-ui' },
        });
        settlement = {
          kind: 'event',
          summary: transaction.value as RewardSelectionSummary,
          spentGold: null,
          event: transaction.event,
        };
      } else {
        const transaction = executeUnifiedRunTransactionInStat(stat, {
          kind: 'reward_claim',
          acquisitionAnswers: options.acquisitionAnswers,
          selections,
          partial: options.partial,
          claimGold: options.claimGold,
          discardGold: options.discardGold,
          cardGroupId: options.cardGroupId,
          source: { kind: 'player', id: 'reward-ui' },
        });
        settlement = {
          kind: 'reward',
          summary: transaction.value as RewardSelectionSummary,
          spentGold: null,
          event: transaction.event,
        };
      }
      hasPendingRewards = hasSelectableRewards(stat);
      return variables;
    });
    if (!settlement) throw new Error('奖励领取失败：MUV 更新未返回结算结果');
    // A partial claim leaves the current battle node and every other reward
    // category intact.  Defer background route work until the menu is empty.
    if (!options.partial || !hasPendingRewards) await this.scheduleTowerGeneration('reward-settled');
    return settlement;
  }

  public enterRunNode(node: RunNodeChoice, prompt: string): Promise<void> {
    return this.ports.continueWithPrompt<RunState>({
      prompt,
      prepare: async () => {
        let previous: RunState | null = null;
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          previous = enterRunNodeInStat(statRoot(variables), node.id).previous;
          return variables;
        });
        if (!previous) throw new Error('路线进入未返回可回滚状态');
        return previous;
      },
      rollbackBeforeSend: async previous => {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          const current = readRunState(stat);
          if (current?.phase === 'in_node' && current.currentNode?.id === node.id) stat.run = previous;
          return variables;
        });
      },
    });
  }

  /** Enter one DAG node and reconcile discarded branches in the same MUV replacement. */
  public enterTowerRunNode(node: RunNodeChoice, prompt: string): Promise<void> {
    return this.ports.continueWithPrompt<RunState>({
      prompt,
      prepare: async () => {
        let previous: RunState | null = null;
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          if (hasPendingInitialArtifactAcquisition(statRoot(variables))) throw new Error('请先完成初始遗物的选择');
          previous = enterTowerRunNodeInStat(statRoot(variables), node.id).previous;
          return variables;
        });
        if (!previous) throw new Error('爬塔路线进入未返回可回滚状态');
        return previous;
      },
      rollbackBeforeSend: async previous => {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          const current = readRunState(stat);
          if (current?.phase === 'in_node' && current.currentNode?.id === node.id) stat.run = previous;
          return variables;
        });
      },
    });
  }

  /** Requeue only the failed map node selected by the player. */
  public async retryTowerNodeGeneration(nodeId: string): Promise<TowerGenerationRequest> {
    let request: TowerGenerationRequest | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      request = retryTowerNodeGenerationInStat(statRoot(variables), nodeId).request;
      return variables;
    });
    if (!request) throw new Error('爬塔节点重试未返回生成请求');
    await this.scheduleTowerGeneration('node-retry-queued');
    return request;
  }

  /** Consume one pre-generated v3 map node without asking AI to generate it again. */
  public async activateTowerRunNode(nodeId: string): Promise<TowerNodeActivationResult> {
    if (!this.ports.isLatest()) throw new Error('历史楼层不能进入爬塔节点');
    if (this.ports.initialPublicationReady?.() === false) throw new Error('请先完成开局保存确认');
    const normalizedNodeId = String(nodeId || '').trim();
    if (!normalizedNodeId) throw new Error('爬塔节点 ID 不能为空');

    let previousStat: Record<string, any> | null = null;
    let activation: TowerNodeActivationResult | null = null;
    try {
      await this.ports.updateVariablesWith((variables: Record<string, any>) => {
        if (this.ports.initialPublicationReady?.() === false) throw new Error('开局保存尚未确认，未进入节点');
        const stat = statRoot(variables);
        if (hasPendingInitialArtifactAcquisition(stat)) throw new Error('请先完成初始遗物的选择');
        previousStat = structuredClone(stat);
        activation = activateTowerNodeInStat(stat, normalizedNodeId);
        return variables;
      });
    } catch (error) {
      // Validation failures occur before activateTowerNodeInStat publishes its
      // draft, so they need no compensating write. Only recover when the node
      // was activated but the outer MVU persistence step then failed.
      if (previousStat && activation) {
        try {
          await this.ports.updateVariablesWith((variables: Record<string, any>) => {
            const stat = statRoot(variables);
            const run = readRunState(stat);
            const activeNode = isRecord(stat.run_node) ? stat.run_node : null;
            if (
              run?.phase === 'in_node' &&
              run.currentNode?.id === normalizedNodeId &&
              activeNode?.node_id === normalizedNodeId
            ) {
              replaceRecord(stat, structuredClone(previousStat!));
            }
            return variables;
          });
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], '爬塔节点进入失败，且完整状态回滚失败');
        }
      }
      const detail = error instanceof Error ? error.message : String(error);
      const invalidPreparedContent = /^(?:tower\s+(?:battle\s+content|reward|event)|tower\s+node\s+(?:reward|payload)|battle\s+data\s+is\s+unavailable)/i.test(detail);
      if (!activation && invalidPreparedContent) {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          requeueInvalidReadyTowerNodeGenerationInStat(statRoot(variables), normalizedNodeId, detail);
          return variables;
        });
        await this.scheduleTowerGeneration('invalid-ready-node-requeued');
        throw new Error('这个节点的旧版或不完整内容已自动重新生成；后台准备完成后即可再次进入。');
      }
      throw error;
    }
    if (!activation) throw new Error('爬塔节点激活失败：MUV 更新未返回结果');
    await this.scheduleTowerGeneration('node-activated');
    return activation;
  }

  public retryRunNode(node: RunNodeChoice, prompt: string): Promise<void> {
    return this.ports.continueWithPrompt<RetrySnapshot>({
      prompt,
      prepare: async () => {
        let previous: RetrySnapshot | null = null;
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          previous = {
            runResult: optionalValue(stat, 'run_result'),
            runUpgrade: optionalValue(stat, 'run_upgrade'),
            runUpgradeTarget: optionalValue(stat, 'run_upgrade_target'),
            runTransform: optionalValue(stat, 'run_transform'),
            runTransformTarget: optionalValue(stat, 'run_transform_target'),
          };
          stat.run_result = null;
          if (node.kind === 'rest') {
            stat.run_upgrade = null;
            delete stat.run_upgrade_target;
            stat.run_transform = null;
            delete stat.run_transform_target;
          }
          return variables;
        });
        if (!previous) throw new Error('节点重试未返回可回滚状态');
        return previous;
      },
      rollbackBeforeSend: async previous => {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          restoreOptionalValue(stat, 'run_result', previous.runResult);
          if (node.kind === 'rest') {
            restoreOptionalValue(stat, 'run_upgrade', previous.runUpgrade);
            restoreOptionalValue(stat, 'run_upgrade_target', previous.runUpgradeTarget);
            restoreOptionalValue(stat, 'run_transform', previous.runTransform);
            restoreOptionalValue(stat, 'run_transform_target', previous.runTransformTarget);
          }
          return variables;
        });
      },
    });
  }

  public requestRestUpgrade(node: RunNodeChoice, card: Record<string, any>): Promise<void> {
    if (this.ports.requestRestMutation) {
      if (node.kind !== 'rest') return Promise.reject(new Error('营火升级需要有效的营火节点'));
      return Promise.resolve(this.ports.requestRestMutation({
        spec: 'mwg.rest-mutation-request/v1',
        kind: 'upgrade',
        nodeId: node.id,
        ...(typeof card.runInstanceId === 'string' ? { runInstanceId: card.runInstanceId } : {}),
        ...(typeof card.id === 'string' ? { cardId: card.id } : {}),
      })).then(result => {
        if (result === null || result === undefined) throw new Error('爬塔后台组件尚未提供营火升级功能');
      });
    }
    const prompt = formatRestUpgradePrompt({ node, card });
    return this.ports.continueWithPrompt<RestUpgradePreparationSnapshot>({
      prompt,
      prepare: async () => {
        let previous: RestUpgradePreparationSnapshot | null = null;
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          if (!isRecord(stat.battle)) throw new Error('battle 数据不存在');
          const cards = persistentCards(stat);
          const selected =
            typeof card.runInstanceId === 'string'
              ? cards.find(entry => entry.runInstanceId === card.runInstanceId)
              : cards.find(entry => entry.id === card.id);
          if (!selected) throw new Error('营火升级目标卡牌不存在');
          previous = {
            runUpgrade: optionalValue(stat, 'run_upgrade'),
            runUpgradeTarget: optionalValue(stat, 'run_upgrade_target'),
            cards: structuredClone(stat.battle.cards),
          };
          stat.battle.cards = cards;
          stat.run_upgrade = null;
          stat.run_upgrade_target = { node_id: node.id, run_instance_id: selected.runInstanceId };
          return variables;
        });
        if (!previous) throw new Error('营火升级未返回可回滚状态');
        return previous;
      },
      rollbackBeforeSend: async previous => {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          restoreOptionalValue(stat, 'run_upgrade', previous.runUpgrade);
          restoreOptionalValue(stat, 'run_upgrade_target', previous.runUpgradeTarget);
          if (isRecord(stat.battle)) stat.battle.cards = previous.cards;
          return variables;
        });
      },
    });
  }

  public requestRestTransform(node: RunNodeChoice, card: Record<string, any>): Promise<void> {
    if (node.kind !== 'rest') throw new Error('营火变形需要有效的营火节点');
    if (this.ports.requestRestMutation) {
      return Promise.resolve(this.ports.requestRestMutation({
        spec: 'mwg.rest-mutation-request/v1',
        kind: 'transform',
        nodeId: node.id,
        ...(typeof card.runInstanceId === 'string' ? { runInstanceId: card.runInstanceId } : {}),
        ...(typeof card.id === 'string' ? { cardId: card.id } : {}),
      })).then(result => {
        if (result === null || result === undefined) throw new Error('爬塔后台组件尚未提供营火变形功能');
      });
    }
    const prompt = [
      `[营火变形] node_id=${node.id}`,
      `只为选中的卡牌生成一张完整、合法的替换卡：${JSON.stringify(card)}`,
      `只输出一条 _.set('run_transform', null, 完整卡牌对象) 命令；quantity 固定为 1，不写 runInstanceId、templateId、origin、parentRunInstanceId 或 $meta，不续写剧情。`,
    ].join('\n');
    return this.ports.continueWithPrompt<RestTransformPreparationSnapshot>({
      prompt,
      prepare: async () => {
        let previous: RestTransformPreparationSnapshot | null = null;
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          if (!isRecord(stat.battle)) throw new Error('battle 数据不存在');
          const cards = persistentCards(stat);
          const selected =
            typeof card.runInstanceId === 'string'
              ? cards.find(entry => entry.runInstanceId === card.runInstanceId)
              : cards.find(entry => entry.id === card.id);
          if (!selected) throw new Error('营火变形目标卡牌不存在');
          previous = {
            runTransform: optionalValue(stat, 'run_transform'),
            runTransformTarget: optionalValue(stat, 'run_transform_target'),
            cards: structuredClone(stat.battle.cards),
          };
          stat.battle.cards = cards;
          stat.run_transform = null;
          stat.run_transform_target = { node_id: node.id, run_instance_id: selected.runInstanceId };
          return variables;
        });
        if (!previous) throw new Error('营火变形未返回可回滚状态');
        return previous;
      },
      rollbackBeforeSend: async previous => {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          restoreOptionalValue(stat, 'run_transform', previous.runTransform);
          restoreOptionalValue(stat, 'run_transform_target', previous.runTransformTarget);
          if (isRecord(stat.battle)) stat.battle.cards = previous.cards;
          return variables;
        });
      },
    });
  }

  public async actAtCampfire(action: 'train' | 'scavenge' | 'recall', cardId?: string): Promise<string> {
    let summary = '';
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      const result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'rest_action', action, cardId, source: { kind: 'player', id: 'run-ui' },
      }).value as { summary: string };
      summary = result.summary;
      return variables;
    });
    await this.scheduleTowerGeneration('rest-settled');
    return summary;
  }

  public async healAtRest(): Promise<RestHealResult> {
    let result: RestHealResult | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'rest_heal',
        source: { kind: 'player', id: 'run-ui' },
      }).value as RestHealResult;
      return variables;
    });
    if (!result) throw new Error('营火恢复失败：MUV 更新未返回结算结果');
    await this.scheduleTowerGeneration('rest-settled');
    return result;
  }

  public async removeCardAtShop(runInstanceId: string): Promise<void> {
    if (!this.ports.isLatest()) throw new Error('请在最新消息的商店删卡');
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      if (!this.ports.isLatest()) throw new Error('请在最新消息的商店删卡');
      executeUnifiedRunTransactionInStat(statRoot(variables), {kind:'shop_remove_card', runInstanceId, source:{kind:'player',id:'shop-removal'}});
      return variables;
    });
  }

  /** One displayed stock slot, one atomic payment. A stale click never buys its successor. */
  public async purchaseShopItem(category: RewardCategory, index: number, expected: ReturnType<typeof createShopPurchaseQuote>, acquisitionAnswers?: RewardSettlementOptions['acquisitionAnswers']): Promise<CommonRewardSettlement> {
    if (!this.ports.isLatest()) throw new Error('请在最新消息的商店购买');
    let settlement: CommonRewardSettlement | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      if (!this.ports.isLatest()) throw new Error('请在最新消息的商店购买');
      const stat = statRoot(variables);
      const current=createShopPurchaseQuote(stat);
      if (!rewardPoolFingerprintMatches(stat, expected.pool) || current.stock!==expected.stock || current.runIdentity!==expected.runIdentity)
        throw new Error('商品已经更新，请查看当前货架后再购买');
      const run = readRunState(stat);
      if (run?.phase !== 'in_node' || run.currentNode?.kind !== 'shop') throw new Error('当前不在商店');
      const selections: RewardSelections = { cards: [], artifacts: [], items: [] };
      if (!['cards','artifacts','items'].includes(category) || !Number.isInteger(index) || index < 0) throw new Error('商品无效');
      selections[category] = [index];
      const transaction = executeUnifiedRunTransactionInStat(stat, {kind:'shop_purchase',selections,acquisitionAnswers,source:{kind:'player',id:'shop-item'}});
      const value = transaction.value as RewardSelectionSummary & {spentGold:number};
      settlement = {kind:'shop',summary:value,spentGold:value.spentGold,event:transaction.event};
      return variables;
    });
    if (!settlement) throw new Error('购买未完成，请重试');
    return settlement;
  }

  public async leaveShop(): Promise<RunState> {
    if (!this.ports.isLatest()) throw new Error('请在最新消息的商店离开');
    let run: RunState | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      if (!this.ports.isLatest()) throw new Error('请在最新消息的商店离开');
      run = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'shop_leave',
        source: { kind: 'player', id: 'run-ui' },
      }).value as RunState;
      return variables;
    });
    if (!run) throw new Error('离开商店失败：MUV 更新未返回结算结果');
    await this.scheduleTowerGeneration('shop-left');
    return run;
  }

  public async restartRun(): Promise<RunState> {
    let run: RunState | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      const stat = statRoot(variables);
      if (isRecord(stat.battle)) stat.battle.items = normalizeTowerItemInventory(stat.battle.items);
      run = restartRunInStat(stat);
      return variables;
    });
    if (!run) throw new Error('新远征初始化失败：MUV 更新未返回状态');
    await this.scheduleTowerGeneration('run-restarted');
    return run;
  }

  public async removeCardAtRest(runInstanceId: string): Promise<{ runInstanceId: string; cardName: string }> {
    let result: { runInstanceId: string; cardName: string } | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'rest_remove_card',
        runInstanceId,
        source: { kind: 'player', id: 'run-ui' },
      }).value as { runInstanceId: string; cardName: string };
      return variables;
    });
    if (!result) throw new Error('营火删卡失败：MUV 更新未返回结果');
    return result;
  }

  public async duplicateCardAtRest(
    runInstanceId: string,
  ): Promise<{ sourceRunInstanceId: string; createdRunInstanceId: string; cardName: string }> {
    let result: { sourceRunInstanceId: string; createdRunInstanceId: string; cardName: string } | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'rest_duplicate_card',
        runInstanceId,
        source: { kind: 'player', id: 'run-ui' },
      }).value as { sourceRunInstanceId: string; createdRunInstanceId: string; cardName: string };
      return variables;
    });
    if (!result) throw new Error('营火复制失败：MUV 更新未返回结果');
    return result;
  }

  public async transformCardAtRest(
    runInstanceId: string,
    replacement: Record<string, unknown>,
  ): Promise<{ runInstanceId: string; cardName: string }> {
    let result: { runInstanceId: string; cardName: string } | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'rest_transform_card',
        runInstanceId,
        replacement,
        source: { kind: 'player', id: 'run-ui' },
      }).value as { runInstanceId: string; cardName: string };
      return variables;
    });
    if (!result) throw new Error('营火变形失败：MUV 更新未返回结果');
    return result;
  }

  public async removeCardWithAllowance(runInstanceId: string, expectedRevision: number): Promise<{ runInstanceId: string; cardName: string }> {
    if (!this.ports.isLatest()) throw new Error('历史楼层不能删卡');
    if (this.ports.initialPublicationReady?.() === false) throw new Error('请先完成开局保存确认');
    let result: { runInstanceId: string; cardName: string } | undefined;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      if (!this.ports.isLatest()) throw new Error('历史楼层不能删卡');
      if (this.ports.initialPublicationReady?.() === false) throw new Error('请先完成开局保存确认');
      result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'allowance_remove_card', runInstanceId, expectedRevision,
        source: { kind: 'player', id: 'acquired-removal' },
      }).value as { runInstanceId: string; cardName: string };
      return variables;
    });
    if (!result) throw new Error('删卡保存未返回结果');
    return result;
  }

  public async removeCard(cardId: string): Promise<CardRemovalResult> {
    let result: CardRemovalResult | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      const battle = statRoot(variables).battle;
      result = removeOneCardFromBattleDeck(battle, cardId);
      return variables;
    });
    if (!result) throw new Error('删卡失败：MUV 更新未返回结果');
    return result;
  }

  public async settleTowerOpeningChoice(choiceId: string, acquisitionAnswers?: RewardSettlementOptions['acquisitionAnswers']): Promise<TowerOpeningSettlementResult> {
    if (!this.ports.isLatest()) throw new Error('历史楼层不能选择开局馈赠');
    if (this.ports.initialPublicationReady?.() === false) throw new Error('请先完成开局保存确认');
    let result: TowerOpeningSettlementResult | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      if (this.ports.initialPublicationReady?.() === false) throw new Error('开局保存尚未确认，未领取馈赠');
      result = settleTowerOpeningChoiceInStat(statRoot(variables), choiceId, acquisitionAnswers);
      return variables;
    });
    if (!result) throw new Error('开局馈赠结算失败：MUV 更新未返回结果');
    await this.scheduleTowerGeneration('opening-settled');
    return result;
  }

  public async retryTowerOpeningGeneration(): Promise<TowerOpeningRequest> {
    if (!this.ports.isLatest()) throw new Error('历史楼层不能重新生成开局馈赠');
    if (this.ports.initialPublicationReady?.() === false) throw new Error('请先完成开局保存确认，不要重新生成馈赠');
    let request: TowerOpeningRequest | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      if (this.ports.initialPublicationReady?.() === false) throw new Error('开局保存尚未确认');
      request = queueTowerOpeningInStat(statRoot(variables)).request;
      return variables;
    });
    if (!request) throw new Error('开局馈赠重试未返回生成请求');
    await this.scheduleTowerGeneration('opening-retry-queued');
    return request;
  }

  public async settleInitialArtifactAcquisition(generationId: string, answers: Record<string, import('./nonCombatSettlementTransactions').NonCombatAnswers>): Promise<void> {
    if (!this.ports.isLatest()) throw new Error('请在最新消息中处理初始遗物');
    if (this.ports.initialPublicationReady?.() === false) throw new Error('请先完成开局保存');
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      if (!this.ports.isLatest()) throw new Error('消息已经变化，请重新打开初始遗物');
      executeUnifiedRunTransactionInStat(statRoot(variables), { kind: 'initial_artifact_acquisition', generationId, answers,
        source: { kind: 'artifact', id: 'initial-acquisition' } });
      return variables;
    });
  }

  public async settleTowerEventChoice(choiceId: string, options: {
    stageId?: string; expectedEventRevision?: number; expectedRevision?: number;
    answers?: import('./nonCombatSettlementTransactions').NonCombatAnswers;
  } = {}): Promise<TowerEventChoiceSettlementResult> {
    if (!this.ports.isLatest()) throw new Error('历史楼层不能选择爬塔事件');
    let result: TowerEventChoiceSettlementResult | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'event_step', choiceId, ...options, source: { kind: 'event', id: choiceId },
      }).value as TowerEventChoiceSettlementResult;
      return variables;
    });
    if (!result) throw new Error('爬塔事件结算失败：MUV 更新未返回结果');
    await this.scheduleTowerGeneration('event-settled');
    return result;
  }
}
