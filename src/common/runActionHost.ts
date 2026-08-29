import { formatRestUpgradePrompt, migratePersistentRunDeck, type RunNodeChoice, type RunState } from '../game-core';
import {
  consumePendingRunResultInStat,
  deriveRunSeed,
  ensureRunStateInStat,
  enterRunNodeInStat,
  migrateRunProgramStateInStat,
  readRunState,
  restartRunInStat,
} from '../runtime/runStateAdapter';
import { isCurrentMessageLatest } from '../runtime/messageVariables';
import { hasSelectableRewards, normalizeMvuList, removeOneCardFromBattleDeck, type CardRemovalResult, type RewardSelections, type RewardSelectionSummary } from './rewardTransactions';
import {
  executeUnifiedRunTransactionInStat,
  type RestHealResult,
  type RestUpgradeResult,
  type RunTransactionEvent,
} from './runTransactions';
import {
  TavernCommonActionHost,
  type CommonContinuationPlan,
  type CommonVariablesUpdater,
} from './commonActionHost';

export interface CommonRunActionPorts {
  isLatest(): boolean;
  updateVariablesWith(updater: CommonVariablesUpdater): Promise<Record<string, any>>;
  continueWithPrompt<TPrepared = void>(plan: CommonContinuationPlan<TPrepared>): Promise<void>;
}

export interface CommonRunSyncResult {
  consumedRunResult: boolean;
  restUpgrade: RestUpgradeResult | null;
  restTransform: { runInstanceId: string; cardName: string } | null;
  rewardReroll: boolean;
}

