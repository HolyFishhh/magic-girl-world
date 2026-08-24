import { formatRestUpgradePrompt, type RunNodeChoice, type RunState } from '../game-core';
import {
  consumePendingRunResultInStat,
  deriveRunSeed,
  ensureRunStateInStat,
  enterRunNodeInStat,
  readRunState,
  restartRunInStat,
} from '../runtime/runStateAdapter';
import { isCurrentMessageLatest } from '../runtime/messageVariables';
import {
  applyRewardSelectionsToStat,
  hasSelectableRewards,
  normalizeMvuList,
  removeOneCardFromBattleDeck,
  type CardRemovalResult,
  type RewardSelections,
  type RewardSelectionSummary,
} from './rewardTransactions';
import {
  leaveShopInStat,
  settleEventRewardSelectionsInStat,
  settleRestHealInStat,
  settleRestUpgradeInStat,
  settleShopSelectionsInStat,
  type RestHealResult,
  type RestUpgradeResult,
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
}

export interface CommonRewardSettlement {
  kind: 'reward' | 'shop' | 'event';
  summary: RewardSelectionSummary;
  spentGold: number | null;
}

interface OptionalValueSnapshot {
  present: boolean;
  value: unknown;
}

interface RetrySnapshot {
  runResult: OptionalValueSnapshot;
  runUpgrade: OptionalValueSnapshot;
}

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
    const result: CommonRunSyncResult = { consumedRunResult: false, restUpgrade: null };
    if (!this.ports.isLatest()) return result;

    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      const stat = statRoot(variables);
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
      if (currentRun?.phase === 'in_node' && currentRun.currentNode?.kind === 'rest' && stat.run_upgrade) {
        result.restUpgrade = settleRestUpgradeInStat(stat);
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
        const result = settleShopSelectionsInStat(stat, selections);
        settlement = { kind: 'shop', summary: result, spentGold: result.spentGold };
      } else if (run?.phase === 'in_node' && run.currentNode?.kind === 'event' && stat.run_result != null) {
        settlement = { kind: 'event', summary: settleEventRewardSelectionsInStat(stat, selections), spentGold: null };
      } else {
        settlement = { kind: 'reward', summary: applyRewardSelectionsToStat(stat, selections), spentGold: null };
      }
      return variables;
    });
    if (!settlement) throw new Error('奖励领取失败：MUV 更新未返回结算结果');
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
          };
          stat.run_result = null;
          if (node.kind === 'rest') stat.run_upgrade = null;
          return variables;
        });
        if (!previous) throw new Error('节点重试未返回可回滚状态');
        return previous;
      },
      rollbackBeforeSend: async previous => {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          restoreOptionalValue(stat, 'run_result', previous.runResult);
          if (node.kind === 'rest') restoreOptionalValue(stat, 'run_upgrade', previous.runUpgrade);
          return variables;
        });
      },
    });
  }

  public requestRestUpgrade(node: RunNodeChoice, card: Record<string, any>): Promise<void> {
    const prompt = formatRestUpgradePrompt({ node, card });
    return this.ports.continueWithPrompt<OptionalValueSnapshot>({
      prompt,
      prepare: async () => {
        let previous: OptionalValueSnapshot | null = null;
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          const stat = statRoot(variables);
          previous = optionalValue(stat, 'run_upgrade');
          stat.run_upgrade = null;
          return variables;
        });
        if (!previous) throw new Error('营火升级未返回可回滚状态');
        return previous;
      },
      rollbackBeforeSend: async previous => {
        await this.ports.updateVariablesWith((variables: Record<string, any>) => {
          restoreOptionalValue(statRoot(variables), 'run_upgrade', previous);
          return variables;
        });
      },
    });
  }

  public async healAtRest(): Promise<RestHealResult> {
    let result: RestHealResult | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      result = settleRestHealInStat(statRoot(variables));
      return variables;
    });
    if (!result) throw new Error('营火恢复失败：MUV 更新未返回结算结果');
    return result;
  }

  public async leaveShop(): Promise<RunState> {
    let run: RunState | null = null;
    await this.ports.updateVariablesWith((variables: Record<string, any>) => {
      run = leaveShopInStat(statRoot(variables));
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
