import { settleCurrentMessageBattle } from '../../runtime/battleSettlementAdapter';
import { getCurrentMessageVariables, replaceCurrentMessageVariables } from '../../runtime/messageVariables';
import { TavernContinuationHost } from '../../runtime/tavernContinuation';
import {
  formatBattleEndPrompt,
  formatBattleRewardBudget,
  formatBuildGuidance,
  readBattleEndResult,
  recommendBattleRewardBudget,
  recommendBuildGuidance,
  summarizeBuildBudget,
  type BattleEndResult,
} from '../../game-core';
import type { GameState } from '../../game-core';
import { TavernBattleEffectPresenter, type BattleEndDialogRequest } from '../ui/battleEffectPresenter';
import { GameStateManager } from './gameStateManager';

export interface TavernBattleEndPorts {
  getState(): GameState;
  clearBattleSession(): Promise<void>;
  reloadBattleState(): Promise<boolean>;
  readVariables(): Record<string, any>;
  replaceVariables(variables: Record<string, any>): Promise<unknown>;
  settleBattle(input: Parameters<typeof settleCurrentMessageBattle>[0]): Promise<void>;
  reloadPage(): void;
}

export interface TavernBattleEndPresentationPorts {
  hasBattleEndDialog(): boolean;
  showBattleEndDialog(request: BattleEndDialogRequest): void;
  addLog(message: string, type: 'system'): void;
}

function cloneVariables(value: Record<string, any>): Record<string, any> {
  return JSON.parse(JSON.stringify(value));
}

/** Tavern-only continuation boundary for leaving a completed battle message. */
export class TavernBattleEndHost {
  private static instance: TavernBattleEndHost;

  public constructor(
    private readonly continuationHost = TavernContinuationHost.getInstance(),
    private readonly ports: TavernBattleEndPorts = (() => {
      const gameStateManager = GameStateManager.getInstance();
      return {
        getState: () => gameStateManager.getGameState(),
        clearBattleSession: () => gameStateManager.clearBattleSession(),
        reloadBattleState: () => gameStateManager.loadFromSillyTavern(),
        readVariables: () => getCurrentMessageVariables(),
        replaceVariables: variables => Promise.resolve(replaceCurrentMessageVariables(variables)),
        settleBattle: input => settleCurrentMessageBattle(input),
        reloadPage: () => location.reload(),
      };
    })(),
    private readonly injectedPresentation?: TavernBattleEndPresentationPorts,
  ) {}

  public static getInstance(): TavernBattleEndHost {
    if (!TavernBattleEndHost.instance) TavernBattleEndHost.instance = new TavernBattleEndHost();
    return TavernBattleEndHost.instance;
  }

  public async confirmBattleEnd(result: BattleEndResult, battleSummary: string): Promise<void> {
    const gameState = this.ports.getState();
    const settlement = {
      result,
      request: gameState.battleRequest,
      player: gameState.player,
      items: gameState.player.items || [],
      turns: gameState.currentTurn,
    };

    await this.continuationHost.continueWithPrompt({
      prompt: battleSummary,
      prepare: async () => {
        const snapshot = cloneVariables(this.ports.readVariables());
        try {
          // Clear the private session before settling MUV so the next assistant
          // floor cannot inherit a terminal runtime snapshot.
          await this.ports.clearBattleSession();
          await this.ports.settleBattle(settlement);
          return snapshot;
        } catch (prepareError) {
          try {
            await this.restoreBeforeSend(snapshot);
          } catch (rollbackError) {
            throw new AggregateError([prepareError, rollbackError], '战斗结算准备失败且回滚失败');
          }
          throw prepareError;
        }
      },
      rollbackBeforeSend: snapshot => this.restoreBeforeSend(snapshot),
    });
  }

  public async presentBattleEnd(result: BattleEndResult, narrativeText?: string): Promise<void> {
    try {
      const gameState = this.ports.getState();
      const player = gameState.player;
      const enemy = gameState.enemy;
      const narrativeCards = player.discardPile.filter(card => card.type === 'Event');
      const request = gameState.battleRequest;
      const budget =
        result === 'victory' && request
          ? summarizeBuildBudget(request.content, { hp: player.currentHp, maxHp: player.maxHp })
          : null;
      const guidance = request && budget ? formatBuildGuidance(recommendBuildGuidance(request.content, budget)) : '';
      const prompt = formatBattleEndPrompt({
        result,
        continuation: request?.route ? 'run' : 'ordinary',
        narrativeText,
        player: {
          hp: player.currentHp,
          maxHp: player.maxHp,
          lust: player.currentLust,
          maxLust: player.maxLust,
          energy: player.energy,
          statuses: player.statusEffects,
          handCount: player.hand.length,
          drawPileCount: player.drawPile.length,
          discardPileCount: player.discardPile.length,
        },
        enemy: enemy
          ? {
              name: enemy.name,
              hp: enemy.currentHp,
              maxHp: enemy.maxHp,
              lust: enemy.currentLust,
              maxLust: enemy.maxLust,
              statuses: enemy.statusEffects,
            }
          : null,
        turns: gameState.currentTurn,
        narrativeCards,
        rewardBudget:
          result === 'victory'
            ? `[奖励预算] ${formatBattleRewardBudget(recommendBattleRewardBudget(request?.route || null))}`
            : '',
        buildGuidance: guidance ? `[构筑建议] ${guidance}` : '',
      });

      const presentation = this.presentation();
      presentation.showBattleEndDialog({
        result,
        battleSummary: prompt.promptedBattleSummary,
        narrativeText,
        onConfirm: () => this.confirmBattleEnd(result, prompt.promptedBattleSummary),
        onRestart: () => this.restartBattle(),
      });
      presentation.addLog(`战斗结束：${prompt.resultText}`, 'system');
    } catch (error) {
      console.error('❌ 触发战斗结束叙事失败:', error);
      throw error;
    }
  }

  /** Recreate the actionable end dialog when a completed message session is restored. */
  public resumeBattleEndDialog(): void {
    const state = this.ports.getState();
    const presentation = this.presentation();
    if (!state.isGameOver || state.phase !== 'game_over' || presentation.hasBattleEndDialog()) return;

    const result = readBattleEndResult(state);
    if (!result) return;
    void this.presentBattleEnd(result, state.battleNarrative || undefined);
  }

  public async restartBattle(): Promise<void> {
    await this.ports.clearBattleSession();
    this.ports.reloadPage();
  }

  private async restoreBeforeSend(snapshot: Record<string, any>): Promise<void> {
    await this.ports.replaceVariables(cloneVariables(snapshot));
    if (!(await this.ports.reloadBattleState())) throw new Error('恢复战斗消息快照失败');
  }

  private presentation(): TavernBattleEndPresentationPorts {
    return this.injectedPresentation || TavernBattleEffectPresenter.getInstance();
  }
}