export interface CommonRewardSettlement {
  kind: 'reward' | 'shop' | 'event';
  summary: RewardSelectionSummary;
  spentGold: number | null;
  event: RunTransactionEvent;
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

type RewardRerollCategory = 'cards' | 'artifacts' | 'items';

interface RewardRerollPending {
  node_id: string | null;
  categories: RewardRerollCategory[];
  expected_counts: Record<string, number>;
  gold_cost: number;
  expected_revision: number;
  original_reward: Record<string, any>;
}

interface RewardRerollPreparationSnapshot {
  pending: OptionalValueSnapshot;
  reward: Record<string, any>;
}

const REWARD_REROLL_KEYS = { cards: 'card', artifacts: 'artifact', items: 'item' } as const;

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

function readRewardRerollPending(stat: Record<string, any>): RewardRerollPending | null {
  const value = stat.run_reward_reroll;
  if (value == null) return null;
  if (!isRecord(value) || !Array.isArray(value.categories) || !isRecord(value.expected_counts) || !isRecord(value.original_reward)) {
    throw new Error('奖励重投状态无效');
  }
  return value as RewardRerollPending;
}

function rerollCategories(values: readonly string[]): RewardRerollCategory[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error('奖励重投至少需要一个类别');
  const allowed = new Set<RewardRerollCategory>(['cards', 'artifacts', 'items']);
  const categories = values.map(value => {
    if (!allowed.has(value as RewardRerollCategory)) throw new Error(`奖励重投类别无效：${value}`);
    return value as RewardRerollCategory;
  });
  if (new Set(categories).size !== categories.length) throw new Error('奖励重投类别不能重复');
  return categories;
}

function persistentCards(stat: Record<string, any>): Record<string, any>[] {
  if (!isRecord(stat.battle)) throw new Error('battle 数据不存在');
  return migratePersistentRunDeck(normalizeMvuList<Record<string, any>>(stat.battle.cards));
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
        updateVariablesWith: updater => actionHost.updateVariablesWith(updater),
        continueWithPrompt: plan => actionHost.continueWithPrompt(plan),
      };
    })(),
  ) {}

  public static getInstance(): TavernRunActionHost {
    if (!TavernRunActionHost.instance) TavernRunActionHost.instance = new TavernRunActionHost();
    return TavernRunActionHost.instance;
  }

  public async syncPendingRunState(): Promise<CommonRunSyncResult> {
    const result: CommonRunSyncResult = {
      consumedRunResult: false,
      restUpgrade: null,
      restTransform: null,
      rewardReroll: false,
    };
    if (!this.ports.isLatest()) return result;

    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      const stat = statRoot(variables);
      migrateRunProgramStateInStat(stat);
      const pendingReroll = readRewardRerollPending(stat);
      if (pendingReroll) {
        const generatedReward = isRecord(stat.reward) ? stat.reward : {};
        const ready = pendingReroll.categories.every(category =>
          normalizeMvuList(generatedReward[REWARD_REROLL_KEYS[category]]).length === pendingReroll.expected_counts[category],
        );
        if (ready) {
          const draft = structuredClone(stat);
          const generated = Object.fromEntries(
            pendingReroll.categories.map(category => [
              category,
              normalizeMvuList(generatedReward[REWARD_REROLL_KEYS[category]]),
            ]),
          );
          draft.reward = structuredClone(pendingReroll.original_reward);
          executeUnifiedRunTransactionInStat(draft, {
            kind: 'reward_pool',
            mutation: { kind: 'reroll', categories: pendingReroll.categories, candidates: generated },
            goldCost: pendingReroll.gold_cost,
            expectedRevision: pendingReroll.expected_revision,
            source: { kind: 'system', id: 'ai-reward-reroll' },
          });
          delete draft.run_reward_reroll;
          replaceRecord(stat, draft);
          result.rewardReroll = true;
        }
      }
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
      if (currentRun?.phase === 'in_node' && currentRun.currentNode?.kind === 'rest') {
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
      run = ensureRunStateInStat(stat, deriveRunSeed(stat)).run;
      return variables;
    });
    if (!run) throw new Error('远征初始化失败：MUV 更新未返回状态');
    return run;
  }

  public async settleRewardSelections(selections: RewardSelections): Promise<CommonRewardSettlement> {
    let settlement: CommonRewardSettlement | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      const stat = statRoot(variables);
      const run = readRunState(stat);
      if (run?.phase === 'in_node' && run.currentNode?.kind === 'shop') {
        const transaction = executeUnifiedRunTransactionInStat(stat, {
          kind: 'shop_purchase', selections, source: { kind: 'player', id: 'reward-ui' },
        });
        const value = transaction.value as RewardSelectionSummary & { spentGold: number };
        settlement = { kind: 'shop', summary: value, spentGold: value.spentGold, event: transaction.event };
      } else if (run?.phase === 'in_node' && run.currentNode?.kind === 'event' && stat.run_result != null) {
        const transaction = executeUnifiedRunTransactionInStat(stat, {
          kind: 'event_reward_claim', selections, source: { kind: 'player', id: 'reward-ui' },
        });
        settlement = { kind: 'event', summary: transaction.value as RewardSelectionSummary, spentGold: null, event: transaction.event };
      } else {
        const transaction = executeUnifiedRunTransactionInStat(stat, {
          kind: 'reward_claim', selections, source: { kind: 'player', id: 'reward-ui' },
        });
        settlement = { kind: 'reward', summary: transaction.value as RewardSelectionSummary, spentGold: null, event: transaction.event };
      }
      return variables;
    });
    if (!settlement) throw new Error('奖励领取失败：MUV 更新未返回结算结果');
    return settlement;
  }

  public requestRewardReroll(
    categoriesValue: readonly string[],
    prompt: string,
    goldCost = 0,
  ): Promise<void> {
    const categories = rerollCategories(categoriesValue);
    if (!Number.isInteger(goldCost) || goldCost < 0) throw new Error('奖励重投金币费用无效');
    return this.ports.continueWithPrompt<RewardRerollPreparationSnapshot>({
      prompt,
      prepare: async () => {
        let snapshot: RewardRerollPreparationSnapshot | null = null;
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          if (readRewardRerollPending(stat)) throw new Error('已有奖励重投正在生成');
          if (!isRecord(stat.reward)) throw new Error('reward 数据不存在');
          const expectedCounts = Object.fromEntries(categories.map(category => [
            category,
            normalizeMvuList(stat.reward[REWARD_REROLL_KEYS[category]]).length,
          ]));
          if (Object.values(expectedCounts).some(count => count < 1)) throw new Error('奖励重投类别没有现有候选');
          snapshot = { pending: optionalValue(stat, 'run_reward_reroll'), reward: structuredClone(stat.reward) };
          const run = readRunState(stat);
          stat.run_reward_reroll = {
            node_id: run?.currentNode?.id || null,
            categories,
            expected_counts: expectedCounts,
            gold_cost: goldCost,
            expected_revision: Number(stat.run_transaction_revision ?? 0),
            original_reward: structuredClone(stat.reward),
          } satisfies RewardRerollPending;
          for (const category of categories) stat.reward[REWARD_REROLL_KEYS[category]] = [];
          return variables;
        });
        if (!snapshot) throw new Error('奖励重投未返回可回滚状态');
        return snapshot;
      },
      rollbackBeforeSend: async snapshot => {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          stat.reward = snapshot.reward;
          restoreOptionalValue(stat, 'run_reward_reroll', snapshot.pending);
          return variables;
        });
      },
    });
  }

  public retryPendingRewardReroll(prompt: string): Promise<void> {
    return this.ports.continueWithPrompt<RewardRerollPreparationSnapshot>({
      prompt,
      prepare: async () => {
        let snapshot: RewardRerollPreparationSnapshot | null = null;
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          const pending = readRewardRerollPending(stat);
          if (!pending || !isRecord(stat.reward)) throw new Error('没有可重试的奖励重投');
          snapshot = { pending: optionalValue(stat, 'run_reward_reroll'), reward: structuredClone(stat.reward) };
          for (const category of pending.categories) stat.reward[REWARD_REROLL_KEYS[category]] = [];
          return variables;
        });
        if (!snapshot) throw new Error('奖励重投重试未返回可回滚状态');
        return snapshot;
      },
      rollbackBeforeSend: async snapshot => {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          stat.reward = snapshot.reward;
          restoreOptionalValue(stat, 'run_reward_reroll', snapshot.pending);
          return variables;
        });
      },
    });
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
    const prompt = formatRestUpgradePrompt({ node, card });
    return this.ports.continueWithPrompt<RestUpgradePreparationSnapshot>({
      prompt,
      prepare: async () => {
        let previous: RestUpgradePreparationSnapshot | null = null;
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          if (!isRecord(stat.battle)) throw new Error('battle 数据不存在');
          const cards = persistentCards(stat);
          const selected = typeof card.runInstanceId === 'string'
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
          const selected = typeof card.runInstanceId === 'string'
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

  public async healAtRest(): Promise<RestHealResult> {
    let result: RestHealResult | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'rest_heal', source: { kind: 'player', id: 'run-ui' },
      }).value as RestHealResult;
      return variables;
    });
    if (!result) throw new Error('营火恢复失败：MUV 更新未返回结算结果');
    return result;
  }

  public async leaveShop(): Promise<RunState> {
    let run: RunState | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      run = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'shop_leave', source: { kind: 'player', id: 'run-ui' },
      }).value as RunState;
      return variables;
    });
    if (!run) throw new Error('离开商店失败：MUV 更新未返回结算结果');
    return run;
  }

  public async restartRun(): Promise<RunState> {
    let run: RunState | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      run = restartRunInStat(statRoot(variables));
      return variables;
    });
    if (!run) throw new Error('新远征初始化失败：MUV 更新未返回状态');
    return run;
  }

  public async removeCardAtRest(runInstanceId: string): Promise<{ runInstanceId: string; cardName: string }> {
    let result: { runInstanceId: string; cardName: string } | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'rest_remove_card', runInstanceId, source: { kind: 'player', id: 'run-ui' },
      }).value as { runInstanceId: string; cardName: string };
      return variables;
    });
    if (!result) throw new Error('营火删卡失败：MUV 更新未返回结果');
    return result;
  }

  public async duplicateCardAtRest(runInstanceId: string): Promise<{ sourceRunInstanceId: string; createdRunInstanceId: string; cardName: string }> {
    let result: { sourceRunInstanceId: string; createdRunInstanceId: string; cardName: string } | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      result = executeUnifiedRunTransactionInStat(statRoot(variables), {
        kind: 'rest_duplicate_card', runInstanceId, source: { kind: 'player', id: 'run-ui' },
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
        kind: 'rest_transform_card', runInstanceId, replacement, source: { kind: 'player', id: 'run-ui' },
      }).value as { runInstanceId: string; cardName: string };
      return variables;
    });
    if (!result) throw new Error('营火变形失败：MUV 更新未返回结果');
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
}
